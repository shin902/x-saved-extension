import { expect, it } from 'vitest';
import { isSavedItem } from '../src/saved-item';
import cases from './browser-items.fixture.json';
import mediaCases from './media.fixture.json';

// The same fixture is exercised against the real HTTP receiver in my-discord-agent.
it.each(cases)('$name: matches the receiver contract', ({ item, valid }) => {
  expect(isSavedItem(item)).toBe(valid);
});

it.each(mediaCases)('$name: matches receiver media validation', ({ media, valid }) => {
  expect(isSavedItem({ ...cases[0]?.item, ...(media === undefined ? {} : { media }) })).toBe(valid);
});

it('bounds media and alt text', () => {
  const image = { kind: 'image', position: 0, source_url: 'https://pbs.twimg.com/media/a' };
  expect(isSavedItem({ ...cases[0]?.item, media: [{ ...image, alt_text: 'a'.repeat(10_001) }] })).toBe(false);
  expect(isSavedItem({ ...cases[0]?.item, media: Array(33).fill(image) })).toBe(false);
});

it('rejects oversized text before persistence', () => {
  const item = cases[0]?.item;
  expect(isSavedItem({ ...item, text: 'x'.repeat(100_000) })).toBe(true);
  expect(isSavedItem({ ...item, text: 'x'.repeat(100_001) })).toBe(false);
});
