// storage.js — IndexedDB persistence layer for agent data

const DB_NAME = 'agent-workbench';
const DB_VERSION = 1;
const LEGACY_KEY = 'agent-workbench-state';

let db = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Open (or create) the IndexedDB database. */
export async function open() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(e);
    }

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('agents')) {
        database.createObjectStore('agents', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(new Error('Failed to open IndexedDB'));
  });
}

/** Load all agents, sorted by stored agentOrder. */
export async function loadAllAgents() {
  const agents = await promisifyRequest(
    db.transaction('agents', 'readonly').objectStore('agents').getAll()
  );

  const orderRecord = await promisifyRequest(
    db.transaction('meta', 'readonly').objectStore('meta').get('agentOrder')
  );
  const order = orderRecord?.value || [];

  if (order.length > 0) {
    const orderMap = new Map(order.map((id, i) => [id, i]));
    agents.sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
      return ai - bi;
    });
  }

  return agents;
}

/** Load a single meta value by key. Returns the value or undefined. */
export async function loadMeta(key) {
  const record = await promisifyRequest(
    db.transaction('meta', 'readonly').objectStore('meta').get(key)
  );
  return record?.value;
}

/** Save (upsert) a single agent. */
export async function saveAgent(agent) {
  const tx = db.transaction('agents', 'readwrite');
  tx.objectStore('agents').put(agent);
  return promisifyTransaction(tx);
}

/** Save multiple agents in one transaction. */
export async function saveAgentsBatch(agents) {
  const tx = db.transaction('agents', 'readwrite');
  const store = tx.objectStore('agents');
  for (const agent of agents) store.put(agent);
  return promisifyTransaction(tx);
}

/** Delete an agent by ID. */
export async function deleteAgent(id) {
  const tx = db.transaction('agents', 'readwrite');
  tx.objectStore('agents').delete(id);
  return promisifyTransaction(tx);
}

/** Save a single meta key-value pair. */
export async function saveMeta(key, value) {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  return promisifyTransaction(tx);
}

/** Save multiple meta entries in one transaction. */
export async function saveMetaBatch(entries) {
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  for (const { key, value } of entries) store.put({ key, value });
  return promisifyTransaction(tx);
}

/** Check whether legacy localStorage data exists. */
export function hasLegacyData() {
  try {
    return localStorage.getItem(LEGACY_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Migrate data from localStorage to IndexedDB.
 * Removes the localStorage key only after a successful write.
 * Safe to re-run (idempotent — IndexedDB put overwrites).
 */
export async function migrateFromLocalStorage() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return { agents: [], currentId: null };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // Corrupt localStorage — discard it
    localStorage.removeItem(LEGACY_KEY);
    return { agents: [], currentId: null };
  }

  const agents = data.agents || [];
  const currentId = data.currentId || null;

  // Write all agents
  if (agents.length > 0) {
    const tx = db.transaction('agents', 'readwrite');
    const store = tx.objectStore('agents');
    for (const agent of agents) store.put(agent);
    await promisifyTransaction(tx);
  }

  // Write meta
  const metaTx = db.transaction('meta', 'readwrite');
  const metaStore = metaTx.objectStore('meta');
  metaStore.put({ key: 'currentId', value: currentId });
  metaStore.put({ key: 'agentOrder', value: agents.map(a => a.id) });
  await promisifyTransaction(metaTx);

  // Only remove after successful writes
  localStorage.removeItem(LEGACY_KEY);

  return { agents, currentId };
}

/** Clear all data from both stores. */
export async function clear() {
  const tx = db.transaction(['agents', 'meta'], 'readwrite');
  tx.objectStore('agents').clear();
  tx.objectStore('meta').clear();
  return promisifyTransaction(tx);
}
