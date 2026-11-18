'use client';

import { Notice } from '@/components/ui/Notice';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { db } from '@/lib/server/db';
import { canPull } from '@/lib/periods';
import { useCompany } from '@/context/CompanyContext';

const LEDGERS = {
  xero: { name: 'Xero', api: 'xero', reconnect: 'XERO_RECONNECT' },
  quickbooks: { name: 'QuickBooks', api: 'quickbooks', reconnect: 'QBO_RECONNECT' },
} as const;

/**
 * Header button that pulls the open client year from its ledger (Xero or QuickBooks) at any time,
 * the same pull as the client page. Shown only when the client is connected to one.
 */
export function LedgerSyncButton() {
  const pathname = usePathname();
  const { activeEngagement } = useCompany();
  const routeId = pathname.match(/\/engagements\/([^/]+)/)?.[1];
  const eng = (routeId && routeId !== 'new' ? db.engagements.find((e) => e.id === routeId) : null) ?? activeEngagement;
  const client = eng ? db.clients.find((c) => c.id === eng.client_id) : undefined;
  const ledger = client?.data_source === 'xero' || client?.data_source === 'quickbooks' ? LEDGERS[client.data_source] : null;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; reconnect?: boolean } | null>(null);
  useEffect(() => setNote(null), [eng?.id]);

  if (!eng || !client || !ledger || client.archived_at) return null;
  const tooOld = !canPull(eng.period_start);

  const sync = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/integrations/${ledger.api}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engagementId: eng.id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ ok: false, text: body.error || `The sync with ${ledger.name} failed. Try again.`, reconnect: body.code === ledger.reconnect });
        return;
      }
      const changed = body.changes?.length ?? 0;
      setNote({
        ok: !body.rateLimited && !body.notGathered?.length,
        text: `Synced with ${ledger.name}: ${body.lineCount} accounts, ${changed ? `${changed} changed since the last pull` : 'no changes since the last pull'}.${body.rateLimited ? ` ${body.rateLimited}` : ''}${body.notGathered?.length ? ` Could not gather ${body.notGathered.join(', ')}.` : ''}`,
      });
    } catch {
      setNote({ ok: false, text: 'Could not reach Blynt. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={sync}
        disabled={busy || tooOld}
        title={tooOld ? `${ledger.name} is only read for recent years. Import this year's trial balance from a file.` : `Pull ${client.name}'s latest figures from ${ledger.name}`}
        className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] text-xs font-semibold text-[#122654] bg-white border border-[#D3DCEE] rounded-full hover:border-[#122654]/40 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{busy ? 'Syncing…' : `Sync ${ledger.name}`}</span>
      </button>
      {note && (
        <Notice tone={note.ok ? 'ok' : 'error'} onClose={() => setNote(null)} className="absolute right-0 top-full mt-2 w-80 z-50 shadow-xl">
              {note.text}
              {note.reconnect && (
                <Link href={`/clients/${client.id}`} className="block mt-1 font-semibold underline">
                  Reconnect on the client page
                </Link>
              )}
            </Notice>
      )}
    </div>
  );
}
