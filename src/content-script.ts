import { actionKind, articleFor, isSelected, pageKind, parseTweetArticle } from './dom-parser';
import type { CaptureMessage, SavedItem } from './types';

const sent = new Set<string>();
const inFlight = new Set<string>();

function send(item: SavedItem, key: string): void {
  const runtime = chrome.runtime;
  // Reloading/updating the extension invalidates content scripts already attached
  // to open tabs. They cannot reconnect; the tab must load the new script.
  if (!runtime?.sendMessage) return;

  inFlight.add(key);
  const message: CaptureMessage = { type: 'CAPTURE_ITEM', item };
  try {
    // The service worker owns persistence; this message contains item data only.
    void runtime
      .sendMessage(message)
      .then((response: { ok?: boolean; stored?: boolean } | undefined) => {
        inFlight.delete(key);
        if (response?.ok && response.stored) sent.add(key);
      })
      .catch(() => {
        inFlight.delete(key);
        // Do not mark the item as sent: a later DOM observation can retry it.
      });
  } catch {
    inFlight.delete(key);
    // A synchronous failure means this content-script context was invalidated.
  }
}

function captureArticle(article: Element, kind: SavedItem['kind']): void {
  const item = parseTweetArticle(article, kind);
  if (!item) return;
  const key = `${item.kind}:${item.tweet_id}`;
  if (sent.has(key) || inFlight.has(key)) return;
  send(item, key);
}

function scan(): void {
  const kind = pageKind();
  if (!kind) return;
  document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => captureArticle(article, kind));
}

function observeActions(): void {
  document.addEventListener('click', (event) => {
    const kind = actionKind(event.target);
    const article = articleFor(event.target);
    if (!kind || !article || isSelected(article, kind)) return;

    // X updates these testids after the click. Capture only a false -> true transition.
    window.setTimeout(() => {
      if (!isSelected(article, kind)) return;
      const item = parseTweetArticle(article, kind);
      if (!item) return;
      const key = `${item.kind}:${item.tweet_id}`;
      if (sent.has(key) || inFlight.has(key)) return;
      send(item, key);
    }, 350);
  }, true);
}

function start(): void {
  scan();
  observeActions();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { subtree: true, childList: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
