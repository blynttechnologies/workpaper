'use client';

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, Mail, Pencil, Trash2, UserPlus, X } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getCurrentUserId } from '@/lib/session';
import { ROLES, StaffEditor, StaffRow, cap } from '@/components/settings/StaffManager';
import { inviteEmail } from '@/lib/invite-email';

interface OpenInvite {
  id: string;
  name: string;
  email: string;
  role: string;
  expires_at: string;
  team_client_ids?: string[];
}

type Removing = { kind: 'staff' | 'invite'; id: string; name: string };

const cardCls = (on: boolean) => `relative rounded-[10px] border ${on ? 'bg-[#EEF2F9] border-[#1D4E89] ring-1 ring-[#1D4E89]' : 'bg-white border-[#D3DCEE] hover:border-[#A6B4D0]'}`;

/** The Team step: tick who works on a client, and add, change or remove staff without leaving it. */
export function TeamManager({ clientId, clientName, team, setTeam, invited, setInvited }: {
  clientId?: string; // not set while the client is still being created
  clientName: string;
  team: string[];
  setTeam: Dispatch<SetStateAction<string[]>>;
  invited: string[] | null;
  setInvited: Dispatch<SetStateAction<string[] | null>>;
}) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [invites, setInvites] = useState<OpenInvite[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [people, open] = await Promise.all([fetch('/api/v1/users'), fetch('/api/v1/invites')]);
      const body = await people.json().catch(() => ({}));
      if (!people.ok) return setError(body.error || 'Could not load staff.');
      const active: StaffRow[] = body.staff.filter((s: StaffRow) => s.status === 'active');
      // Only admins and partners can list invitations
      const pending: OpenInvite[] = open.ok ? (await open.json()).filter((i: OpenInvite) => new Date(i.expires_at) > new Date()) : [];
      setStaff(active);
      setInvites(pending);
      setTeam((t) => t.filter((id) => active.some((s) => s.id === id)));
      setInvited((v) => (v ?? pending.filter((i) => clientId && i.team_client_ids?.includes(clientId)).map((i) => i.id)).filter((id) => pending.some((i) => i.id === id)));
    } catch {
      setError('Could not reach the server. Try again.');
    }
  }, [clientId, setTeam, setInvited]);
  useEffect(() => {
    load();
  }, [load]);

  const me = getCurrentUserId();
  const myRole = staff?.find((s) => s.id === me)?.role;
  const canManage = myRole === 'admin' || myRole === 'partner' || db.firms[0]?.owner_user_id === me;
  const who = clientName || 'this client';

  const remove = async ({ kind, id }: Removing) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(kind === 'staff' ? `/api/v1/users/${encodeURIComponent(id)}` : `/api/v1/invites/${encodeURIComponent(id)}`, {
        method: kind === 'staff' ? 'PATCH' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        ...(kind === 'staff' ? { body: JSON.stringify({ status: 'deactivated' }) } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || 'Could not remove them. Try again.');
      setRemoving(null);
      await load();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const toggleInvite = (id: string) => setInvited((v) => ((v ?? []).includes(id) ? (v ?? []).filter((x) => x !== id) : [...(v ?? []), id]));

  // One person: assign tick, initial, name, role tag and access, then Edit/Remove (greyed out below admin or partner)
  const card = (id: string, on: boolean, onToggle: () => void, name: string, role: string, detail: string, actions: React.ReactNode) => (
    <div key={id} className={`${cardCls(on)} flex items-center gap-3 px-3 py-2.5`}>
      <button type="button" role="checkbox" aria-checked={on} aria-label={`${name} works on ${who}`} onClick={onToggle} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
        <span aria-hidden="true" className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-[#1D4E89] border-[#1D4E89]' : 'bg-white border-[#A6B4D0]'}`}>
          {on && <Check className="w-3 h-3 text-white" />}
        </span>
        <span aria-hidden="true" className="w-8 h-8 rounded-full bg-[#122654] text-white text-xs font-bold flex items-center justify-center shrink-0">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-[#122654] truncate">{name}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F5F8FD] border border-[#E3E7EF] text-[#4A5878] shrink-0">{role}</span>
          </span>
          <span className="block text-[10px] text-[#4A5878] truncate">{detail}</span>
        </span>
      </button>
      <span className="flex items-center gap-2.5 shrink-0">{actions}</span>
    </div>
  );
  const actionCls = 'text-[11px] font-semibold text-[#4A5878] hover:text-[#122654] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#4A5878]';
  const hintId = canManage ? undefined : 'team-manage-hint';

  return (
    <div className="mt-6 space-y-3">
      {error && (
        <p role="alert" className="text-xs text-[#B42318] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}
      {!staff && !error && (
        <p className="text-xs text-[#4A5878]">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading staff…
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-[#4A5878]">
          {staff ? `${staff.length} staff${invites.length ? ` · ${invites.length} invited` : ''} · tick who works on ${who}` : ''}
        </p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!canManage}
          aria-describedby={hintId}
          className="inline-flex items-center gap-1.5 min-h-[32px] px-3 bg-[#122654] hover:bg-[#0B1A3B] rounded-lg text-[11px] font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UserPlus className="w-3.5 h-3.5" /> Add staff
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2" role="group" aria-label="Team">
        {staff?.map((s) =>
          card(s.id, team.includes(s.id), () => toggle(s.id), s.name, cap(s.role), s.access === 'all' ? 'Sees all clients' : `${s.client_count} ${s.client_count === 1 ? 'client' : 'clients'}`, (
            <>
              <button type="button" onClick={() => setEditing(s)} disabled={!canManage} aria-describedby={hintId} aria-label={`Edit ${s.name}`} className={actionCls}>
                <Pencil className="w-3 h-3 inline mr-0.5" aria-hidden="true" />Edit
              </button>
              {s.id !== me && (
                <button type="button" onClick={() => setRemoving({ kind: 'staff', id: s.id, name: s.name })} disabled={!canManage} aria-describedby={hintId} aria-label={`Remove ${s.name}`} className={`${actionCls} hover:text-[#B42318]`}>
                  <Trash2 className="w-3 h-3 inline mr-0.5" aria-hidden="true" />Remove
                </button>
              )}
            </>
          ))
        )}
        {invites.map((i) =>
          card(i.id, Boolean(invited?.includes(i.id)), () => toggleInvite(i.id), i.name, cap(i.role), 'Invited, not joined yet', (
            <button type="button" onClick={() => setRemoving({ kind: 'invite', id: i.id, name: i.name })} disabled={!canManage} aria-describedby={hintId} aria-label={`Cancel invitation for ${i.name}`} className={`${actionCls} hover:text-[#B42318]`}>
              <Trash2 className="w-3 h-3 inline mr-0.5" aria-hidden="true" />Cancel
            </button>
          ))
        )}
      </div>

      {!canManage && staff && (
        <p id="team-manage-hint" className="text-[11px] text-[#6B4700]">
          Only an admin or partner can add, edit or remove staff. Anyone can tick who works on this client.
        </p>
      )}

      {removing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" role="alertdialog" aria-modal="true" aria-label={`Remove ${removing.name}`}>
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 space-y-3 text-[#122654]">
            <h2 className="text-base font-bold">{removing.kind === 'staff' ? `Remove ${removing.name}?` : `Cancel invitation for ${removing.name}?`}</h2>
            <p className="text-xs text-[#4A5878]">
              {removing.kind === 'staff'
                ? 'They won’t be able to sign in. Their past work stays on file, and you can bring them back from Settings > Staff.'
                : 'Their invitation link will stop working.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setRemoving(null)} className="min-h-[36px] px-3 text-xs font-bold cursor-pointer">Keep</button>
              <button type="button" disabled={busy} onClick={() => remove(removing)} className="min-h-[36px] px-3 bg-[#B42318] text-white text-xs font-bold rounded-[8px] cursor-pointer disabled:opacity-60">
                {busy ? 'Removing…' : removing.kind === 'staff' ? 'Remove' : 'Cancel invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <StaffEditor
          person={editing}
          isSelf={editing.id === me}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            // Keep the tick in step with the client list just saved
            if (clientId && saved.client_ids) setTeam((t) => (saved.client_ids!.includes(clientId) ? [...new Set([...t, saved.id])] : t.filter((x) => x !== saved.id)));
            load();
          }}
        />
      )}

      {adding && (
        <AddStaff
          clientId={clientId}
          clientName={who}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setInvited((v) => [...(v ?? []), id]);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddStaff({ clientId, clientName, onClose, onAdded }: { clientId?: string; clientName: string; onClose: () => void; onAdded: (inviteId: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('preparer');
  const [allClients, setAllClients] = useState(false);
  const [clientIds, setClientIds] = useState<string[]>(clientId ? [clientId] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const clients = db.clients.filter((c) => !c.archived_at);
  const seesAll = role === 'partner' || role === 'admin';
  const field = 'mt-1 w-full min-h-[38px] px-3 border border-[#D3DCEE] rounded-[8px] disabled:bg-[#F5F8FD]';
  const invite = inviteEmail(name.trim(), role, link, db.firms[0]?.name);

  const submit = async () => {
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Enter a name and a valid email address.');
    if (!seesAll && !allClients && clientId && !clientIds.length) return setError('Choose at least one client, or give access to all clients.');
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role, ...(seesAll || allClients ? {} : { client_ids: clientIds }) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error || 'Could not add them. Try again.');
      setLink(body.link);
      setEmailed(Boolean(body.emailed));
      onAdded(body.invite.id);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Add staff">
      <div className="w-full max-w-md h-full bg-white shadow-xl flex flex-col text-xs text-[#122654]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E7EF]">
          <h2 className="text-base font-bold">Add staff</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-[#4A5878] hover:text-[#122654] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section className="space-y-3">
            <label className="block font-semibold">
              Name
              <input autoFocus value={name} disabled={Boolean(link)} onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            <label className="block font-semibold">
              Work email
              <input type="email" value={email} disabled={Boolean(link)} onChange={(e) => setEmail(e.target.value)} className={field} />
            </label>
            <label className="block font-semibold">
              Role
              <select value={role} disabled={Boolean(link)} onChange={(e) => setRole(e.target.value)} className={`${field} bg-white`}>
                {ROLES.map(([r, desc]) => (
                  <option key={r} value={r}>{cap(r)}: {desc}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold">Which clients?</h3>
            {seesAll ? (
              <p className="text-[11px] text-[#4A5878]">Partners and admins see every client.</p>
            ) : (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allClients} disabled={Boolean(link)} onChange={(e) => setAllClients(e.target.checked)} />
                  <span>All clients</span>
                </label>
                {!allClients && (
                  <div className="border border-[#E3E7EF] rounded-[8px] divide-y divide-[#E3E7EF] max-h-56 overflow-y-auto">
                    {!clientId && <p className="px-3 py-2 font-semibold">{clientName} (added when you finish)</p>}
                    {clients.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={Boolean(link)}
                          checked={clientIds.includes(c.id)}
                          onChange={() => setClientIds(clientIds.includes(c.id) ? clientIds.filter((x) => x !== c.id) : [...clientIds, c.id])}
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {link && (
            <div className="p-2.5 rounded-[8px] bg-[#F5F8FD] border border-[#E3E7EF] space-y-1.5">
              <p role="status" className={`font-semibold flex items-center gap-1.5 ${emailed ? 'text-[#0B6B52]' : 'text-[#8A5A00]'}`}>
                {emailed ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {emailed ? `Invitation emailed to ${email.trim()}.` : 'The email could not be sent automatically. Send it with a button below.'}
              </p>
              <label htmlFor="invite-link" className="block font-semibold">Invitation link (valid for 7 days)</label>
              <div className="flex gap-1.5">
                <input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 min-h-[34px] px-2 border border-[#D3DCEE] rounded-[6px] bg-white font-mono text-[11px]" />
                <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))} className="min-h-[34px] px-2.5 bg-[#122654] text-white font-bold rounded-[6px] cursor-pointer">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <a href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(invite.subject)}&body=${encodeURIComponent(invite.body)}`} className="min-h-[32px] px-2.5 inline-flex items-center gap-1 bg-[#122654] text-white font-bold rounded-[6px]">
                  <Mail className="w-3.5 h-3.5" /> Email invite
                </a>
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email.trim())}&su=${encodeURIComponent(invite.subject)}&body=${encodeURIComponent(invite.body)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[32px] px-2.5 inline-flex items-center border border-[#D3DCEE] bg-white text-[#122654] font-bold rounded-[6px]"
                >
                  Send with Gmail
                </a>
                <button type="button" onClick={() => navigator.clipboard?.writeText(invite.body).then(() => setCopiedMsg(true))} className="min-h-[32px] px-2.5 font-bold text-[#122654] underline cursor-pointer">
                  {copiedMsg ? 'Message copied' : 'Copy message'}
                </button>
              </div>
              <p className="text-[11px] text-[#4A5878]">{emailed ? 'Send it again yourself if it does not arrive. ' : ''}The link is only shown once.</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[11px] font-medium text-[#B42318] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E3E7EF]">
          <button type="button" onClick={onClose} className="min-h-[36px] px-3 font-bold cursor-pointer">{link ? 'Done' : 'Cancel'}</button>
          {!link && (
            <button type="button" disabled={busy} onClick={submit} className="min-h-[36px] px-4 bg-[#122654] hover:bg-[#0B1A3B] text-white font-bold rounded-[8px] cursor-pointer disabled:opacity-60">
              {busy ? 'Adding…' : 'Add and create invitation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
