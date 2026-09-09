import { actionKind, articleFor, isSelected, pageKind, parseTweetArticle } from './dom-parser';
import { enrichMedia, mediaSignature } from './media';
import type { CaptureMessage, SavedItem, SavedMedia } from './types';

const sent = new Map<string, SavedMedia[]>();
const inFlight = new Set<string>();

function send(item: SavedItem, key: string, signatureKey: string): void {
  inFlight.add(signatureKey);
  const message: CaptureMessage = { type: 'CAPTURE_ITEM', item };
  // The service worker owns persistence; this message contains item data only.
  chrome.runtime
    .sendMessage(message)
    .then((response: { ok?: boolean; stored?: boolean } | undefined) => {
      inFlight.delete(signatureKey);
      if (response?.ok && response.stored) sent.set(key, enrichMedia(sent.get(key), item.media));
    })
    .catch(() => {
      inFlight.delete(signatureKey);
      // Do not mark the item as sent: a later DOM observation can retry it.
    });
}

function captureArticle(article: Element, kind: SavedItem['kind']): void {
  const item = parseTweetArticle(article, kind);
  if (!item) return;
  const key = `${item.kind}:${item.tweet_id}`;
  const media = enrichMedia(sent.get(key), item.media);
  const signature = mediaSignature(media);
  const signatureKey = `${key}:${signature}`;
  if ((sent.has(key) && mediaSignature(sent.get(key)) === signature) || inFlight.has(signatureKey)) return;
  send({ ...item, ...(media.length ? { media } : {}) }, key, signatureKey);
}

function scan(): void {
  const kind = pageKind();
  if (!kind) return;
  document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => captureArticle(article, kind));
}

function observeActions(): void {
  document.addEventListener(
    'click',
    (event) => {
      const kind = actionKind(event.target);
      const article = articleFor(event.target);
      if (!kind || !article || isSelected(article, kind)) return;

      // X updates these testids after the click. Capture only a false -> true transition.
      window.setTimeout(() => {
        if (!isSelected(article, kind)) return;
        captureArticle(article, kind);
      }, 350);
    },
    true
  );
}

function start(): void {
  scan();
  observeActions();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'alt', 'data-testid'],
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
