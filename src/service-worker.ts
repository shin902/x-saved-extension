import { dedupeKey } from './dom-parser';
import { Outbox } from './outbox';
import { isSavedItem } from './saved-item';
import { getSettings, getStatus, recordCapture, saveSettings } from './storage';
import { SyncCoordinator } from './sync';
import type { ExtensionMessage, ExtensionSettings } from './types';

const outbox = new Outbox();
const sync = new SyncCoordinator(outbox);

function validSettings(settings: ExtensionSettings): ExtensionSettings {
  const url = new URL(settings.receiverUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Receiver URL must use http or https');
  if (url.username || url.password) throw new Error('Receiver URL must not contain credentials');
  return { receiverUrl: url.toString() };
}

async function handle(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'CAPTURE_ITEM': {
      if (!isSavedItem(message.item)) throw new Error('Invalid capture item');
      // Reading the key here keeps the dedupe contract explicit; IndexedDB remains the authority.
      const key = dedupeKey(message.item);
      const result = await outbox.put(message.item);
      sync.schedule();
      const stats = await recordCapture(result === 'new');
      return { stored: true, dedupe_key: key, result, stats };
    }
    case 'GET_STATUS':
      return getStatus(outbox);
    case 'GET_SETTINGS':
      return getSettings();
    case 'SET_SETTINGS': {
      const settings = validSettings(message.settings);
      await saveSettings(settings);
      return { saved: true };
    }
    case 'SYNC':
      return sync.sync();
    default:
      throw new Error('Unknown message');
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handle(message as ExtensionMessage)
    .then((response) => sendResponse({ ok: true, ...((response ?? {}) as object) }))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Request failed',
      }),
    );
  return true;
});
