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
- Dedupe remains `kind:tweet_id` only: content-script `sent`/`inFlight`, persistent IndexedDB `seen`, and outbox retain their original behavior. The worker commits a new seen key and its original payload together. Known keys do not re-enqueue or mutate pending payloads when media changes; there are no media signatures or accumulated-media seen records. Unlike / unbookmark never deletes history.
- The outbox keeps one original pending capture per `kind:tweet_id`; accepted ACK keys remove those records. Media does not introduce a new ACK or replay protocol.
- After IndexedDB commits, the service worker schedules best-effort automatic sync. Captures arriving within 500 ms are coalesced; continuous scrolling does not postpone the first batch indefinitely.
- Automatic sync and the popup's `Sync pending items` share one in-flight operation. Pending records are drained in batches of at most 50; a partial ACK stops the drain and leaves unacknowledged records for a later trigger.
- Requests time out after 15 seconds. Network/server failures leave records pending for a later capture or manual sync; there is no retry scheduler. Service-worker suspension may delay automatic delivery, but cannot erase pending records.
- The popup reports captured/new/known/consecutive-known counts and pending outbox size.

For initial collection of unknown Tweet IDs, open Likes or Bookmarks and manually scroll at a normal pace. Deploy the companion receiver before updating/reloading the extension and existing X tabs (an older strict receiver rejects media payloads). **Tweet ID is the canonical locator**: missing/partial media is backfilled server-side through FxTwitter, independently of browser dedupe. Known Tweets remain `known` even when their rendered media changes. Media backfill requires neither browser re-scrolling nor IndexedDB resets; the extension never auto-scrolls or auto-stops.

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

`media` is optional. Entries accept only `image` or `video`, integer positions 0–15, and unique `(kind, position)` keys (at most 32 entries). Image sources must be HTTPS on exactly `pbs.twimg.com`, with `/media/<identifier>` (letters/digits/underscore/hyphen, optional extension), no credentials, non-default port or fragment, and at most 2,048 characters. Image `alt_text` is optional, at most 10,000 characters. Video entries have no `source_url` or extra fields: blob/MP4/HLS URLs are never captured. Both extension and receiver reject invalid media and unknown fields before persistence; mirrored contract fixtures test this boundary.

The Mac is a **sensor**, not a resolver/downloader. Natural DOM media metadata is attached only to the initial capture as a best-effort hint. The companion server stores `x_items`, `x_item_state`, and `x_media` transactionally, then ACKs. Its `x-saved-media-resolve` host cron uses only Tweet ID with FxTwitter to fill missing media, including old text-only/partial captures; a successful empty result is distinguished from unresolved data. FxTwitter availability limits resolution of deleted/private Tweets. The separate `x-saved-media-download` cron downloads only images directly from `pbs.twimg.com` (orig first, original source fallback), saving paths for sandbox `x-saved` / `read`. Neither resolution nor download failure invalidates Tweet ingest. Video existence is recorded, but video file download/playback URL resolution is out of scope. No image binary upload or Mac-side download is added.

After the receiver commits its database transaction, it must return HTTP 2xx JSON with an `accepted` array containing the accepted outbox keys (for example `like:123`). For a non-empty batch, an empty or invalid `accepted` array is treated as a failed sync, recorded as an attempt, and leaves every item pending. An item not named in `accepted` is not removed. Network failures and rejected items remain in IndexedDB for a later retry. The receiver should independently merge by `tweet_id` and sticky Like / Bookmark flags.

## Security and privacy

The content script is `ISOLATED` by Chrome's default content-script execution world and uses DOM selectors only. There are no `host_permissions` for X network calls and no `fetch`/XHR interception. Optional broad HTTP(S) permission is requested only after the user enters a receiver host, to support Tailnet IPs and MagicDNS names; use a Tailnet-only URL and do not expose the receiver publicly. The extension sends only rendered tweet fields to that receiver.

X can change its DOM selectors, and optimistic UI does not prove server-side success. Media absence in a capture means "not observed", not proof of absence. Automated DOM/IndexedDB/sync tests verify initial metadata capture and unchanged key-only dedupe even when media changes; server tests verify backfill without browser replay. Deployment still needs a real Chrome capture check. No video downloader, browser X API/GraphQL hook, browser credentials, generic provider/queue framework, OCR, or image classification is included.
