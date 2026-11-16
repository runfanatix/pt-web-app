/**
 * Offline demo mode (built with `pnpm demo:build`). The app runs exactly as normal, but its calls to the database
 * are answered by the mock in mockApi.ts, with data kept in this browser's local storage. No internet, no account,
 * no server: one HTML file can be opened from a laptop or a USB stick.
 */
import { planPrototypeImport } from '@pt/core';
import exportJson from '../../../../exports/bedfordview-v11.json';
import { createMockDb, fakeSession, handle, type MockDb } from './mockApi.ts';

export const DEMO_ORIGIN = 'http://demo.local';
const DB_KEY = 'pt-planner-demo-db';
const SEEDED_KEY = 'pt-planner-demo-signed-in';
const AUTH_KEY = 'sb-demo-auth-token';

export const isDemo = import.meta.env.VITE_DEMO === '1';

const { plan } = planPrototypeImport(exportJson, { trainerId: 'trainer-1' });

function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* a damaged copy is replaced by a fresh one */
  }
  return createMockDb(plan);
}
function saveDb(db: MockDb) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked: the demo carries on with what is in memory for this request */
  }
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Starts the demo: signs a trainer in, and answers the app's database calls from the mock. Call before rendering. */
export function installDemo(): void {
  try {
    if (!localStorage.getItem(SEEDED_KEY)) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(fakeSession('demo@ptplanner.example')));
      localStorage.setItem(SEEDED_KEY, '1');
    }
  } catch {
    /* without storage the sign-in screen shows; any email and password work */
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), window.location.href);
    if (url.origin !== DEMO_ORIGIN) return realFetch(input, init);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/logout')) return json(204);
      if (url.pathname.endsWith('/otp')) {
        // The demo sends no email: "emailing" a sign-in link just signs in.
        try {
          localStorage.setItem(AUTH_KEY, JSON.stringify(fakeSession('demo@ptplanner.example')));
        } catch {
          /* storage blocked: the sign-in screen stays */
        }
        setTimeout(() => window.location.reload(), 600);
        return json(200, {});
      }
      const s = fakeSession('demo@ptplanner.example');
      return url.pathname.endsWith('/user') ? json(200, s.user) : json(200, s);
    }
    let raw = typeof init?.body === 'string' ? init.body : '';
    if (!raw && req && method !== 'GET' && method !== 'HEAD') raw = await req.clone().text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    if (method === 'OPTIONS') return json(204);
    const db = loadDb();
    const reply = handle(db, plan, method, url, body);
    saveDb(db);
    return json(reply.status, reply.body);
  };
}

/** Starts over: forget every demo change (and the sign-in), then reload. */
export function resetDemo(): void {
  try {
    localStorage.clear();
  } catch {
    /* nothing to clear */
  }
  window.location.reload();
}
