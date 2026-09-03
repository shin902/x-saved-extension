import { Outbox } from './outbox';
import { getSettings, recordSync } from './storage';

export const BATCH_SIZE = 50;

export interface SyncResult {
  accepted: number;
  pending: number;
}

function receiverUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Receiver URL must use http or https');
  if (parsed.username || parsed.password) throw new Error('Receiver URL must not contain credentials');
  return parsed.toString();
}

function acceptedKeys(payload: unknown, valid: Set<string>): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const values = (payload as { accepted?: unknown }).accepted;
  if (!Array.isArray(values)) return [];
  const keys = values.flatMap((entry) => {
    if (typeof entry === 'string') return valid.has(entry) ? [entry] : [];
    if (entry && typeof entry === 'object' && typeof (entry as { dedupe_key?: unknown }).dedupe_key === 'string') {
      const key = (entry as { dedupe_key: string }).dedupe_key;
      return valid.has(key) ? [key] : [];
    }
    return [];
  });
  return [...new Set(keys)];
}

export async function syncOutbox(outbox: Outbox): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.receiverUrl) throw new Error('Set a receiver URL first');
  const records = await outbox.list(BATCH_SIZE);
  if (records.length === 0) {
    await recordSync();
    return { accepted: 0, pending: 0 };
  }

  const keys = records.map((record) => record.dedupe_key);
  try {
    const response = await fetch(receiverUrl(settings.receiverUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: records.map((record) => record.item),
        idempotency_key: crypto.randomUUID()
      })
    });
    if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const accepted = acceptedKeys(payload, new Set(keys));
    if (accepted.length === 0) {
      throw new Error('Receiver accepted no outbox items');
    }
    await outbox.remove(accepted);
    await recordSync();
    return { accepted: accepted.length, pending: await outbox.count() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receiver request failed';
    await outbox.markAttempt(keys, message);
    throw new Error(message);
  }
}
