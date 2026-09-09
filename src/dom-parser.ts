import type { CaptureKind, SavedItem, SavedMedia } from './types';
import { isImageSourceUrl } from './media';

const STATUS_PATH = /\/status\/(\d+)(?:\/|$)/;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function statusUrl(article: Element): { id: string; url: string } | null {
  const links = article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
  for (const link of links) {
    try {
      const parsed = new URL(link.href, document.baseURI);
      const match = parsed.pathname.match(STATUS_PATH);
      if (match?.[1]) {
        return { id: match[1], url: `https://x.com${parsed.pathname}` };
      }
    } catch {
      // Ignore malformed links injected by the page.
    }
  }
  return null;
}

function authorName(article: Element): string {
  const area = article.querySelector('[data-testid="User-Name"]');
  const value = clean(area?.textContent ?? '');
  const handle = value.match(/@[A-Za-z0-9_]{1,15}/)?.[0];
  return handle ?? value;
}

const VIDEO = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';

/** Only the owning tweet's media, not quoted posts, cards, or avatars. */
export function parseTweetMedia(article: Element, tweetId: string): SavedMedia[] {
  const media: SavedMedia[] = [];
  const slots = new Set<Element>();
  const photo = '[data-testid="tweetPhoto"]';
  const candidates = article.querySelectorAll<HTMLElement>(`img, ${photo}, video, ${VIDEO}`);
  for (const element of candidates) {
    if (slots.size >= 16) break;
    if (
      element.closest('article') !== article ||
      element.closest('[data-testid="card.wrapper"], [data-testid^="UserAvatar"]')
    )
      continue;
    let quoted = false;
    for (let parent: Element | null = element; parent && parent !== article; parent = parent.parentElement) {
      if (parent.matches('a[href], [role="link"]')) {
        const links = parent.matches('a[href]') ? [parent] : [...parent.querySelectorAll('a[href*="/status/"]')];
        if (
          links.some((link) => {
            const id = link.getAttribute('href')?.match(STATUS_PATH)?.[1];
            return id && id !== tweetId;
          })
        )
          quoted = true;
      }
    }
    if (quoted) continue;
    if (element.tagName === 'IMG' || element.matches(photo)) {
      const owner = element.closest(photo) ?? element;
      if (element.closest(VIDEO) || owner.querySelector(VIDEO) || slots.has(owner)) continue;
      const image = element.tagName === 'IMG' ? (element as HTMLImageElement) : element.querySelector('img');
      const source = image?.currentSrc || image?.src || '';
      // Keep a visible photo slot even before its lazy-loaded src arrives,
      // so subsequent images do not move to different persisted positions.
      if (!owner.matches(photo) && !isImageSourceUrl(source)) continue;
      const position = slots.size;
      slots.add(owner);
      if (!isImageSourceUrl(source)) continue;
      const alt = image?.getAttribute('alt');
      media.push({ kind: 'image', position, source_url: source, ...(alt ? { alt_text: alt.slice(0, 10_000) } : {}) });
    } else {
      // A component can contain player + video + poster: retain one video slot.
      const owner =
        element.closest('[data-testid="videoComponent"]') ?? element.closest('[data-testid="videoPlayer"]') ?? element;
      if (slots.has(owner)) continue;
      const position = slots.size;
      slots.add(owner);
      media.push({ kind: 'video', position });
    }
  }
  return media;
}

/** Normalize only data rendered in a tweet article; this function never performs I/O. */
export function parseTweetArticle(article: Element, kind: CaptureKind): SavedItem | null {
  const status = statusUrl(article);
  if (!status) return null;

  const text = clean(article.querySelector('[data-testid="tweetText"]')?.textContent ?? '');
  const author = authorName(article);
  const time = article.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime ?? '';
  if (!author || !time) return null;

  let media: SavedMedia[] = [];
  try {
    media = parseTweetMedia(article, status.id);
  } catch {
    // Media is best-effort; a DOM/parser failure must not lose the Tweet.
  }
  return {
    ...(media.length ? { media } : {}),
    tweet_id: status.id,
    text,
    author,
    url: status.url,
    created_at: time,
    kind,
  };
}

export function pageKind(location: Pick<Location, 'pathname'> = window.location): CaptureKind | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (/(?:^|\/)bookmarks$/.test(path)) return 'bookmark';
  if (/(?:^|\/)likes$/.test(path)) return 'like';
  return null;
}

export function dedupeKey(item: Pick<SavedItem, 'kind' | 'tweet_id'>): string {
  return `${item.kind}:${item.tweet_id}`;
}

export function articleFor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('article[data-testid="tweet"]');
}

export function actionKind(target: EventTarget | null): CaptureKind | null {
  if (!(target instanceof Element)) return null;
  const action = target.closest(
    '[data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="removeBookmark"]'
  );
  if (!action) return null;
  const testId = action.getAttribute('data-testid');
  if (testId === 'like' || testId === 'unlike') return 'like';
  if (testId === 'bookmark' || testId === 'removeBookmark') return 'bookmark';
  return null;
}

export function isSelected(article: Element, kind: CaptureKind): boolean {
  const selected = kind === 'like' ? 'unlike' : 'removeBookmark';
  return Boolean(article.querySelector(`[data-testid="${selected}"]`));
}
