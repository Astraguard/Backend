import { isIP } from 'node:net';
import { dns } from './dns-resolver.js';
import { ValidationError } from './errors.js';

/**
 * SSRF protection for partner webhook URLs.
 *
 * Two layers:
 *  1. assertSafeWebhookUrl   — parse-time check, call at registration.
 *  2. assertSafeResolvedHost — DNS-resolution check, call at dispatch (DNS-rebinding protection).
 *
 * Blocked ranges (RFC 1918, loopback, link-local, unique-local, multicast, cloud metadata):
 *   127.0.0.0/8      loopback
 *   10.0.0.0/8       private
 *   172.16.0.0/12    private
 *   192.168.0.0/16   private
 *   169.254.0.0/16   link-local / AWS+GCP metadata
 *   100.64.0.0/10    CGNAT / shared address space
 *   0.0.0.0/8        "this" network
 *   ::1/128          IPv6 loopback
 *   fc00::/7         IPv6 unique-local
 *   fe80::/10        IPv6 link-local
 *   Literal "localhost" and any non-FQDN single-label hostname
 */

interface CidrBlock {
  base: bigint;
  mask: bigint;
  bits: 32 | 128;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ipv4ToBigInt(addr: string): bigint {
  return addr.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function ipv6ToBigInt(addr: string): bigint {
  // Expand :: shorthand
  const halves = addr.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
}

function parseCidr(cidr: string): CidrBlock {
  const [addr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const v6 = addr.includes(':');
  const bits = v6 ? 128 : 32;
  const totalBits = BigInt(bits);
  const base = v6 ? ipv6ToBigInt(addr) : ipv4ToBigInt(addr);
  const mask = ((1n << totalBits) - 1n) ^ ((1n << (totalBits - BigInt(prefix))) - 1n);
  return { base: base & mask, mask, bits };
}

function isInCidr(ip: string, block: CidrBlock): boolean {
  try {
    const n = block.bits === 128 ? ipv6ToBigInt(ip) : ipv4ToBigInt(ip);
    return (n & block.mask) === block.base;
  } catch {
    return false;
  }
}

// ── blocked CIDR blocks ───────────────────────────────────────────────────────

const BLOCKED_CIDRS: CidrBlock[] = [
  // IPv4
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '240.0.0.0/4',
  '255.255.255.255/32',
  // IPv6
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '::ffff:0:0/96', // IPv4-mapped
].map(parseCidr);

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip); // 0 = not an IP, 4 or 6
  if (family === 0) return false;
  // Strip IPv6 zone IDs
  const clean = ip.includes('%') ? ip.split('%')[0] : ip;
  return BLOCKED_CIDRS.some((block) => {
    if ((family === 4) !== (block.bits === 32)) return false;
    return isInCidr(clean, block);
  });
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Parse-time validation: rejects non-HTTPS, localhost/single-label hostnames,
 * and any literal IP that falls in a blocked range.
 *
 * Does NOT do DNS resolution — call assertSafeResolvedHost at dispatch time.
 */
export function assertSafeWebhookUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError('Webhook URL is not a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Webhook URL must use HTTPS.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Block "localhost" and all single-label names (e.g. "redis", "internal")
  if (hostname === 'localhost' || !hostname.includes('.')) {
    throw new ValidationError(
      `Webhook URL hostname "${hostname}" is not allowed. Use a publicly routable FQDN.`,
    );
  }

  // Block literal IP addresses that fall in blocked ranges
  if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new ValidationError(
      `Webhook URL resolves to a private/reserved IP address and cannot be used.`,
    );
  }
}

/**
 * Dispatch-time validation: resolves the hostname via DNS and checks every
 * returned address against the blocked-range list (DNS-rebinding protection).
 *
 * Throws ValidationError if any resolved address is in a blocked range.
 */
export async function assertSafeResolvedHost(raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError('Webhook URL is not a valid URL.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // If the hostname is already a literal IP we already checked it at registration;
  // re-check here for completeness (no syscall needed).
  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new ValidationError(
        `Webhook URL resolves to a private/reserved IP address and cannot be dispatched to.`,
      );
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await dns.resolveAll(hostname);
  } catch (err) {
    throw new ValidationError(
      `Webhook hostname "${hostname}" could not be resolved: ${(err as Error).message}`,
    );
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new ValidationError(
        `Webhook hostname "${hostname}" resolves to a private/reserved address (${addr}) and cannot be dispatched to.`,
      );
    }
  }
}
