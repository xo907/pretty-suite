import { useEffect, useRef, useState } from 'react';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body || {}),
  put: (url, body) => call('PUT', url, body),
};

export const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();

// One shared event stream for the whole app.
const EVENTS = ['job', 'live', 'logger', 'session'];
const listeners = Object.fromEntries(EVENTS.map((e) => [e, new Set()]));
let source = null;

function subscribe(event, fn) {
  if (!source) {
    source = new EventSource('/api/events');
    for (const name of EVENTS) {
      source.addEventListener(name, (e) => listeners[name].forEach((listener) => listener(JSON.parse(e.data))));
    }
  }
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
}

export function useEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (data) => ref.current(data)), [event]);
}

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    api.get('/api/jobs').then(setJobs).catch(() => {});
  }, []);
  useEvent('job', (job) =>
    setJobs((list) => (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list]))
  );
  return jobs;
}

export function useFetch(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = () => {
    if (!url) return;
    api
      .get(url)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error: error.message, loading: false }));
  };
  useEffect(reload, [url, ...deps]);
  return { ...state, reload };
}

/** Turns the picker's selection shape into the server's target list. */
export function toTargets(selection) {
  const targets = Object.keys(selection.dms).map((id) => ({ kind: 'dm', id }));
  for (const [id, value] of Object.entries(selection.guilds)) {
    if (value === true) targets.push({ kind: 'guild', id });
    else if (Object.keys(value).length) targets.push({ kind: 'guild', id, channelIds: Object.keys(value) });
  }
  return targets;
}

export const avatarUrl = (userId, hash) => (userId && hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=64` : null);
export const iconUrl = (guildId, hash) => (guildId && hash ? `https://cdn.discordapp.com/icons/${guildId}/${hash}.png?size=64` : null);

export const fmtNumber = (n) => Number(n || 0).toLocaleString();
export function fmtTime(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
