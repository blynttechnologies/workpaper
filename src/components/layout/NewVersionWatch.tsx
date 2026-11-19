'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { hasUnsavedChanges } from './WorkspaceSync';

const RELOADED_KEY = 'blynt_reloaded_for_build';
const CHECK_EVERY_MS = 2 * 60 * 1000;
const QUIET_MS = 15 * 1000;
const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password', '/invite'];

/** What an open page does once it knows which build is live. */
export function onNewBuild(s: {
  /** The build this page loaded from */
  loaded: string;
  /** The build the server runs now ('' when not known) */
  live: string;
  /** Edits not saved yet */
  unsaved: boolean;
  /** Typing in a field, or used the page a moment ago */
  busy: boolean;
  /** The build this tab last reloaded for by itself */
  reloadedFor: string;
  /** Reload was clicked */
  asked: boolean;
}): 'nothing' | 'reload' | 'banner' {
  if (!s.loaded || !s.live || s.live === s.loaded) return 'nothing';
  if (s.unsaved) return 'banner'; // never reload over an edit that is not saved
  if (s.asked) return 'reload';
  // Reloaded for this build already and still on the old one: an old server answered during the deploy. Ask, don't loop
  if (s.busy || s.reloadedFor === s.live) return 'banner';
  return 'reload';
}

const stored = () => {
  try {
    return sessionStorage.getItem(RELOADED_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Reloads the page when a new version has been deployed, so nobody keeps working on an old one. It waits until
 * nothing is unsaved and the page is not being used; until then it shows a small note with a Reload button.
 */
export function NewVersionWatch({ build }: { build: string }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PAGES.some((p) => pathname?.startsWith(p));
  const [waiting, setWaiting] = useState(false);
  const asked = useRef(false);
  const act = useRef(() => {});

  useEffect(() => {
    if (!build || isAuthPage) return;
    let live = '';
    let lastUsed = 0;
    const used = () => {
      lastUsed = Date.now();
    };
    act.current = () => {
      // A field holds what is typed until it is left, so a reload would lose it
      const typing = !!document.activeElement?.matches('input, textarea, [contenteditable="true"]');
      const step = onNewBuild({ loaded: build, live, unsaved: hasUnsavedChanges(), busy: typing || Date.now() - lastUsed < QUIET_MS, reloadedFor: stored(), asked: asked.current });
      if (step === 'reload') {
        try {
          sessionStorage.setItem(RELOADED_KEY, live);
        } catch {}
        window.location.reload();
        return;
      }
      setWaiting(step === 'banner');
    };
    // A tab in the background checks when it is looked at again
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/v1/version', { cache: 'no-store' });
        if (res.ok) live = String((await res.json()).build ?? '');
      } catch {}
      act.current();
    };
    const poll = setInterval(check, CHECK_EVERY_MS);
    // Once a new build is known, reload as soon as the page is saved and left alone
    const retry = setInterval(() => live && live !== build && act.current(), 5000);
    document.addEventListener('visibilitychange', check);
    document.addEventListener('keydown', used, true);
    document.addEventListener('pointerdown', used, true);
    return () => {
      clearInterval(poll);
      clearInterval(retry);
      document.removeEventListener('visibilitychange', check);
      document.removeEventListener('keydown', used, true);
      document.removeEventListener('pointerdown', used, true);
    };
  }, [build, isAuthPage]);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-2 rounded-[8px] bg-[#122654] text-white text-xs shadow-lg">
      <span>A new version is live. This page reloads when you pause; your work is saved first.</span>
      <button
        type="button"
        className="px-2.5 py-1 rounded-[6px] bg-white text-[#122654] font-bold whitespace-nowrap"
        onClick={() => {
          asked.current = true;
          act.current();
        }}
      >
        Reload now
      </button>
    </div>
  );
}
