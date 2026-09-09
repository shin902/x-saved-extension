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

it.each([
  false,
  true,
])('attaches initial DOM media=%s without media-aware sent/inFlight/seen/outbox behavior', async (initialMedia) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.history.replaceState({}, '', '/alice/likes');
  document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name">@alice</div><time datetime="2026-01-01T00:00:00Z"></time><a href="https://x.com/alice/status/123">post</a>${initialMedia ? '<img src="https://pbs.twimg.com/media/one" alt="Diagram">' : ''}</article>`;
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
  const payloads: SavedItem[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      payloads.push(JSON.parse(init.body as string).items);
      return Promise.resolve(new Response(JSON.stringify({ accepted: ['like:123'] })));
    })
  );
  await import('../src/service-worker');
  await import('../src/content-script');
  await vi.waitFor(() => expect(releaseCapture).toBeTypeOf('function'));
  const first = (await new Outbox().list(1))[0]!.item;
  expect(first.media).toEqual(
    initialMedia
      ? [{ kind: 'image', position: 0, source_url: 'https://pbs.twimg.com/media/one', alt_text: 'Diagram' }]
      : undefined
  );

  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<video></video>');
  scan();
  expect(sendMessage).toHaveBeenCalledTimes(1); // Same key, even with different media in flight.
  releaseCapture();
  await Promise.resolve();
  scan();
  expect(sendMessage).toHaveBeenCalledTimes(1); // Same key after the durable ACK.

  // A new content-script lifecycle can observe changed media but persistent
  // seen dedupe still keeps the original queued payload, not enrichment.
  vi.resetModules();
  await import('../src/content-script');
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () => expect((await new Outbox().list(1))[0]?.item).toEqual(first));
  await new Promise((resolve) => listener({ type: 'SYNC' }, {}, resolve));
  expect(payloads).toEqual([[first]]);
  expect(await new Outbox().count()).toBe(0);
  expect(await new Outbox().put({ ...first, media: [{ kind: 'video', position: 0 }] })).toBe('known');
  expect(await new Outbox().count()).toBe(0);
});
