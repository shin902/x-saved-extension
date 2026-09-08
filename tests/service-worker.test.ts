import { afterEach, expect, it, vi } from 'vitest';

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
