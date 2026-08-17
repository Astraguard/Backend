/**
 * Persona (withpersona.com) KYC provider integration.
 *
 * Design constraints:
 *  - Raw document contents are never logged, stored, or returned by this module.
 *  - Only the provider's verdict (approved/declined/needs_review) and the provider-issued
 *    inquiry ID are surfaced to the caller — nothing that constitutes PII on our side.
 *  - The documentRef passed in is a pointer into our encrypted document store; we pass it
 *    to Persona as a reference_id so their webhook callbacks can be correlated back without
 *    us having to re-fetch the document.
 *
 * Persona inquiry lifecycle
 * ─────────────────────────
 * 1. We POST /inquiries with the template ID and a reference_id (our documentRef).
 * 2. Persona returns an inquiry object with status "created".
 * 3. The caller redirects the end-user to Persona's hosted flow (session token / inquiry URL).
 * 4. After the user completes the flow, Persona webhooks us (see handlePersonaWebhook).
 * 5. We re-fetch the inquiry on webhook receipt to get the definitive status.
 *
 * For server-side-only submissions (e.g. document ref already uploaded via Persona's
 * file-upload API by the client), we POST /inquiries and poll until a terminal status
 * is reached (approved / declined) or we time out and fall back to manual review.
 */

import crypto from 'crypto';
import { config } from '../../shared/config.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger('verification:kyc:persona');

export type PersonaVerdict = 'approved' | 'declined' | 'needs_review';

export interface PersonaInquiryResult {
  inquiryId: string;
  verdict: PersonaVerdict;
  /** ISO-8601 timestamp from Persona */
  completedAt: string | null;
}

/** Slim shape of the Persona inquiry object we care about */
interface PersonaInquiry {
  id: string;
  type: 'inquiry';
  attributes: {
    status: string; // 'created' | 'pending' | 'completed' | 'approved' | 'declined' | 'needs_review' | 'expired'
    'reference-id': string | null;
    'completed-at': string | null;
    'approved-at': string | null;
    'declined-at': string | null;
  };
}

interface PersonaApiResponse {
  data: PersonaInquiry;
}

const PERSONA_BASE_URL = config.kyc.providerBaseUrl || 'https://withpersona.com/api/v1';
const PERSONA_API_VERSION = '2023-01-05';

/** Terminal statuses — inquiry will not change after reaching these */
const TERMINAL_STATUSES = new Set(['approved', 'declined', 'needs_review', 'expired']);

function mapStatusToVerdict(status: string): PersonaVerdict {
  if (status === 'approved') return 'approved';
  if (status === 'declined') return 'declined';
  // needs_review, expired, or anything unexpected → human review
  return 'needs_review';
}

async function personaRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const apiKey = config.kyc.providerApiKey;
  if (!apiKey) throw new Error('KYC_PROVIDER_API_KEY is not configured');

  const url = `${PERSONA_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Persona-Version': PERSONA_API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Persona API ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Create a new Persona inquiry and return its ID.
 *
 * @param documentRef  Our encrypted-storage pointer, stored as Persona's reference_id for
 *                     webhook correlation. Never treated as PII.
 * @param templateId   The Persona inquiry template configured for this verification flow.
 */
export async function createInquiry(
  documentRef: string,
  templateId: string,
): Promise<string> {
  const response = await personaRequest<PersonaApiResponse>('POST', '/inquiries', {
    data: {
      attributes: {
        'inquiry-template-id': templateId,
        'reference-id': documentRef,
      },
    },
  });

  const inquiryId = response.data.id;
  log.info({ inquiryId }, 'Persona inquiry created');
  return inquiryId;
}

/**
 * Fetch the current status of an inquiry.
 */
export async function fetchInquiry(inquiryId: string): Promise<PersonaInquiry> {
  const response = await personaRequest<PersonaApiResponse>('GET', `/inquiries/${inquiryId}`);
  return response.data;
}

/**
 * Poll a Persona inquiry until it reaches a terminal status or the deadline expires.
 *
 * Returns null if polling times out — caller should fall back to manual review.
 */
export async function pollInquiryUntilTerminal(
  inquiryId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<PersonaInquiryResult | null> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const inquiry = await fetchInquiry(inquiryId);
    const status = inquiry.attributes.status;

    log.debug({ inquiryId, status }, 'Persona inquiry poll');

    if (TERMINAL_STATUSES.has(status)) {
      return {
        inquiryId: inquiry.id,
        verdict: mapStatusToVerdict(status),
        completedAt:
          inquiry.attributes['completed-at'] ??
          inquiry.attributes['approved-at'] ??
          inquiry.attributes['declined-at'] ??
          null,
      };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  log.warn({ inquiryId, timeoutMs }, 'Persona inquiry polling timed out — falling back to manual');
  return null;
}

/**
 * Verify a Persona webhook signature.
 *
 * Persona signs webhook payloads with HMAC-SHA256 using the webhook secret.
 * The signature is sent in the `Persona-Signature` header as:
 *   t=<unix-ts>,v1=<hex-sig>[,v1=<hex-sig>...]
 *
 * We verify that the timestamp is recent (within 5 minutes) and that at least
 * one v1 signature matches to prevent replay attacks.
 */
export function verifyPersonaWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const eq = part.indexOf('=');
      return [part.slice(0, eq), part.slice(eq + 1)];
    }),
  );

  const timestamp = parts['t'];
  const signatures = signatureHeader
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) {
    log.warn({ ts, now, delta: now - ts }, 'Persona webhook timestamp outside tolerance window');
    return false;
  }

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  return signatures.some((sig) =>
    crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')),
  );
}

/**
 * Parse a verified Persona webhook body into a PersonaInquiryResult.
 *
 * Returns null for non-inquiry events or unrecognised payload shapes.
 */
export function parsePersonaWebhookPayload(
  body: Record<string, unknown>,
): PersonaInquiryResult | null {
  try {
    const eventName = (body['data'] as Record<string, unknown>)?.['attributes'] as
      | Record<string, unknown>
      | undefined;

    // Top-level event object
    const payload = body['data'] as Record<string, unknown> | undefined;
    if (!payload) return null;

    // Persona webhook event: { data: { type: 'event', attributes: { name, payload: { data: <inquiry> } } } }
    const attributes = payload['attributes'] as Record<string, unknown> | undefined;
    if (!attributes) return null;

    const eventPayload = attributes['payload'] as Record<string, unknown> | undefined;
    const inquiryData = (eventPayload?.['data'] ?? payload) as
      | Record<string, unknown>
      | undefined;

    if (!inquiryData || inquiryData['type'] !== 'inquiry') return null;

    const inquiryId = inquiryData['id'] as string;
    const attrs = inquiryData['attributes'] as Record<string, unknown> | undefined;
    if (!attrs || !inquiryId) return null;

    const status = attrs['status'] as string;
    const completedAt =
      (attrs['completed-at'] as string | null) ??
      (attrs['approved-at'] as string | null) ??
      (attrs['declined-at'] as string | null) ??
      null;

    return {
      inquiryId,
      verdict: mapStatusToVerdict(status),
      completedAt,
    };
  } catch {
    return null;
  }
}
