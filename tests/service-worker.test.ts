import { afterEach, expect, it, vi } from 'vitest';
import { parseTweetArticle } from '../src/dom-parser';

const mocks = vi.hoisted(() => ({ put: vi.fn(), schedule: vi.fn(), sync: vi.fn(), recordCapture: vi.fn() }));
vi.mock('../src/outbox', () => ({
  Outbox: class {
    put = mocks.put;
  },
}));
vi.mock('../src/sync', () => ({
  SyncCoordinator: class {
    schedule = mocks.schedule;
    sync = mocks.sync;
  },
}));
vi.mock('../src/storage', () => ({ recordCapture: mocks.recordCapture, getSettings: vi.fn(), getStatus: vi.fn(), saveSettings: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.resetModules();
});

it('rejects a DOM display-name fallback before persistence and still accepts a later valid capture', async () => {
  document.body.innerHTML = `<article><a href="https://x.com/alice/status/123">post</a><div data-testid="User-Name">Alice Smith 🐉</div><time datetime="2026-01-01T00:00:00Z"></time></article>`;
  const article = document.querySelector('article');
  if (!article) throw new Error('Missing article');
  const capture = parseTweetArticle(article, 'like');
  expect(capture?.author).toBe('Alice Smith 🐉');
  const addListener = vi.fn();
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
  await import('../src/service-worker');
  const registration = addListener.mock.calls[0];
  if (!registration) throw new Error('Missing listener');
  const response = vi.fn();
  registration[0]({ type: 'CAPTURE_ITEM', item: capture }, {}, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false, error: 'Invalid capture item' }));
  expect(mocks.put).not.toHaveBeenCalled();
  expect(mocks.schedule).not.toHaveBeenCalled();
  mocks.put.mockResolvedValue('new');
  mocks.recordCapture.mockResolvedValue({});
  registration[0]({ type: 'CAPTURE_ITEM', item: { ...capture, author: '@alice' } }, {}, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true, stored: true })));
  expect(mocks.put).toHaveBeenCalledOnce();
  expect(mocks.schedule).toHaveBeenCalledOnce();
});

it('schedules delivery only after outbox persistence completes', async () => {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } });
  let commit!: (value: string) => void;
  mocks.put.mockReturnValue(
    new Promise((resolve) => {
      commit = resolve;
    }),
  );
  mocks.recordCapture.mockResolvedValue({});
  await import('../src/service-worker');
  const registration = addListener.mock.calls[0];
  if (!registration) throw new Error('Message listener was not registered');
  const listener = registration[0];
  const response = vi.fn();
  listener(
    {
      type: 'CAPTURE_ITEM',
      item: {
        tweet_id: '1',
        text: 'saved',
        author: '@alice',
        url: 'https://x.com/alice/status/1',
        created_at: '2026-01-01T00:00:00.000Z',
        kind: 'like',
      },
    },
    {},
    response,
  );
  expect(mocks.schedule).not.toHaveBeenCalled();
  commit('new');
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true, stored: true })));
  expect(mocks.schedule).toHaveBeenCalledOnce();
  listener({ type: 'SYNC' }, {}, response);
  expect(mocks.sync).toHaveBeenCalledOnce();
});
