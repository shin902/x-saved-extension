import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outbox } from '../src/outbox';
import { syncOutbox } from '../src/sync';
import type { SavedItem } from '../src/types';

const item: SavedItem = {
  tweet_id: '7', text: 'text', author: '@alice', url: 'https://x.com/alice/status/7',
  created_at: '2025-01-02T03:04:05.000Z', kind: 'like'
};

const stored: Record<string, unknown> = {};
const chromeMock = {
  storage: { local: {
    get: (defaults: Record<string, unknown>, callback: (values: Record<string, unknown>) => void) =>
      callback({ ...defaults, ...stored }),
    set: (values: Record<string, unknown>, callback: () => void) => { Object.assign(stored, values); callback(); }
  } },
  runtime: { lastError: undefined }
};

describe('outbox sync protocol', () => {
  const outbox = new Outbox();
  afterEach(async () => {
    await outbox.remove((await outbox.list(100)).map((record) => record.dedupe_key));
    for (const key of Object.keys(stored)) delete stored[key];
    vi.unstubAllGlobals();
  });

  it('deletes only keys explicitly accepted after a successful response', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: ['like:7', 'like:missing'] }), { status: 200 })));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items', receiverToken: 'secret' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).resolves.toEqual({ accepted: 1, pending: 0 });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(await outbox.count()).toBe(0);
  });

  it('keeps records when the receiver fails', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items', receiverToken: 'secret' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).rejects.toThrow('offline');
    expect(await outbox.count()).toBe(1);
  });
});
