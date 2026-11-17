'use client';

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/server/db';
import { usePathname } from 'next/navigation';
import { setSignedInUser } from '@/lib/session';

/**
 * Loads the saved workspace from /api/v1/state before rendering the app,
 * then auto-saves any change to the in-browser db.
 * Writes made through other /api/v1 routes are kept in step: pending browser
 * changes are saved first, and the latest workspace is reloaded afterwards.
 */

const STATE_URL = '/api/v1/state';

let version = 0;
let lastSaved = '';
let started = false;
let queue: Promise<unknown> = Promise.resolve();
const nativeFetch: typeof fetch = typeof window !== 'undefined' ? window.fetch.bind(window) : fetch;

// Ledger transactions are kept on the server and never saved from here
function snapshot() {
  const { transactions: _ledger, ...state } = db.exportState();
  return JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// Engagements whose ledger transactions are in the browser, and the one open now
const ledgerLoaded = new Set<string>();
let openEngagement: string | null = null;

async function loadLedger(engagementId: string) {
  const rows: unknown[] = [];
  for (let total = Infinity; rows.length < total; ) {
    const res = await nativeFetch(`/api/v1/engagements/${encodeURIComponent(engagementId)}/transactions?offset=${rows.length}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load the ledger');
    const page = await res.json();
    total = page.total;
    rows.push(...page.rows);
    if (!page.rows.length) break;
  }
  db.transactions = [...db.transactions.filter((t) => t.engagement_id !== engagementId), ...(rows as typeof db.transactions)];
  ledgerLoaded.add(engagementId);
}

// The open year's ledger, and the year before's for the comparisons the papers make
async function loadLedgers(engagementId: string) {
  await loadLedger(engagementId);
  const prior = db.engagements.find((e) => e.id === engagementId)?.prior_engagement_id;
  if (prior) await loadLedger(prior).catch(() => undefined); // the year still opens without its comparatives
}

const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password', '/invite'];

class SignedOut extends Error {}

function applyState(state: { version?: number; data?: Record<string, unknown[]> | null; me?: { id: string } }) {
  if (state.data) db.importState(state.data);
  if (state.me) setSignedInUser(state.me.id);
  version = state.version || 0;
  lastSaved = snapshot();
}

async function load() {
  const res = await nativeFetch(STATE_URL, { cache: 'no-store' });
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error('Could not load workspace');
  applyState(await res.json());
}

async function saveIfChanged() {
  const current = snapshot();
  if (current === lastSaved) return;
  const res = await nativeFetch(STATE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, data: JSON.parse(current) }),
  });
  if (res.status === 409 || res.status === 403) {
    // Someone else saved first, or the server refused a change this user may not make: take the saved copy
    const body = await res.json();
    applyState(body);
    if (res.status === 403) window.alert(`Change not saved: ${body.error}`);
    return;
  }
  if (res.status === 401) window.location.href = '/login';
  if (res.ok) {
    version = (await res.json()).version;
    lastSaved = current;
  }
}

// Run sync work one step at a time so saves and reloads never overlap
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function installFetchHook() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const isApi = url.includes('/api/v1/') && !url.includes(STATE_URL);
    if (!isApi || url.includes('/api/v1/auth/')) return nativeFetch(input, init);

    // The server must see this browser's latest changes before it answers
    await serial(saveIfChanged);
    if (method === 'GET') return nativeFetch(input, init);
    const res = await nativeFetch(input, init);
    await serial(load).catch(() => undefined);
    // Routes that never touch the ledger say so, and the wait for it to download again is skipped
    if (res.headers.get('x-ledger-unchanged')) return res;
    // A write on the server (a Xero pull, say, even from the client page) may have changed any engagement's
    // ledger: the open one is fetched again now, the rest when they are next opened
    ledgerLoaded.clear();
    if (openEngagement) {
      ledgerLoaded.add(openEngagement); // keeps the page on screen while it reloads
      await serial(() => loadLedgers(openEngagement!)).catch(() => undefined);
    }
    return res;
  };
}

export function WorkspaceSync({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PAGES.some((p) => pathname?.startsWith(p));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(started ? 'ready' : 'loading');
  const engagementId = pathname?.match(/^\/engagements\/([^/]+)/)?.[1];
  const ledgerFor = engagementId && engagementId !== 'new' ? decodeURIComponent(engagementId) : null;
  const [, setLedgerReady] = useState(0);
  openEngagement = ledgerFor;

  // The open engagement's ledger is loaded before its pages render, as they read it straight from db
  useEffect(() => {
    if (status !== 'ready' || !ledgerFor || ledgerLoaded.has(ledgerFor)) return;
    serial(() => loadLedgers(ledgerFor))
      .catch(() => ledgerLoaded.add(ledgerFor)) // the pages still open, without the drill-down
      .finally(() => setLedgerReady((n) => n + 1));
  }, [status, ledgerFor]);

  useEffect(() => {
    if (started || isAuthPage) return;
    load()
      .then(() => {
        started = true;
        installFetchHook();
        setStatus('ready');
        setInterval(() => {
          serial(saveIfChanged).catch(() => undefined);
        }, 1500);
        window.addEventListener('pagehide', () => {
          const current = snapshot();
          if (current !== lastSaved) {
            navigator.sendBeacon(
              STATE_URL,
              new Blob([JSON.stringify({ version, data: JSON.parse(current) })], { type: 'application/json' })
            );
          }
        });
      })
      .catch((err) => {
        if (err instanceof SignedOut) window.location.href = '/login';
        else setStatus('error');
      });
  }, [isAuthPage]);

  if (isAuthPage) return <>{children}</>;

  if (status === 'loading' || (status === 'ready' && ledgerFor && !ledgerLoaded.has(ledgerFor))) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#5B6675]">
        Loading workspace…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#B42318]">
        Could not load the workspace. Please refresh the page.
      </div>
    );
  }
  return <>{children}</>;
}
