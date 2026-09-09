import type { SavedMedia } from './types';

/** Shared with the receiver; no arbitrary fetch targets or transient video URLs. */
export function isImageSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      url.hostname === 'pbs.twimg.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/media\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function imageIdentity(value: string): string {
  const url = new URL(value);
  // Responsive DOM sizes are not new image content.
  url.searchParams.delete('name');
  url.searchParams.sort();
  return url.toString();
}

export function mediaSignature(media: readonly SavedMedia[] = []): string {
  return JSON.stringify(
    [...media]
      .sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind))
      .map((entry) =>
        entry.kind === 'image'
          ? [entry.kind, entry.position, imageIdentity(entry.source_url), entry.alt_text || '']
          : [entry.kind, entry.position]
      )
  );
}

/** Omission/partial DOM observations never retract previously captured media. */
export function enrichMedia(previous: readonly SavedMedia[] = [], incoming: readonly SavedMedia[] = []): SavedMedia[] {
  const entries = new Map(previous.map((entry) => [`${entry.kind}:${entry.position}`, entry]));
  for (const entry of incoming) {
    const key = `${entry.kind}:${entry.position}`;
    const old = entries.get(key);
    entries.set(
      key,
      entry.kind === 'image' && old?.kind === 'image'
        ? { ...entry, ...(entry.alt_text || old.alt_text ? { alt_text: entry.alt_text || old.alt_text } : {}) }
        : entry
    );
  }
  return [...entries.values()].sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind));
}
