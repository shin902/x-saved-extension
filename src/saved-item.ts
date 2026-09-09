import { z } from 'zod/mini';
import type { SavedItem } from './types';
import { isImageSourceUrl } from './media';

const position = z.number().check(z.int(), z.minimum(0), z.maximum(15));
const SavedMediaSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('image'),
        position,
        source_url: z.string().check(z.refine(isImageSourceUrl)),
        alt_text: z.optional(z.string().check(z.maxLength(10_000))),
      }),
      z.strictObject({ kind: z.literal('video'), position }),
    ])
  )
  .check(
    z.maxLength(32),
    z.refine(
      (media) => new Set(media.map((entry) => `${entry.kind}:${entry.position}`)).size === media.length,
      'Media keys must be unique'
    )
  );

// Keep this wire contract aligned with my-discord-agent's BrowserItemSchema.
const SavedItemSchema = z
  .strictObject({
    tweet_id: z.string().check(z.regex(/^[1-9][0-9]{0,19}$/)),
    text: z.string().check(z.maxLength(100_000)),
    author: z.optional(z.string().check(z.regex(/^@?[A-Za-z0-9_]{1,15}$|^$/))),
    url: z.string().check(z.maxLength(200)),
    created_at: z.optional(z.union([z.iso.datetime({ offset: true }), z.literal('')])),
    kind: z.enum(['like', 'bookmark']),
    media: z.optional(SavedMediaSchema),
  })
  .check(
    z.refine((item) => {
      const match = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)$/.exec(item.url);
      return (
        match?.[2] === item.tweet_id &&
        (!item.author || item.author.replace(/^@/, '').toLowerCase() === match[1]?.toLowerCase())
      );
    }, 'URL must match tweet_id and any supplied author')
  );

export function isSavedItem(value: unknown): value is SavedItem {
  return SavedItemSchema.safeParse(value).success;
}
