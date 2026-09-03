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
    await outbox.clear();
    for (const key of Object.keys(stored)) delete stored[key];
    vi.unstubAllGlobals();
  });

  it('deletes only keys explicitly accepted after a successful response', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: ['like:7', 'like:missing'] }), { status: 200 })));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).resolves.toEqual({ accepted: 1, pending: 0 });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect((vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit).headers).toEqual({
      'Content-Type': 'application/json'
    });
    expect(await outbox.count()).toBe(0);
  });

  it('keeps records when the receiver fails', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).rejects.toThrow('offline');
    expect(await outbox.count()).toBe(1);
  });

  it('reports an error and records an attempt when the receiver accepts nothing', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: [] }), { status: 200 })));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items' };
    stored.stats = { lastSync: '2025-01-01T00:00:00.000Z' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).rejects.toThrow('Receiver accepted no outbox items');
    expect(await outbox.count()).toBe(1);
    expect((await outbox.list(1))[0]?.attempts).toBe(1);
    expect((await outbox.list(1))[0]?.last_error).toBe('Receiver accepted no outbox items');
    expect((stored.stats as { lastSync: string }).lastSync).toBe('2025-01-01T00:00:00.000Z');
  });

  it('reports an error for a 2xx response without a valid accepted array', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items' };
    await outbox.put(item);

    await expect(syncOutbox(outbox)).rejects.toThrow('Receiver accepted no outbox items');
    expect((await outbox.list(1))[0]?.attempts).toBe(1);
    expect(stored.stats).toBeUndefined();
  });
});
