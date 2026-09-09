export type CaptureKind = 'like' | 'bookmark';

export type SavedMedia =
  | { kind: 'image'; position: number; source_url: string; alt_text?: string }
  | { kind: 'video'; position: number };

export interface SavedItem {
  tweet_id: string;
  text: string;
  author?: string;
  url: string;
  created_at?: string;
  kind: CaptureKind;
  media?: SavedMedia[];
}

export interface OutboxRecord {
  dedupe_key: string;
  item: SavedItem;
  created_at: string;
  attempts: number;
  last_error?: string;
}

export interface ExtensionSettings {
  receiverUrl: string;
}

export interface CaptureStats {
  captured: number;
  new: number;
  known: number;
  consecutiveKnown: number;
  lastSync: string | null;
}

export interface Status extends CaptureStats {
  pending: number;
}

export interface CaptureMessage {
  type: 'CAPTURE_ITEM';
  item: SavedItem;
}

export interface SyncMessage {
  type: 'SYNC';
}
export interface GetStatusMessage {
  type: 'GET_STATUS';
}
export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}
export interface SetSettingsMessage {
  type: 'SET_SETTINGS';
  settings: ExtensionSettings;
}

export type ExtensionMessage =
  | CaptureMessage
  | SyncMessage
  | GetStatusMessage
  | GetSettingsMessage
  | SetSettingsMessage;
