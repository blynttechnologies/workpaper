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

export default function TimeLogPage() {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState('');
  const [staff, setStaff] = useState('');
  const [client, setClient] = useState('');

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
    () => (entries ?? []).filter((e) => (!staff || e.user_name === staff) && (!client || e.client_name === client)),
    [entries, staff, client]
  );
  const people = [...new Set((entries ?? []).map((e) => e.user_name))].sort();
  const clients = [...new Set((entries ?? []).map((e) => e.client_name))].sort();
  const total = shown.reduce((s, e) => s + secs(e), 0);

  const exportCsv = () =>
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
        <span className="ml-auto text-xs text-[#4A5878]">
          Total <span className="font-mono font-bold text-[#122654]">{formatDuration(total)}</span> across {shown.length} {shown.length === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
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
                <td colSpan={5} className="py-8 text-center text-[#4A5878]">No time recorded yet. Time is recorded while a client is open.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
