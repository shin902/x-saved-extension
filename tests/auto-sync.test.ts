import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Outbox } from '../src/outbox';
import { SyncCoordinator, syncOutbox } from '../src/sync';
import type { SavedItem } from '../src/types';

const item = (id: number): SavedItem => ({
  tweet_id: String(id),
  text: 'saved',
  author: '@alice',
  url: `https://x.com/alice/status/${id}`,
  created_at: '2026-01-01T00:00:00.000Z',
  kind: 'like',
});

describe('automatic sync', () => {
  const outbox = new Outbox();
  beforeEach(() => {
    const stored: Record<string, unknown> = { settings: { receiverUrl: 'https://receiver.tailnet.ts.net:8443/v1/x-saved/items' } };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: (defaults: object, callback: (value: object) => void) => callback({ ...defaults, ...stored }),
          set: (values: object, callback: () => void) => {
            Object.assign(stored, values);
            callback();
          },
        },
      },
      runtime: {},
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await outbox.clear();
    vi.unstubAllGlobals();
  });

  function ackFetch() {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as { items: SavedItem[] };
      return new Response(JSON.stringify({ accepted: payload.items.map((entry) => `${entry.kind}:${entry.tweet_id}`) }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('drains more than 50 records in bounded batches', async () => {
    const fetchMock = ackFetch();
    for (let id = 1; id <= 123; id++) await outbox.put(item(id));
    await expect(syncOutbox(outbox)).resolves.toEqual({ accepted: 123, pending: 0 });
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string).items.length)).toEqual([50, 50, 23]);
  });

  it('coalesces captures and starts within 500ms without manual sync', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = ackFetch();
    const sync = new SyncCoordinator(outbox);
    await outbox.put(item(1));
    sync.schedule();
    await vi.advanceTimersByTimeAsync(400);
    await outbox.put(item(2));
    sync.schedule();
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await sync.sync();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await outbox.count()).toBe(0);
  });

  it('shares one in-flight operation with manual sync and delivers captures arriving during it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = ackFetch();
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await outbox.put(item(1));
    const sync = new SyncCoordinator(outbox);
    const first = sync.sync();
    expect(sync.sync()).toBe(first);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await outbox.put(item(2));
    sync.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    release(new Response(JSON.stringify({ accepted: ['like:1'] })));
    await expect(first).resolves.toEqual({ accepted: 2, pending: 0 });
    await vi.advanceTimersByTimeAsync(500);
    await sync.sync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps failures pending without a retry loop, then retries on a later capture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = ackFetch();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const sync = new SyncCoordinator(outbox);
    await outbox.put(item(1));
    sync.schedule();
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect((await outbox.list(1))[0]?.attempts).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await outbox.count()).toBe(1);
    await outbox.put(item(2));
    sync.schedule();
    await vi.advanceTimersByTimeAsync(500);
    await sync.sync();
    expect(await outbox.count()).toBe(0);
  });

  it('stops on a partial ACK, removes only ACKed records and permits manual recovery', async () => {
    const fetchMock = ackFetch();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: ['like:1', 'like:999'] })));
    await outbox.put(item(1));
    await outbox.put(item(2));
    const sync = new SyncCoordinator(outbox);
    await expect(sync.sync()).resolves.toEqual({ accepted: 1, pending: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await outbox.list(50)).map((record) => record.dedupe_key)).toEqual(['like:2']);
    await expect(sync.sync()).resolves.toEqual({ accepted: 1, pending: 0 });
  });
});
