'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Plus,
  AlertCircle,
  ArrowRight,
  Building2,
  Trash2,
  AlertTriangle,
  X,
  Archive,
} from 'lucide-react';
import { db } from '@/lib/server/db';
import { Client } from '@/lib/types/models';
import { useCompany } from '@/context/CompanyContext';
import { mustKeep, RETENTION_YEARS } from '@/lib/periods';

export default function ClientsPage() {
  const { clients, deleteCompany, setActiveCompanyId, refreshCompanyData, activeCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  // Latest year end still inside the retention period, which blocks deleting the company
  const keptYear = deleteTarget
    ? db.engagements.filter((e) => e.client_id === deleteTarget.id && mustKeep(e.period_end)).map((e) => e.period_end).sort().pop()
    : undefined;
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [archiveTarget, setArchiveTarget] = useState<Client | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [notice, setNotice] = useState('');

  const archivedCount = clients.filter((c) => c.archived_at).length;
  const activeCount = clients.length - archivedCount;

  // Archive (with reason) or restore through the server so it is audited
  const setArchived = async (client: Client, archived: boolean, reason = '') => {
    setArchiveBusy(true);
    setArchiveError('');
    try {
      const res = await fetch(`/api/v1/clients/${client.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchiveError(body.error || 'Could not update the client. Try again.');
        return false;
      }
      refreshCompanyData();
      if (archived && activeCompanyId === client.id) {
        const next = db.clients.find((c) => !c.archived_at && c.id !== client.id);
        if (next) setActiveCompanyId(next.id);
      }
      setNotice(archived ? `${client.name} archived. Find it under Archived.` : `${client.name} restored.`);
      setTimeout(() => setNotice(''), 4000);
      return true;
    } catch {
      setArchiveError('Could not reach the server. Try again.');
      return false;
    } finally {
      setArchiveBusy(false);
    }
  };

  const filteredClients = clients.filter((c) => {
    if (view === 'active' ? c.archived_at : !c.archived_at) return false;
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.company_no || '').toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'all' || c.company_type === typeFilter;
    const matchesSource = sourceFilter === 'all' || c.data_source === sourceFilter;

    return matchesSearch && matchesType && matchesSource;
  });

  // Accounts still to map across the active clients' latest years, for the header line
  const toMap = clients
    .filter((c) => !c.archived_at)
    .reduce((n, c) => {
      const eng = db.engagements.find((e) => e.client_id === c.id);
      return n + (eng ? db.account_mappings.filter((m) => m.engagement_id === eng.id && m.status !== 'confirmed').length : 0);
    }, 0);

  const pill = (on: boolean) =>
    `min-h-[40px] px-4 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
      on ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#D3DCEE] text-[#122654] hover:border-[#122654]'
    }`;

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#122654] tracking-tight">Clients</h1>
          <p className="text-xs text-[#4A5878] mt-1">
            {activeCount} active · {toMap === 0 ? 'all accounts mapped' : `${toMap} account${toMap === 1 ? '' : 's'} to map`}
          </p>
        </div>
        <Link
          href="/engagements/new"
          className="min-h-[44px] px-5 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          New engagement
        </Link>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#4A5878] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            aria-label="Search by client name or company number"
            type="text"
            placeholder="Search by client name or company number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full min-h-[40px] pl-10 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-xl text-[#122654] outline-none focus:border-[#FF7A66]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Client status" className="flex gap-2">
            {(
              [
                ['active', 'Active', activeCount],
                ['archived', 'Archived', archivedCount],
              ] as const
            ).map(([key, text, count]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={pill(view === key)}>
                {text} {count}
              </button>
            ))}
          </div>
          <select aria-label="Filter by client type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={pill(false)}>
            <option value="all">All company types</option>
            <option value="Small company (FRS 102 1A)">Small company (FRS 102 1A)</option>
            <option value="Medium/large (FRS 102)">Medium/large (FRS 102)</option>
            <option value="Micro-entity (FRS 105)">Micro-entity (FRS 105)</option>
            <option value="IFRS company/group">IFRS company/group</option>
            <option value="LLP (FRS 102 + LLP SORP)">LLP (FRS 102 + LLP SORP)</option>
          </select>
          <select aria-label="Filter by data source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={pill(false)}>
            <option value="all">All data sources</option>
            <option value="blynt">Blynt Accounting</option>
            <option value="xero">Xero</option>
            <option value="quickbooks">QuickBooks Online</option>
            <option value="csv">CSV / Excel</option>
          </select>
        </div>
      </div>

      {notice && (
        <div role="status" className="px-4 py-3 rounded-[10px] bg-[#E6F4EF] border border-[#0B6B52]/20 text-xs font-medium text-[#0B6B52]">
          {notice}
        </div>
      )}

      {/* Client cards */}
      <ul aria-label="Clients" className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredClients.map((client) => {
          const eng = db.engagements.find((e) => e.client_id === client.id);
          const mappings = eng ? db.account_mappings.filter((m) => m.engagement_id === eng.id) : [];
          const unconfirmedCount = mappings.filter((m) => m.status !== 'confirmed').length;
          const yearEnd = client.year_end || client.yearEnd;

          return (
            <li key={client.id} className="blynt-card p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[#122654] truncate">{client.name}</h2>
                  <p className="text-[11px] text-[#4A5878]">{client.company_type}</p>
                </div>
                {eng && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#EAF0FB] text-[#1D4E89]">
                    {eng.status}
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <dt className="text-[10px] text-[#4A5878]">Year end</dt>
                  <dd className="text-sm font-bold text-[#122654] font-mono-numbers">
                    {yearEnd ? new Date(yearEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-[#4A5878]">Data source</dt>
                  <dd className="text-sm font-bold text-[#122654] flex items-center gap-1.5 capitalize">
                    {client.data_source === 'csv' ? 'CSV / Excel' : client.data_source}
                    {client.reconnect_needed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FFF4DB] text-[#6B4700] normal-case">
                        <AlertCircle className="w-3 h-3" /> Reconnect needed
                      </span>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap gap-2">
                {mappings.length === 0 ? (
                  <span className="text-[#4A5878] text-[10px] font-semibold">○ No trial balance</span>
                ) : unconfirmedCount === 0 ? (
                  <span className="text-[#0B6B52] bg-[#E6F4EF] px-2 py-0.5 rounded-md text-[10px] font-bold">✓ All mapped</span>
                ) : (
                  <span className="text-[#A23A27] bg-[#FFF1EE] px-2 py-0.5 rounded-md text-[10px] font-bold">! {unconfirmedCount} to map</span>
                )}
                {client.archived_at && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#F5F8FD] border border-[#D3DCEE] text-[#4A5878]" title={client.archive_reason || undefined}>
                    <Archive className="w-3 h-3" />
                    Archived {new Date(client.archived_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {client.archive_reason ? ` · ${client.archive_reason}` : ''}
                  </span>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-[#E3E7EF] flex items-center justify-between gap-3">
                <Link
                  href={`/clients/${client.id}`}
                  onClick={() => setActiveCompanyId(client.id)}
                  className="min-h-[40px] px-4 flex items-center gap-1.5 rounded-xl bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold transition-colors"
                >
                  Open client <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
                <div className="flex items-center gap-4">
                  {client.archived_at ? (
                    <button
                      type="button"
                      disabled={archiveBusy}
                      onClick={() => setArchived(client, false)}
                      aria-label={`Restore ${client.name}`}
                      className="text-xs font-semibold text-[#1D4E89] hover:underline cursor-pointer"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setArchiveReason('');
                        setArchiveError('');
                        setArchiveTarget(client);
                      }}
                      aria-label={`Archive ${client.name}`}
                      className="text-xs font-semibold text-[#4A5878] hover:text-[#122654] cursor-pointer"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(client)}
                    aria-label={`Delete ${client.name}`}
                    className="text-xs font-semibold text-[#4A5878] hover:text-[#B42318] cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {filteredClients.length === 0 && view === 'archived' && (
        <div className="blynt-card p-12 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-[#F5F8FD] border border-[#E3E7EF] flex items-center justify-center text-[#4A5878] mb-3">
            <Archive className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#122654]">No archived clients</h3>
          <p className="text-xs text-[#4A5878] max-w-sm mt-1">
            Archive clients you no longer act for. Their files are kept, read-only, and you can restore them any time.
          </p>
        </div>
      )}

      {filteredClients.length === 0 && view === 'active' && (
        <div className="blynt-card p-12 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-[#F5F8FD] border border-[#E3E7EF] flex items-center justify-center text-[#4A5878] mb-3">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#122654]">No clients found</h3>
          <p className="text-xs text-[#4A5878] max-w-sm mt-1 mb-4">
            There are no clients in the system yet. Add your first client to start preparing statutory workpapers.
          </p>
          <Link
            href="/engagements/new"
            className="px-4 py-2 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add First Client</span>
          </Link>
        </div>
      )}

      {/* Archive confirmation */}
      {archiveTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="archive-title" className="fixed inset-0 z-50 bg-[#0B1A3B]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="blynt-card p-6 bg-white max-w-md w-full rounded-xl shadow-xl flex flex-col gap-4 border border-[#E3E7EF]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#EAF5FC] flex items-center justify-center">
                  <Archive className="w-5 h-5 text-[#1D4E89]" />
                </div>
                <h3 id="archive-title" className="text-base font-bold text-[#122654]">Archive client</h3>
              </div>
              <button type="button" aria-label="Close" onClick={() => setArchiveTarget(null)} className="p-1 rounded-lg text-[#4A5878] hover:bg-[#F5F8FD]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#4A5878] leading-relaxed">
              Archive <strong className="text-[#122654]">{archiveTarget.name}</strong>? Nothing is deleted.
            </p>
            <ul className="text-xs text-[#122654] space-y-1.5 pl-1">
              <li className="flex gap-2"><span className="text-[#1D4E89]">&bull;</span>It moves to the Archived list and out of the client switcher.</li>
              <li className="flex gap-2"><span className="text-[#1D4E89]">&bull;</span>Its working papers, trial balances and activity log are kept, read-only.</li>
              <li className="flex gap-2"><span className="text-[#1D4E89]">&bull;</span>No new engagements or imports until you restore it.</li>
            </ul>

            <div>
              <label htmlFor="archive-reason" className="block text-xs font-semibold text-[#122654] mb-1.5">Reason (optional)</label>
              <input
                id="archive-reason"
                value={archiveReason}
                maxLength={300}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Disengaged, company dissolved, moved to another practice"
                className="w-full min-h-[40px] px-3 text-xs bg-[#F5F8FD] border border-[#D3DCEE] rounded-[10px] text-[#122654] outline-none focus:border-[#FF7A66]"
              />
            </div>

            {archiveError && <p role="alert" className="text-[11px] font-medium text-[#B42318]">{archiveError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button type="button" onClick={() => setArchiveTarget(null)} className="min-h-[38px] px-4 text-xs font-semibold text-[#122654] hover:bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveBusy}
                onClick={async () => {
                  if (await setArchived(archiveTarget, true, archiveReason)) setArchiveTarget(null);
                }}
                className="min-h-[38px] px-4 text-xs font-bold text-white bg-[#122654] hover:bg-[#0B1A3B] rounded-xl transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{archiveBusy ? 'Archiving…' : 'Archive client'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Delete Company */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-[#0B1A3B]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="blynt-card p-6 bg-white max-w-md w-full rounded-xl shadow-xl flex flex-col gap-4 border border-[#E3E7EF]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[#B42318]">
                <div className="w-9 h-9 rounded-xl bg-[#FDECEA] flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-[#B42318]" />
                </div>
                <h3 className="text-base font-bold text-[#122654]">Delete Company</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="p-1 rounded-lg text-[#4A5878] hover:bg-[#F5F8FD]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#4A5878] leading-relaxed">
              Are you sure you want to delete <strong className="text-[#122654]">{deleteTarget.name}</strong>?
              This will permanently remove the company, its financial years, trial balance snapshots, account mappings, and working papers.
            </p>

            <div className="p-3 bg-[#FFF1EE] border border-[#FF7A66]/30 rounded-xl text-[11px] text-[#A23A27] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {keptYear
                  ? `This company cannot be deleted: records for the year ended ${keptYear} must be kept for ${RETENTION_YEARS} years after the year end. Archive it instead; archived companies stay readable.`
                  : 'This action cannot be undone. All activity logs and working papers for this entity will be removed.'}
              </span>
            </div>

            {!deleteTarget.archived_at && (
              <p className="text-[11px] text-[#4A5878]">
                No longer acting for this client?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setArchiveReason('');
                    setArchiveError('');
                    setArchiveTarget(deleteTarget);
                    setDeleteTarget(null);
                  }}
                  className="font-semibold text-[#1D4E89] hover:underline cursor-pointer"
                >
                  Archive it instead
                </button>{' '}
                to keep the records.
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[38px] px-4 text-xs font-semibold text-[#122654] hover:bg-[#F5F8FD] border border-[#D3DCEE] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(keptYear)}
                onClick={() => {
                  deleteCompany(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="min-h-[38px] px-4 text-xs font-bold text-white bg-[#B42318] hover:bg-[#911c13] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Company</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
