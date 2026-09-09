import type { Outbox } from './outbox';
import { getSettings, recordSync } from './storage';

export const BATCH_SIZE = 50;

export interface SyncResult {
  accepted: number;
  pending: number;
}

function receiverUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('Receiver URL must use http or https');
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

async function syncBatch(outbox: Outbox): Promise<SyncResult & { complete: boolean }> {
  const settings = await getSettings();
  if (!settings.receiverUrl) throw new Error('Set a receiver URL first');
  const records = await outbox.list(BATCH_SIZE);
  if (records.length === 0) {
    await recordSync();
    return { accepted: 0, pending: 0, complete: true };
  }

  const keys = records.map((record) => record.dedupe_key);
  try {
    const response = await fetch(receiverUrl(settings.receiverUrl), {
      signal: AbortSignal.timeout(15_000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: records.map((record) => record.item),
        idempotency_key: crypto.randomUUID(),
      }),
    });
    if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const accepted = acceptedKeys(payload, new Set(keys));
    if (accepted.length === 0) {
      throw new Error('Receiver accepted no outbox items');
    }
    await outbox.remove(records.filter((record) => accepted.includes(record.dedupe_key)));
    await recordSync();
    return {
      accepted: accepted.length,
      pending: await outbox.count(),
      complete: accepted.length === records.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receiver request failed';
    await outbox.markAttempt(keys, message);
    throw new Error(message);
  }
}

/** Drain fully ACKed batches; leave rejected records for a later explicit trigger. */
export async function syncOutbox(outbox: Outbox): Promise<SyncResult> {
  let accepted = 0;
  while (true) {
    const result = await syncBatch(outbox);
    accepted += result.accepted;
    if (!result.complete || result.pending === 0) return { accepted, pending: result.pending };
  }
}

/** One coordinator per worker, shared by automatic and popup sync. */
export class SyncCoordinator {
  private inFlight?: Promise<SyncResult>;
  private timer?: ReturnType<typeof setTimeout>;
  private requested = false;

  constructor(private readonly outbox: Outbox) {}

  schedule(): void {
    this.requested = true;
    // Bound latency even while a user keeps scrolling and captures keep arriving.
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync().catch(() => {
        /* Durable outbox is retried by the next capture or manual sync. */
      });
    }, 500);
  }

  sync(): Promise<SyncResult> {
    if (this.inFlight) return this.inFlight;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.requested = false;
    this.inFlight = syncOutbox(this.outbox).finally(() => {
      this.inFlight = undefined;
      if (this.requested) this.schedule();
    });
    return this.inFlight;
  }
}
