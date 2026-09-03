import type { CaptureStats, ExtensionSettings, Status } from './types';
import { Outbox } from './outbox';

export const DEFAULT_SETTINGS: ExtensionSettings = { receiverUrl: '' };
export const DEFAULT_STATS: CaptureStats = {
  captured: 0,
  new: 0,
  known: 0,
  consecutiveKnown: 0,
  lastSync: null
};

// Service-worker events can overlap; serialize read/modify/write stats updates.
let statsQueue: Promise<unknown> = Promise.resolve();

function get<T extends object>(defaults: T): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (values) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(values as T);
    });
  });
}

function set(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const values = await get({ settings: DEFAULT_SETTINGS });
  const settings = (values as { settings?: Partial<ExtensionSettings> }).settings;
  const migratedSettings = { receiverUrl: settings?.receiverUrl ?? DEFAULT_SETTINGS.receiverUrl };

  // Rewrite legacy settings so an old bearer token is not retained in storage.
  if (settings && Object.keys(settings).some((key) => key !== 'receiverUrl')) {
    await set({ settings: migratedSettings });
  }
  return migratedSettings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await set({ settings: { receiverUrl: settings.receiverUrl } });
}

export async function getStats(): Promise<CaptureStats> {
  const values = await get({ stats: DEFAULT_STATS });
  return { ...DEFAULT_STATS, ...(values as { stats?: Partial<CaptureStats> }).stats };
}

export function recordCapture(isNew: boolean): Promise<CaptureStats> {
  const operation = statsQueue.then(async () => {
    const stats = await getStats();
    const next: CaptureStats = {
      ...stats,
      captured: stats.captured + 1,
      new: stats.new + (isNew ? 1 : 0),
      known: stats.known + (isNew ? 0 : 1),
      consecutiveKnown: isNew ? 0 : stats.consecutiveKnown + 1
    };
    await set({ stats: next });
    return next;
  });
  statsQueue = operation.catch(() => undefined);
  return operation;
}

export function recordSync(): Promise<void> {
  const operation = statsQueue.then(async () => {
    const stats = await getStats();
    await set({ stats: { ...stats, lastSync: new Date().toISOString() } });
  });
  statsQueue = operation.catch(() => undefined);
  return operation;
}

export async function getStatus(outbox: Outbox): Promise<Status> {
  return { ...(await getStats()), pending: await outbox.count() };
}
