# X Saved Extension

A small Manifest V3 Chrome extension that observes rendered X tweet DOM and puts Like / Bookmark captures into a local IndexedDB outbox. It does not read cookies or tokens, call X APIs, patch page JavaScript, scroll, or click.

## Build and test

```sh
npm install
npm run lint
npm test
npm run build
```

The unpacked extension is created in `dist/`.

## Load unpacked

1. Run `npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this repository's `dist/` directory.
4. Open the extension popup and configure the complete receiver URL.
5. Chrome asks for permission to connect to the configured receiver host. Grant it only for the Tailnet receiver.

The receiver URL is stored in `chrome.storage.local`; treat the local Chrome profile as sensitive.

## Capture behavior

- `/i/bookmarks` and `/<account>/likes` are observed with an isolated content script. Tweets are captured when their rendered article appears, so manual scrolling can be used for historical backfill.
- A click on Like or Bookmark is captured only after the article changes from `like` to `unlike` or `bookmark` to `removeBookmark`.
- Tweet data is normalized to `tweet_id`, `text`, `author`, `url`, `created_at`, `kind` (`like` or `bookmark`), and optional `media`. Image and video presence comes only from the owning article's DOM. Avatars, emoji/icons, link cards, quoted/nested Tweets, and video poster images are excluded. GIFs rendered as video are recorded as `video`, without guessing a separate taxonomy. Positions are zero-based DOM order across image/video; image `alt` is kept when available. Media-parser failure does not lose the Tweet capture.
- Before persistence, captures must satisfy the receiver's strict item schema: a positive 1–20 digit Tweet ID, bounded text, a matching X status URL, a valid handle (matching the URL case-insensitively), and a valid timezone-bearing ISO timestamp. Author/timestamp may be omitted or empty. Unknown fields and invalid captures, including display-name fallbacks such as `Alice Smith 🐉`, are rejected before they can block an outbox batch. This does not rewrite records already stored by older versions.
- The service worker stores `kind:tweet_id` and accumulated media in persistent IndexedDB `seen`, alongside the outbox item in one transaction. Existing v2 text-only seen records need no reset/migration: media newly observed on a known Tweet updates its outbox record and is synced again. Content-script `sent`/`inFlight` use normalized media signatures too, so no layer permanently blocks enrichment. Unchanged media, responsive image `name` size changes, or omitted/partial media do not trigger endless re-enqueue. New media or alt/source enrichment does. Unlike / unbookmark never deletes history.
- The outbox keeps one pending record per `kind:tweet_id`, merging media into it. An older in-flight ACK only removes the record if its media signature still matches the capture that was sent; otherwise enriched contents stay pending for the next batch. The wire ACK keys remain unchanged.
- After IndexedDB commits, the service worker schedules best-effort automatic sync. Captures arriving within 500 ms are coalesced; continuous scrolling does not postpone the first batch indefinitely.
- Automatic sync and the popup's `Sync pending items` share one in-flight operation. Pending records are drained in batches of at most 50; a partial ACK stops the drain and leaves unacknowledged records for a later trigger.
- Requests time out after 15 seconds. Network/server failures leave records pending for a later capture or manual sync; there is no retry scheduler. Service-worker suspension may delay automatic delivery, but cannot erase pending records.
- The popup reports captured/new/known/consecutive-known counts and pending outbox size.

For initial backfill, open the Likes or Bookmarks page and manually scroll at a normal pace. For **media backfill**, deploy the companion receiver update first (an older strict receiver rejects media), reload the extension and existing X tabs, then revisit and scroll through already-known Tweets too. Do not stop just because their text was captured previously. New media enrichment counts as `new` in the popup; unchanged media counts as `known`. Neither SQLite migration nor an IndexedDB reset can reconstruct unobserved media. The extension never auto-scrolls or auto-stops.

## Receiver protocol

Configure the full HTTPS POST endpoint (for example `https://host.tailnet.ts.net:8443/v1/x-saved/items`). The [my-discord-agent receiver](https://github.com/shin902/my-discord-agent/blob/main/docs/x-saved.md#live-capture-setup) binds to localhost and is exposed only through Tailscale Serve. The Tailnet is the network boundary; no application bearer token is needed. Do not use Funnel or expose the receiver publicly. The extension sends:

```json
{
  "items": [{
    "tweet_id": "123",
    "text": "...",
    "author": "@alice",
    "url": "https://x.com/alice/status/123",
    "created_at": "2025-01-02T03:04:05.000Z",
    "kind": "like",
    "media": [
      { "kind": "image", "position": 0, "source_url": "https://pbs.twimg.com/media/Abc?format=jpg&name=small", "alt_text": "A diagram" },
      { "kind": "video", "position": 1 }
    ]
  }],
  "idempotency_key": "<random-request-id>"
}
```

`media` is optional. Entries accept only `image` or `video`, integer positions 0–15, and unique `(kind, position)` keys (at most 32 entries for accumulated observations). Image sources must be HTTPS on exactly `pbs.twimg.com`, with `/media/<identifier>` (letters/digits/underscore/hyphen, optional extension), no credentials, non-default port or fragment, and at most 2,048 characters. Image `alt_text` is optional, at most 10,000 characters. Video entries have no `source_url` or extra fields: blob/MP4/HLS URLs are never captured. Both extension and receiver reject invalid media and unknown fields before persistence; mirrored contract fixtures test this boundary.

The Mac is a **sensor**, not a downloader. The companion server stores `x_items`, `x_item_state`, and `x_media` in one SQLite transaction, then ACKs. Its separate `x-saved-media-download` host cron downloads only images directly from `pbs.twimg.com` (orig first, original source fallback), saving relative filesystem paths for the sandbox's `x-saved` skill / `read` tool. Download failures do not fail Tweet ingest. Video metadata stays pending for future processing using the stored Tweet URL; video downloads/resolution are out of scope. There is no image binary upload or Mac-side download.

After the receiver commits its database transaction, it must return HTTP 2xx JSON with an `accepted` array containing the accepted outbox keys (for example `like:123`). For a non-empty batch, an empty or invalid `accepted` array is treated as a failed sync, recorded as an attempt, and leaves every item pending. An item not named in `accepted` is not removed. Network failures and rejected items remain in IndexedDB for a later retry. The receiver should independently merge by `tweet_id` and sticky Like / Bookmark flags.

## Security and privacy

The content script is `ISOLATED` by Chrome's default content-script execution world and uses DOM selectors only. There are no `host_permissions` for X network calls and no `fetch`/XHR interception. Optional broad HTTP(S) permission is requested only after the user enters a receiver host, to support Tailnet IPs and MagicDNS names; use a Tailnet-only URL and do not expose the receiver publicly. The extension sends only rendered tweet fields to that receiver.

X can change its DOM selectors, and optimistic UI does not prove server-side success. Media absence in a capture means "not observed", not proof of absence. Automated DOM/IndexedDB/sync tests cover enrichment and stale-ACK races, but deployment still needs a real Chrome/manual-scroll check. No video downloader/resolver, X API, GraphQL hook, browser credentials, generic provider/queue framework, OCR, or image classification is included.
