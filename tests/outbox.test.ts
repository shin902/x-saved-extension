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
    await outbox.remove((await outbox.list(100)).map((record) => record.dedupe_key));
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
});
