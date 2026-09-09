import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { Outbox } from '../src/outbox';
import type { SavedItem } from '../src/types';

const item = (kind: SavedItem['kind'], tweet_id = '42'): SavedItem => ({
  tweet_id,
  text: 'text',
  author: '@alice',
  url: `https://x.com/alice/status/${tweet_id}`,
  created_at: '2025-01-02T03:04:05.000Z',
  kind,
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
        transaction.objectStore('outbox').add({
          dedupe_key: 'like:legacy',
          item: item('like', 'legacy'),
          created_at: '2025-01-01T00:00:00.000Z',
          attempts: 0,
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to seed legacy database'));
      };
    });

    expect(await outbox.put(item('like', 'legacy'))).toBe('known');
    expect(await outbox.count()).toBe(1);
    expect(await outbox.put({ ...item('like', 'legacy'), media: [{ kind: 'video', position: 0 }] })).toBe('new');
    expect((await outbox.list(1))[0]?.item.media).toEqual([{ kind: 'video', position: 0 }]);
  });

  it('enriches an ACKed legacy v2 seen record without clearing local state', async () => {
    const factory = new IDBFactory();
    const open = factory.open('x-saved-extension', 2);
    await new Promise<void>((resolve, reject) => {
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('outbox', { keyPath: 'dedupe_key' });
        store.createIndex('created_at', 'created_at', { unique: false });
        open.result.createObjectStore('seen', { keyPath: 'dedupe_key' }).add({ dedupe_key: 'like:42' });
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    const legacy = new Outbox(factory);
    expect(await legacy.put(item('like'))).toBe('known');
    expect(await legacy.count()).toBe(0);
    const enriched = { ...item('like'), media: [{ kind: 'video' as const, position: 0 }] };
    expect(await legacy.put(enriched)).toBe('new');
    await legacy.remove(await legacy.list(50));
    expect(await legacy.put(enriched)).toBe('known');
    expect(await legacy.count()).toBe(0);
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
    await outbox.remove((await outbox.list(50)).filter((record) => record.dedupe_key === 'like:1'));
    expect((await outbox.list(100)).map((record) => record.dedupe_key)).toEqual(['like:2']);
    await outbox.markAttempt(['like:2'], 'offline');
    expect((await outbox.list(100))[0]?.last_error).toBe('offline');
  });

  it('enriches an ACKed text-only Tweet, merges partial observations and suppresses unchanged media', async () => {
    const capture = item('like');
    await outbox.put(capture);
    await outbox.remove(await outbox.list(50));
    const image = {
      kind: 'image' as const,
      position: 0,
      source_url: 'https://pbs.twimg.com/media/one?format=jpg&name=small',
    };
    expect(await outbox.put({ ...capture, media: [image] })).toBe('new');
    await outbox.remove(await outbox.list(50));
    expect(await outbox.put({ ...capture, media: [image] })).toBe('known');
    expect(
      await outbox.put({ ...capture, media: [{ ...image, source_url: image.source_url.replace('small', 'large') }] })
    ).toBe('known');
    expect(await outbox.put(capture)).toBe('known');
    expect(await outbox.put({ ...capture, media: [] })).toBe('known');
    expect(await outbox.count()).toBe(0);
    expect(await outbox.put({ ...capture, media: [{ kind: 'video', position: 1 }] })).toBe('new');
    expect((await outbox.list(1))[0]?.item.media).toEqual([image, { kind: 'video', position: 1 }]);
    expect(await outbox.put({ ...capture, media: [{ ...image, alt_text: 'Diagram' }] })).toBe('new');
    expect(await outbox.put({ ...capture, media: [image] })).toBe('known');
    expect(await outbox.count()).toBe(1);
  });

  it('does not remove newly enriched pending contents with an older ACK', async () => {
    await outbox.put(item('like'));
    const sent = await outbox.list(50);
    await outbox.put({ ...item('like'), media: [{ kind: 'video', position: 0 }] });
    await outbox.remove(sent);
    expect(await outbox.count()).toBe(1);
    await outbox.remove(await outbox.list(50));
    expect(await outbox.count()).toBe(0);
  });

  it('keeps an item known after its acknowledged outbox record is removed', async () => {
    await outbox.put(item('like', '3'));
    await outbox.remove(await outbox.list(50));

    expect(await outbox.put(item('like', '3'))).toBe('known');
    expect(await outbox.count()).toBe(0);
  });
});
