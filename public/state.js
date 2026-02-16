// state.js — Agent state management with localStorage persistence

const STORAGE_KEY = 'agent-workbench-state';

let agents = [];
let currentId = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      agents = data.agents || [];
      currentId = data.currentId || null;
    }
  } catch { /* ignore corrupt data */ }

  // Ensure at least one agent
  if (agents.length === 0) {
    const agent = makeAgent('Agent 1');
    agents.push(agent);
    currentId = agent.id;
    save();
  } else if (!agents.find(a => a.id === currentId)) {
    currentId = agents[0].id;
    save();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ agents, currentId }));
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

// --- Public API ---

export function init() {
  load();
}

export function createAgent(name) {
  const n = agents.length + 1;
  const agent = makeAgent(name || `Agent ${n}`);
  agents.push(agent);
  currentId = agent.id;
  save();
  return agent;
}

export function getAgents() {
  return agents;
}

export function saveAgents(updated) {
  agents = updated;
  save();
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
    save();
  }
}

export function updateCurrentAgent(patch) {
  const agent = getCurrentAgent();
  if (!agent) return;
  Object.assign(agent, patch);
  save();
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
  }
  save();
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
  save();
  return copy;
}

export function renameAgent(id, name) {
  const agent = agents.find(a => a.id === id);
  if (agent) {
    agent.name = name;
    save();
  }
}
