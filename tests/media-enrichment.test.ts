import { afterEach, expect, it, vi } from 'vitest';
import { Outbox } from '../src/outbox';
import type { SavedItem } from '../src/types';

afterEach(async () => {
  await new Outbox().clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

it('delivers enrichment through content sent/inFlight, worker, durable seen/outbox and concurrent sync ACKs', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.history.replaceState({}, '', '/alice/likes');
  document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name">@alice</div><time datetime="2026-01-01T00:00:00Z"></time><a href="https://x.com/alice/status/123">post</a></article>`;
  let scan!: () => void;
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        scan = callback;
      }
      observe() {}
    }
  );
  let listener!: (message: unknown, sender: object, reply: (value: object) => void) => void;
  const stored = { settings: { receiverUrl: 'https://receiver.tailnet.ts.net/v1/x-saved/items' } };
  let releaseCapture!: () => void;
  const sendMessage = vi.fn(
    (message: unknown) =>
      new Promise((resolve) => {
        listener(message, {}, (reply) => {
          if (!releaseCapture) releaseCapture = () => resolve(reply);
          else resolve(reply);
        });
      })
  );
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get: (defaults: object, callback: (value: object) => void) => callback({ ...defaults, ...stored }),
        set: (values: object, callback: () => void) => {
          Object.assign(stored, values);
          callback();
        },
      },
    },
  });
  let releaseHttp!: (response: Response) => void;
  const payloads: SavedItem[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const { items } = JSON.parse(init.body as string) as { items: SavedItem[] };
      payloads.push(items);
      if (payloads.length === 1)
        return new Promise<Response>((resolve) => {
          releaseHttp = resolve;
        });
      return Promise.resolve(new Response(JSON.stringify({ accepted: ['like:123'] })));
    })
  );
  await import('../src/service-worker');
  await import('../src/content-script');
  await vi.waitFor(() => expect(releaseCapture).toBeTypeOf('function'));
  scan();
  expect(sendMessage).toHaveBeenCalledTimes(1); // inFlight suppresses identical observation
  const sync = new Promise((resolve) => listener({ type: 'SYNC' }, {}, resolve));
  await vi.waitFor(() => expect(payloads).toHaveLength(1));
  expect(payloads[0]?.[0]?.media).toBeUndefined();

  const article = document.querySelector('article')!;
  article.insertAdjacentHTML(
    'beforeend',
    '<img src="https://pbs.twimg.com/media/one?format=jpg&name=small" alt="Diagram">'
  );
  scan();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () => expect((await new Outbox().list(1))[0]?.item.media).toHaveLength(1));
  releaseCapture(); // stale content-script reply must not suppress the newer capture
  releaseHttp(new Response(JSON.stringify({ accepted: ['like:123'] })));
  await sync;
  expect(payloads).toHaveLength(2); // stale network ACK did not delete enrichment
  expect(payloads[1]?.[0]?.media).toEqual([
    {
      kind: 'image',
      position: 0,
      source_url: 'https://pbs.twimg.com/media/one?format=jpg&name=small',
      alt_text: 'Diagram',
    },
  ]);
  expect(await new Outbox().count()).toBe(0);
  scan();
  scan();
  expect(sendMessage).toHaveBeenCalledTimes(2); // sent suppresses same media

  // Re-observation on a fresh content-script lifecycle still reaches persistent
  // seen without re-enqueueing identical media, then permits further enrichment.
  vi.resetModules();
  await import('../src/content-script');
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  await vi.waitFor(async () => expect(await new Outbox().count()).toBe(0));
  article.insertAdjacentHTML('beforeend', '<video src="blob:https://x.com/transient"></video>');
  scan();
  await vi.waitFor(async () => expect((await new Outbox().list(1))[0]?.item.media).toHaveLength(2));
  await new Promise((resolve) => listener({ type: 'SYNC' }, {}, resolve));
  expect(payloads[2]?.[0]?.media?.[1]).toEqual({ kind: 'video', position: 1 });
  expect(await new Outbox().count()).toBe(0);
});
