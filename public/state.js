// state.js — Agent state management with IndexedDB persistence

import * as storage from './storage.js';

const LEGACY_STORAGE_KEY = 'agent-workbench-state';

let agents = [];
let currentId = null;
let fallbackToLocalStorage = false;

// Debounce state for updateCurrentAgent
let saveTimer = null;
let pendingAgent = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makeAgent(name) {
  return {
    id: generateId(),
    name: name || 'Agent',
    model: '',
    systemPrompt: '',
    messages: [],
  };
}

// --- localStorage fallback (rare: IndexedDB unavailable) ---

function legacyLoad() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      agents = data.agents || [];
      currentId = data.currentId || null;
    }
  } catch { /* ignore corrupt data */ }
}

function legacySave() {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ agents, currentId }));
  } catch (e) {
    console.error('[state] localStorage write failed:', e.message);
  }
}

// --- IndexedDB persist helpers (fire-and-forget) ---

function logError(err) {
  console.error('[state] IndexedDB write failed:', err);
}

function persistAgent(agent) {
  if (fallbackToLocalStorage) { legacySave(); return; }
  storage.saveAgent(agent).catch(logError);
}

function persistMeta() {
  if (fallbackToLocalStorage) { legacySave(); return; }
  storage.saveMetaBatch([
    { key: 'currentId', value: currentId },
    { key: 'agentOrder', value: agents.map(a => a.id) },
  ]).catch(logError);
}

function persistAll() {
  if (fallbackToLocalStorage) { legacySave(); return; }
  storage.saveAgentsBatch(agents).catch(logError);
  persistMeta();
}

function persistDelete(id) {
  if (fallbackToLocalStorage) { legacySave(); return; }
  storage.deleteAgent(id).catch(logError);
}

/** Flush any pending debounced write immediately. */
function flushPendingWrite() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingAgent) {
    persistAgent(pendingAgent);
    pendingAgent = null;
  }
}

// --- Public API ---

export async function init() {
  try {
    await storage.open();

    if (storage.hasLegacyData()) {
      const migrated = await storage.migrateFromLocalStorage();
      agents = migrated.agents;
      currentId = migrated.currentId;
    } else {
      agents = await storage.loadAllAgents();
      currentId = await storage.loadMeta('currentId') ?? null;
    }
  } catch (e) {
    console.warn('[state] IndexedDB unavailable, falling back to localStorage:', e.message);
    fallbackToLocalStorage = true;
    legacyLoad();
  }

  // Ensure at least one agent
  if (agents.length === 0) {
    const agent = makeAgent('Agent 1');
    agents.push(agent);
    currentId = agent.id;
    persistAll();
  } else if (!agents.find(a => a.id === currentId)) {
    currentId = agents[0].id;
    persistMeta();
  }

  window.addEventListener('beforeunload', flushPendingWrite);
}

export function createAgent(name) {
  const n = agents.length + 1;
  const agent = makeAgent(name || `Agent ${n}`);
  agents.push(agent);
  currentId = agent.id;
  persistAgent(agent);
  persistMeta();
  return agent;
}

export function getAgents() {
  return agents;
}

export function saveAgents(updated) {
  agents = updated;
  persistAll();
}

export function getCurrentAgent() {
  return agents.find(a => a.id === currentId) || agents[0];
}

export function getCurrentId() {
  return currentId;
}

export function setCurrentAgent(id) {
  if (agents.find(a => a.id === id)) {
    currentId = id;
    if (fallbackToLocalStorage) { legacySave(); return; }
    storage.saveMeta('currentId', currentId).catch(logError);
  }
}

export function updateCurrentAgent(patch) {
  const agent = getCurrentAgent();
  if (!agent) return;
  Object.assign(agent, patch);

  // Debounce: coalesce rapid writes (typing, streaming)
  pendingAgent = agent;
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      if (pendingAgent) {
        persistAgent(pendingAgent);
        pendingAgent = null;
      }
      saveTimer = null;
    }, 300);
  }
}

export function deleteAgent(id) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return;
  agents.splice(idx, 1);
  if (currentId === id) {
    currentId = agents.length > 0 ? agents[0].id : null;
  }
  if (agents.length === 0) {
    const agent = makeAgent('Agent 1');
    agents.push(agent);
    currentId = agent.id;
    persistAgent(agent);
  }
  persistDelete(id);
  persistMeta();
}

export function duplicateAgent(id) {
  const src = agents.find(a => a.id === id);
  if (!src) return;
  const copy = makeAgent(src.name + ' (copy)');
  copy.model = src.model;
  copy.systemPrompt = src.systemPrompt;
  copy.messages = JSON.parse(JSON.stringify(src.messages));
  agents.push(copy);
  currentId = copy.id;
  persistAgent(copy);
  persistMeta();
  return copy;
}

export function renameAgent(id, name) {
  const agent = agents.find(a => a.id === id);
  if (agent) {
    agent.name = name;
    persistAgent(agent);
  }
}
