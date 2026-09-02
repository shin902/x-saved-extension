import type { OutboxRecord, SavedItem } from './types';
import { dedupeKey } from './dom-parser';

const DB_NAME = 'x-saved-extension';
const DB_VERSION = 1;
const STORE = 'outbox';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class Outbox {
  private database?: Promise<IDBDatabase>;

  constructor(private readonly indexedDB: IDBFactory = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const open = this.indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const database = open.result;
          const store = database.createObjectStore(STORE, { keyPath: 'dedupe_key' });
          store.createIndex('created_at', 'created_at', { unique: false });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Unable to open IndexedDB'));
      });
    }
    return this.database;
  }

  async put(item: SavedItem): Promise<'new' | 'known'> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    const key = dedupeKey(item);
    const existing = await request<OutboxRecord | undefined>(store.get(key));
    if (existing) {
      await done;
      return 'known';
    }
    store.add({
      dedupe_key: key,
      item,
      created_at: new Date().toISOString(),
      attempts: 0
    } satisfies OutboxRecord);
    await done;
    return 'new';
  }

  async list(limit: number): Promise<OutboxRecord[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const done = transactionDone(transaction);
    const index = transaction.objectStore(STORE).index('created_at');
    const records = await request<OutboxRecord[]>(index.getAll(undefined, limit));
    await done;
    return records;
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    for (const key of keys) store.delete(key);
    await done;
  }

  async markAttempt(keys: string[], error: string): Promise<void> {
    if (keys.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    for (const key of keys) {
      const record = await request<OutboxRecord | undefined>(store.get(key));
      if (record) store.put({ ...record, attempts: record.attempts + 1, last_error: error });
    }
    await done;
  }

  async count(): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const done = transactionDone(transaction);
    const count = await request<number>(transaction.objectStore(STORE).count());
    await done;
    return count;
  }
}
