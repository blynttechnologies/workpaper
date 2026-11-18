'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Timer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { downloadText } from '@/lib/download';
import { ukDate, ukTime } from '@/lib/dates';
import { formatDuration } from '@/components/layout/useEngagementTimer';
import type { TimeEntry } from '@/lib/server/time-log';

const secs = (e: TimeEntry) => Math.max(0, Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000));
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
const selectCls = 'h-9 rounded-lg border border-[#E3E7EF] bg-white px-3 text-xs text-[#122654]';
/** The day a session started, on this computer's clock, as YYYY-MM-DD to compare with a date box. */
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function TimeLogPage() {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState('');
  const [staff, setStaff] = useState('');
  const [client, setClient] = useState('');
  // Everyone can total by client; managers and up can also total by staff member
  const [view, setView] = useState<'sessions' | 'staff' | 'client'>('sessions');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    fetch('/api/v1/time')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Could not load the time log.');
        setAll(body.all);
        setEntries(body.entries);
      })
      .catch((e) => setError(e.message || 'Could not reach the server. Try again.'));
  }, []);

  const shown = useMemo(
    () =>
      (entries ?? []).filter((e) => {
        const day = localDay(e.started_at);
        return (!staff || e.user_name === staff) && (!client || e.client_name === client) && (!from || day >= from) && (!to || day <= to);
      }),
    [entries, staff, client, from, to]
  );
  const people = [...new Set((entries ?? []).map((e) => e.user_name))].sort();
  const clients = [...new Set((entries ?? []).map((e) => e.client_name))].sort();
  const total = shown.reduce((s, e) => s + secs(e), 0);
  // Grouped by user id, not name: two people can share a name
  const staffTotals = useMemo(() => {
    const m = new Map<string, { name: string; sessions: number; secs: number; clients: Set<string> }>();
    for (const e of shown) {
      const t = m.get(e.user_id) ?? { name: e.user_name, sessions: 0, secs: 0, clients: new Set<string>() };
      t.sessions += 1;
      t.secs += secs(e);
      t.clients.add(e.client_name);
      m.set(e.user_id, t);
    }
    return [...m.entries()].map(([id, t]) => ({ id, ...t })).sort((a, b) => b.secs - a.secs);
  }, [shown]);
  // By name, as the client filter is: a client's sessions across its years count together
  const clientTotals = useMemo(() => {
    const m = new Map<string, { sessions: number; secs: number; staff: Set<string> }>();
    for (const e of shown) {
      const t = m.get(e.client_name) ?? { sessions: 0, secs: 0, staff: new Set<string>() };
      t.sessions += 1;
      t.secs += secs(e);
      t.staff.add(e.user_id);
      m.set(e.client_name, t);
    }
    return [...m.entries()].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.secs - a.secs);
  }, [shown]);
  const empty = entries?.length ? 'No time recorded in this selection.' : 'No time recorded yet. Time is recorded while a client is open.';

  const exportCsv = () =>
    view === 'staff' ? downloadText('time-by-staff.csv', ['Staff,Clients,Sessions,Hours', ...staffTotals.map((t) => [csvCell(t.name), t.clients.size, t.sessions, (t.secs / 3600).toFixed(2)].join(','))].join('\n')) :
    view === 'client' ? downloadText('time-by-client.csv', ['Client,Staff,Sessions,Hours', ...clientTotals.map((t) => [csvCell(t.name), t.staff.size, t.sessions, (t.secs / 3600).toFixed(2)].join(','))].join('\n')) :
    downloadText(
      'time-log.csv',
      ['Client,Staff,Started,Ended,Minutes', ...shown.map((e) => [csvCell(e.client_name), csvCell(e.user_name), e.started_at, e.ended_at, (secs(e) / 60).toFixed(1)].join(','))].join('\n')
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#122654] flex items-center gap-2">
            <Timer className="w-6 h-6 text-[#FF7A66]" aria-hidden="true" /> Time log
          </h1>
          <p className="text-sm text-[#4A5878]">
            {all ? 'Time every staff member has spent with each client open.' : 'Time you have spent with each client open.'}
          </p>
        </div>
        <Button onClick={exportCsv} disabled={shown.length === 0}>
          <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-[14px] border border-[#E3E7EF]">
        {all && (
          <select aria-label="Staff" className={selectCls} value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">All staff</option>
            {people.map((p) => <option key={p}>{p}</option>)}
          </select>
        )}
        <select aria-label="Client" className={selectCls} value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[#4A5878]">
          From
          <input type="date" aria-label="From date" className={selectCls} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[#4A5878]">
          To
          <input type="date" aria-label="To date" className={selectCls} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="text-xs text-[#1D4E89] underline cursor-pointer">
            Any date
          </button>
        )}
        <div role="group" aria-label="View" className="flex rounded-lg border border-[#E3E7EF] overflow-hidden text-xs font-bold">
          {([['sessions', 'Sessions'], ['staff', 'Total by staff'], ['client', 'Total by client']] as const)
            .filter(([v]) => all || v !== 'staff')
            .map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-9 px-3 cursor-pointer ${view === v ? 'bg-[#122654] text-white' : 'bg-white text-[#122654] hover:bg-[#F5F8FD]'}`}>
                {label}
              </button>
            ))}
        </div>
        <span className="ml-auto text-xs text-[#4A5878]">
          Total <span className="font-mono font-bold text-[#122654]">{formatDuration(total)}</span> across {shown.length} {shown.length === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {view === 'staff' && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F5F8FD] text-[10px] font-bold uppercase text-[#4A5878]">
              <tr>
                <th className="py-3 px-4">Staff</th>
                <th className="py-3 px-3 text-right">Clients</th>
                <th className="py-3 px-3 text-right">Sessions</th>
                <th className="py-3 px-4 text-right">Total time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {staffTotals.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 px-4 font-bold text-[#122654]">{t.name}</td>
                  <td className="py-3 px-3 text-right text-[#4A5878]">{t.clients.size}</td>
                  <td className="py-3 px-3 text-right text-[#4A5878]">{t.sessions}</td>
                  <td className="py-3 px-4 text-right font-mono">{formatDuration(t.secs)}</td>
                </tr>
              ))}
              {entries && staffTotals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[#4A5878]">{empty}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === 'client' && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F5F8FD] text-[10px] font-bold uppercase text-[#4A5878]">
              <tr>
                <th className="py-3 px-4">Client</th>
                {all && <th className="py-3 px-3 text-right">Staff</th>}
                <th className="py-3 px-3 text-right">Sessions</th>
                <th className="py-3 px-4 text-right">Total time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {clientTotals.map((t) => (
                <tr key={t.name}>
                  <td className="py-3 px-4 font-bold text-[#122654]">{t.name}</td>
                  {all && <td className="py-3 px-3 text-right text-[#4A5878]">{t.staff.size}</td>}
                  <td className="py-3 px-3 text-right text-[#4A5878]">{t.sessions}</td>
                  <td className="py-3 px-4 text-right font-mono">{formatDuration(t.secs)}</td>
                </tr>
              ))}
              {entries && clientTotals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[#4A5878]">{empty}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className={`bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto ${view !== 'sessions' ? 'hidden' : ''}`}>
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F5F8FD] text-[10px] font-bold uppercase text-[#4A5878]">
            <tr>
              <th className="py-3 px-4">Client</th>
              <th className="py-3 px-3">Staff</th>
              <th className="py-3 px-3">Date</th>
              <th className="py-3 px-3">From – to</th>
              <th className="py-3 px-4 text-right">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {shown.map((e) => (
              <tr key={e.id}>
                <td className="py-3 px-4 font-bold text-[#122654]">{e.client_name}</td>
                <td className="py-3 px-3 text-[#122654]">{e.user_name}</td>
                <td className="py-3 px-3 text-[#4A5878]">{ukDate(e.started_at)}</td>
                <td className="py-3 px-3 text-[#4A5878]">{ukTime(e.started_at)} – {ukTime(e.ended_at)}</td>
                <td className="py-3 px-4 text-right font-mono">{formatDuration(secs(e))}</td>
              </tr>
            ))}
            {entries && shown.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[#4A5878]">{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
