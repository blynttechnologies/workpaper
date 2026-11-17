'use client';

import { useEffect, useState } from 'react';

const HEARTBEAT_MS = 60_000;
// No mouse, keyboard, scroll or touch in this tab for this long pauses the timer
export const IDLE_MS = 5 * 60_000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];

/**
 * Seconds of active work with this engagement open in this tab, and whether it is paused for inactivity.
 * Records the time against the signed-in user on the server; no heartbeats are sent while paused, so the
 * server closes the session and the next activity starts a new one.
 */
export function useEngagementTimer(engagementId: string | null): { seconds: number; paused: boolean } {
  const [state, setState] = useState({ seconds: 0, paused: false });

  useEffect(() => {
    if (!engagementId) return;
    let lastActive = Date.now();
    let lastTick = lastActive;
    let activeMs = 0;
    let paused = false;
    let entry = crypto.randomUUID();
    const url = `/api/v1/engagements/${encodeURIComponent(engagementId)}/time`;
    const send = (retry = true): Promise<void> =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }), keepalive: true })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          // The server closed the old session (after a pause): start a new one straight away
          if (d?.restart) {
            entry = crypto.randomUUID();
            if (retry) return send(false);
          }
        })
        .catch(() => {});
    const beat = () => {
      if (!paused) send();
    };
    const onActivity = () => {
      lastActive = Date.now();
    };

    send();
    const tick = setInterval(() => {
      const now = Date.now();
      const idle = now - lastActive > IDLE_MS;
      if (!idle) activeMs += now - lastTick;
      lastTick = now;
      if (paused && !idle) send(); // back from a break: record again at once
      paused = idle;
      setState({ seconds: Math.floor(activeMs / 1000), paused });
    }, 1000);
    const pulse = setInterval(beat, HEARTBEAT_MS);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    // Closing the tab: one last heartbeat so the final minute counts
    window.addEventListener('pagehide', beat);
    return () => {
      clearInterval(tick);
      clearInterval(pulse);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.removeEventListener('pagehide', beat);
      beat();
      setState({ seconds: 0, paused: false });
    };
  }, [engagementId]);

  return state;
}

/** 0:05:12 */
export const formatDuration = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
