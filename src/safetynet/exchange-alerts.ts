import { config } from '../shared/config.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('safetynet:exchange-alerts');

export interface ExchangeAlert {
  targetAddress: string;
  reason: string;
  traceSummary?: string;
}

/**
 * Notifies exchange compliance teams about a flagged/traced address so they can freeze or
 * flag it on their end. No per-exchange integrations exist yet (contacts, APIs, and formats
 * differ per exchange) — this posts to a single generic webhook as a v1 placeholder.
 */
export async function notifyExchanges(alert: ExchangeAlert): Promise<void> {
  if (!config.alerts.exchangeWebhookUrl) {
    log.warn({ alert }, 'EXCHANGE_ALERT_WEBHOOK_URL not set — alert not dispatched');
    return;
  }

  const response = await fetch(config.alerts.exchangeWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...alert, dispatchedAt: new Date().toISOString() }),
  });

  if (!response.ok) {
    log.error({ status: response.status, alert }, 'exchange alert webhook returned non-2xx');
    throw new Error(`Exchange alert webhook failed with status ${response.status}`);
  }

  log.info({ targetAddress: alert.targetAddress }, 'exchange alert dispatched');
}
