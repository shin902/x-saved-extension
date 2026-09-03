import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings } from '../src/storage';

const stored: Record<string, unknown> = {};
const setCalls: Record<string, unknown>[] = [];
const chromeMock = {
  storage: { local: {
    get: (defaults: Record<string, unknown>, callback: (values: Record<string, unknown>) => void) =>
      callback({ ...defaults, ...stored }),
    set: (values: Record<string, unknown>, callback: () => void) => {
      setCalls.push(values);
      Object.assign(stored, values);
      callback();
    }
  } },
  runtime: { lastError: undefined }
};

describe('settings storage migration', () => {
  afterEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    setCalls.length = 0;
    vi.unstubAllGlobals();
  });

  it('removes a legacy bearer token while preserving the receiver URL', async () => {
    vi.stubGlobal('chrome', chromeMock);
    stored.settings = {
      receiverUrl: 'http://receiver.tailnet.ts.net/items',
      receiverToken: 'legacy-secret'
    };

    await expect(getSettings()).resolves.toEqual({
      receiverUrl: 'http://receiver.tailnet.ts.net/items'
    });
    expect(stored.settings).toEqual({
      receiverUrl: 'http://receiver.tailnet.ts.net/items'
    });
    expect(setCalls).toEqual([{
      settings: { receiverUrl: 'http://receiver.tailnet.ts.net/items' }
    }]);
  });

  it('does not rewrite already-migrated settings', async () => {
    vi.stubGlobal('chrome', chromeMock);
    stored.settings = { receiverUrl: 'http://receiver.tailnet.ts.net/items' };

    await expect(getSettings()).resolves.toEqual({
      receiverUrl: 'http://receiver.tailnet.ts.net/items'
    });
    expect(setCalls).toEqual([]);
  });
});
