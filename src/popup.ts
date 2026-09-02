import type { ExtensionSettings, Status } from './types';

type Response = { ok: boolean; error?: string; [key: string]: unknown };

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
};

async function message<T extends Response>(value: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(value) as T;
  if (!response?.ok) throw new Error(response?.error ?? 'Extension request failed');
  return response;
}

function show(text: string): void { $('message').textContent = text; }

function render(status: Status): void {
  $('captured').textContent = String(status.captured);
  $('new').textContent = String(status.new);
  $('known').textContent = String(status.known);
  $('consecutive-known').textContent = String(status.consecutiveKnown);
  $('pending').textContent = String(status.pending);
  $('last-sync').textContent = status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never';
}

async function refresh(): Promise<void> {
  const response = await message<Status & Response>({ type: 'GET_STATUS' });
  render(response);
}

function permissionPattern(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/*`;
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const settings: ExtensionSettings = {
    receiverUrl: $<HTMLInputElement>('receiver-url').value.trim(),
    receiverToken: $<HTMLInputElement>('receiver-token').value
  };
  const button = $('settings-form').querySelector<HTMLButtonElement>('button');
  if (button) button.disabled = true;
  try {
    const origin = permissionPattern(settings.receiverUrl);
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error('Receiver host permission was not granted');
    await message({ type: 'SET_SETTINGS', settings });
    show('Settings saved.');
  } catch (error) {
    show(error instanceof Error ? error.message : 'Unable to save settings');
  } finally {
    if (button) button.disabled = false;
  }
}

async function sync(): Promise<void> {
  const button = $<HTMLButtonElement>('sync');
  button.disabled = true;
  show('Syncing…');
  try {
    const result = await message<{ accepted: number; pending: number } & Response>({ type: 'SYNC' });
    show(`Accepted ${result.accepted}; ${result.pending} pending.`);
    await refresh();
  } catch (error) {
    show(error instanceof Error ? error.message : 'Sync failed');
    await refresh().catch(() => undefined);
  } finally {
    button.disabled = false;
  }
}

async function start(): Promise<void> {
  try {
    const settings = await message<ExtensionSettings & Response>({ type: 'GET_SETTINGS' });
    $<HTMLInputElement>('receiver-url').value = settings.receiverUrl;
    $<HTMLInputElement>('receiver-token').value = settings.receiverToken;
    await refresh();
  } catch (error) {
    show(error instanceof Error ? error.message : 'Unable to load status');
  }
  $('settings-form').addEventListener('submit', (event) => void save(event));
  $('sync').addEventListener('click', () => void sync());
}

void start();
