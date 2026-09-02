import { afterEach, describe, expect, it } from 'vitest';
import { Outbox } from '../src/outbox';
import type { SavedItem } from '../src/types';

const item = (kind: SavedItem['kind'], tweet_id = '42'): SavedItem => ({
  tweet_id, text: 'text', author: '@alice', url: `https://x.com/alice/status/${tweet_id}`,
  created_at: '2025-01-02T03:04:05.000Z', kind
});

describe('IndexedDB outbox', () => {
  const outbox = new Outbox();

  afterEach(async () => {
    await outbox.clear();
  });

  it('migrates existing version 1 records into the persistent seen set', async () => {
    const open = indexedDB.open('x-saved-extension', 1);
    await new Promise<void>((resolve, reject) => {
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('outbox', { keyPath: 'dedupe_key' });
        store.createIndex('created_at', 'created_at', { unique: false });
      };
      open.onerror = () => reject(open.error ?? new Error('Unable to create legacy database'));
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction('outbox', 'readwrite');
        transaction.objectStore('outbox').add({ dedupe_key: 'like:legacy', item: item('like', 'legacy'), created_at: '2025-01-01T00:00:00.000Z', attempts: 0 });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to seed legacy database'));
      };
    });

    expect(await outbox.put(item('like', 'legacy'))).toBe('known');
    expect(await outbox.count()).toBe(1);
  });

  it('deduplicates by kind and tweet id while keeping like and bookmark separate', async () => {
    expect(await outbox.put(item('like'))).toBe('new');
    expect(await outbox.put(item('like'))).toBe('known');
    expect(await outbox.put(item('bookmark'))).toBe('new');
    expect((await outbox.list(100)).map((record) => record.dedupe_key).sort()).toEqual(['bookmark:42', 'like:42']);
  });

  it('removes only explicitly accepted keys and retains the rest', async () => {
    await outbox.put(item('like', '1'));
    await outbox.put(item('like', '2'));
    await outbox.remove(['like:1']);
    expect((await outbox.list(100)).map((record) => record.dedupe_key)).toEqual(['like:2']);
    await outbox.markAttempt(['like:2'], 'offline');
    expect((await outbox.list(100))[0]?.last_error).toBe('offline');
  });

  it('keeps an item known after its acknowledged outbox record is removed', async () => {
    await outbox.put(item('like', '3'));
    await outbox.remove(['like:3']);

    expect(await outbox.put(item('like', '3'))).toBe('known');
    expect(await outbox.count()).toBe(0);
  });
});
