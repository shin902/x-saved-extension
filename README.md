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
- Tweet data is normalized to `tweet_id`, `text`, `author`, `url`, `created_at`, and `kind` (`like` or `bookmark`).
- The service worker stores `kind:tweet_id` in a persistent IndexedDB seen set before upload, alongside the first outbox record in one transaction. ACKed outbox records can be removed without making later observations new again. Unlike / unbookmark never deletes history.
- After IndexedDB commits, the service worker schedules best-effort automatic sync. Captures arriving within 500 ms are coalesced; continuous scrolling does not postpone the first batch indefinitely.
- Automatic sync and the popup's `Sync pending items` share one in-flight operation. Pending records are drained in batches of at most 50; a partial ACK stops the drain and leaves unacknowledged records for a later trigger.
- Requests time out after 15 seconds. Network/server failures leave records pending for a later capture or manual sync; there is no retry scheduler. Service-worker suspension may delay automatic delivery, but cannot erase pending records.
- The popup reports captured/new/known/consecutive-known counts and pending outbox size.

For initial backfill, open the Likes or Bookmarks page, manually scroll at a normal pace, and stop when the popup's consecutive-known count indicates that previously seen records are being reached. The extension never auto-scrolls or auto-stops.

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
    "kind": "like"
  }],
  "idempotency_key": "<random-request-id>"
}
```

After the receiver commits its database transaction, it must return HTTP 2xx JSON with an `accepted` array containing the accepted outbox keys (for example `like:123`). For a non-empty batch, an empty or invalid `accepted` array is treated as a failed sync, recorded as an attempt, and leaves every item pending. An item not named in `accepted` is not removed. Network failures and rejected items remain in IndexedDB for a later retry. The receiver should independently merge by `tweet_id` and sticky Like / Bookmark flags.

## Security and privacy

The content script is `ISOLATED` by Chrome's default content-script execution world and uses DOM selectors only. There are no `host_permissions` for X network calls and no `fetch`/XHR interception. Optional broad HTTP(S) permission is requested only after the user enters a receiver host, to support Tailnet IPs and MagicDNS names; use a Tailnet-only URL and do not expose the receiver publicly. The extension sends only rendered tweet fields to that receiver.

This is an MVP: X can change its DOM selectors, optimistic UI does not prove server-side success, and media enrichment/download is intentionally not included.
