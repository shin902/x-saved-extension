import type { CaptureKind, SavedItem } from './types';

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function statusUrl(article: Element): { id: string; url: string } | null {
  const links = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')];
  const timestampLink = article.querySelector<HTMLTimeElement>('time[datetime]')?.closest<HTMLAnchorElement>('a[href]');
  if (timestampLink) links.unshift(timestampLink);

  for (const link of links) {
    try {
      const parsed = new URL(link.href, document.baseURI);
      const match = parsed.pathname.match(STATUS_PATH);
      if (match?.[1] && match[2]) {
        return { id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` };
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

/** Normalize only data rendered in a tweet article; this function never performs I/O. */
export function parseTweetArticle(article: Element, kind: CaptureKind): SavedItem | null {
  const status = statusUrl(article);
  if (!status) return null;

  const text = clean(article.querySelector('[data-testid="tweetText"]')?.textContent ?? '');
  const author = authorName(article);
  const time = article.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime ?? '';
  if (!author || !time) return null;

  return {
    tweet_id: status.id,
    text,
    author,
    url: status.url,
    created_at: time,
    kind
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
  const action = target.closest('[data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="removeBookmark"]');
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
