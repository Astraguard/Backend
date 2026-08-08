import { resolve4, resolve6 } from 'node:dns/promises';

/**
 * Thin DNS resolver abstraction used by the SSRF guard so the resolution
 * step can be replaced in tests without monkey-patching node:dns.
 */
export const dns = {
  async resolveAll(hostname: string): Promise<string[]> {
    const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
    const addresses: string[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') addresses.push(...r.value);
    }
    if (addresses.length === 0) {
      throw new Error(`no addresses found for ${hostname}`);
    }
    return addresses;
  },
};
