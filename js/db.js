// IndexedDB wrapper — stores: items, wears, packs, settings
const DB_NAME = 'styleme';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('wears')) db.createObjectStore('wears', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  }));
}

export async function putRecord(store, value) {
  await tx(store, 'readwrite', s => s.put(value));
  return value;
}

export async function deleteRecord(store, id) {
  await tx(store, 'readwrite', s => s.delete(id));
}

export function getAllRecords(store) {
  return open().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export async function getSetting(key) {
  const rows = await getAllRecords('settings');
  const row = rows.find(r => r.key === key);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  await putRecord('settings', { key, value });
}

export async function clearStore(store) {
  await tx(store, 'readwrite', s => s.clear());
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
