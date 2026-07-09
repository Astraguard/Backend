import { createHmac } from 'node:crypto';

/** HMAC-SHA256 over the exact raw body bytes sent — partners recompute this to verify authenticity. */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
