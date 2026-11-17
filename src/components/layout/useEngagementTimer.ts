'use client';

import { useEffect, useState } from 'react';

const HEARTBEAT_MS = 60_000;

/** Seconds the engagement has been open in this tab. Records the time against the signed-in user on the server. */
export function useEngagementTimer(engagementId: string | null): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!engagementId) return;
    const start = Date.now();
    let entry = crypto.randomUUID();
    const url = `/api/v1/engagements/${encodeURIComponent(engagementId)}/time`;
    const beat = () =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }), keepalive: true })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.restart) entry = crypto.randomUUID();
        })
        .catch(() => {});

    beat();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    const pulse = setInterval(beat, HEARTBEAT_MS);
    // Closing the tab: one last heartbeat so the final minute counts
    window.addEventListener('pagehide', beat);
    return () => {
      clearInterval(tick);
      clearInterval(pulse);
      window.removeEventListener('pagehide', beat);
      beat();
      setSeconds(0);
    };
  }, [engagementId]);

  return seconds;
}

/** 0:05:12 */
export const formatDuration = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
