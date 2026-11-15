import crypto from 'crypto';
import { db } from './db';
import { ServiceError } from './services';
import type { Actor } from './state-guard';
import { TAX_KEYS, type TaxEntry } from '../tax';

const MANAGER_UP = ['manager', 'partner', 'admin'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function firmOf(actor: Actor) {
  if (!MANAGER_UP.includes(actor.role)) throw new ServiceError('Only a manager or above can change the tax library.', 403, 'FORBIDDEN');
  const firm = db.firms.find((f) => f.id === actor.firmId);
  if (!firm) throw new ServiceError('Practice not found', 404, 'NOT_FOUND');
  return firm;
}

/** A practice's own dated entry for a library key, e.g. a new threshold from a date. It wins over the built-in entry for its dates. */
export function addTaxEntry(actor: Actor, d: { key?: unknown; value?: unknown; from?: unknown; to?: unknown; source?: unknown; note?: unknown }): TaxEntry {
  const firm = firmOf(actor);
  const base = TAX_KEYS.find((t) => t.key === d.key);
  if (!base) throw new ServiceError('Choose what the entry is for.');
  const value = Number(d.value);
  if (!Number.isFinite(value) || value < 0 || (base.unit === '%' && value > 100)) throw new ServiceError(base.unit === '%' ? 'Enter a percentage from 0 to 100.' : 'Enter an amount of nil or more.');
  const from = String(d.from ?? '');
  const to = d.to ? String(d.to) : undefined;
  if (!DATE.test(from)) throw new ServiceError('Enter the date it applies from.');
  if (to && (!DATE.test(to) || to < from)) throw new ServiceError('The end date must be on or after the start date.');
  const source = String(d.source ?? '').trim().slice(0, 300);
  if (!source) throw new ServiceError('Give the source, such as the HMRC notice or GOV.UK page.');
  const entry: TaxEntry = {
    id: `tax_${crypto.randomUUID()}`,
    key: base.key,
    label: base.label,
    group: base.group,
    value,
    unit: base.unit,
    from,
    ...(to ? { to } : {}),
    source,
    ...(String(d.note ?? '').trim() ? { note: String(d.note).trim().slice(0, 500) } : {}),
    added_by: actor.name,
    added_at: new Date().toISOString(),
  };
  firm.settings = { ...(firm.settings ?? {}), tax_entries: [...(firm.settings?.tax_entries ?? []), entry] };
  db.logAudit(actor.firmId, actor, 'ADD_TAX_ENTRY', 'firms', firm.id, null, entry);
  return entry;
}

export function removeTaxEntry(actor: Actor, id: string) {
  const firm = firmOf(actor);
  const entry = (firm.settings?.tax_entries ?? []).find((t) => t.id === id);
  if (!entry) throw new ServiceError('That entry is not in the practice library.', 404, 'NOT_FOUND');
  firm.settings = { ...(firm.settings ?? {}), tax_entries: (firm.settings?.tax_entries ?? []).filter((t) => t.id !== id) };
  db.logAudit(actor.firmId, actor, 'REMOVE_TAX_ENTRY', 'firms', firm.id, entry, null);
}
