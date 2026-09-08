import { expect, it } from 'vitest';
import { isSavedItem } from '../src/saved-item';
import cases from './browser-items.fixture.json';

// The same fixture is exercised against the real HTTP receiver in my-discord-agent.
it.each(cases)('$name: matches the receiver contract', ({ item, valid }) => {
  expect(isSavedItem(item)).toBe(valid);
});

it('rejects oversized text before persistence', () => {
  const item = cases[0]?.item;
  expect(isSavedItem({ ...item, text: 'x'.repeat(100_000) })).toBe(true);
  expect(isSavedItem({ ...item, text: 'x'.repeat(100_001) })).toBe(false);
});
