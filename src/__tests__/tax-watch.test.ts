import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/server/db';
import { acknowledgeTaxPage, fetchTaxSources, recordTaxCheck, taxCheckDue, taxSourcePages } from '../lib/server/tax-watch';

// A stand-in GOV.UK Content API: vat-registration redirects to register-for-vat, as the real one does
const govUk = (dates: Record<string, string>, down: string[] = []) =>
  (async (url: string) => {
    const path = String(url).split('/api/content/')[1];
    if (down.includes(path)) return new Response('', { status: 503 });
    if (path === 'vat-registration') return Response.json({ document_type: 'redirect', redirects: [{ destination: '/register-for-vat' }] });
    return Response.json({ document_type: 'guide', title: `Page ${path}`, public_updated_at: dates[path] ?? '2024-01-01T00:00:00+00:00' });
  }) as unknown as typeof fetch;

const admin = () => {
  const m = db.memberships.find((x) => x.role === 'admin')!;
  return { id: m.user_id, name: 'Admin', role: 'admin' as const, firmId: m.firm_id };
};

describe('weekly GOV.UK check of the tax library sources', () => {
  beforeEach(() => db.seed(true));

  it('follows redirects and checks each page once', async () => {
    const results = await fetchTaxSources(govUk({}));
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('register-for-vat');
    expect(slugs).not.toContain('vat-registration');
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(results.find((r) => r.slug === 'register-for-vat')!.cited).toEqual(expect.arrayContaining(['vat-registration', 'register-for-vat']));
    expect(taxSourcePages().length).toBeGreaterThan(results.length - 1);
  });

  it('records the first run, flags a page whose date moved, and clears it once checked', async () => {
    recordTaxCheck(await fetchTaxSources(govUk({})));
    const firm = db.firms.find((f) => f.id === admin().firmId)!;
    expect(Object.values(firm.settings!.tax_watch!.pages).some((p) => p.changed)).toBe(false);

    const second = recordTaxCheck(await fetchTaxSources(govUk({ 'vat-rates': '2026-11-20T09:00:00+00:00' })));
    expect(second.changed).toEqual(['vat-rates']);
    expect(firm.settings!.tax_watch!.pages['vat-rates'].changed).toBe(true);

    // Still flagged on the next run even though the date no longer moves
    recordTaxCheck(await fetchTaxSources(govUk({ 'vat-rates': '2026-11-20T09:00:00+00:00' })));
    expect(firm.settings!.tax_watch!.pages['vat-rates'].changed).toBe(true);

    acknowledgeTaxPage(admin(), 'vat-rates');
    expect(firm.settings!.tax_watch!.pages['vat-rates'].changed).toBe(false);
    expect(db.audit_logs.some((l) => l.action === 'CHECK_TAX_SOURCE')).toBe(true);
  });

  it('reports a page it could not reach without forgetting what it knew', async () => {
    recordTaxCheck(await fetchTaxSources(govUk({})));
    const run = recordTaxCheck(await fetchTaxSources(govUk({}, ['vat-rates'])));
    expect(run.failed[0]).toMatch(/^vat-rates: GOV.UK answered 503/);
    const watch = db.firms[0].settings!.tax_watch!;
    expect(watch.failed).toEqual(['vat-rates']);
    expect(watch.pages['vat-rates']).toBeTruthy();
  });

  it('lets only a manager or above mark a page checked', async () => {
    recordTaxCheck(await fetchTaxSources(govUk({})));
    expect(() => acknowledgeTaxPage({ ...admin(), role: 'preparer' }, 'vat-rates')).toThrow(/manager/);
  });

  it('runs once a weekend', () => {
    const saturday = new Date('2026-11-21T22:00:00Z');
    const friday = new Date('2026-11-20T22:00:00Z');
    expect(taxCheckDue(friday)).toBe(false);
    expect(taxCheckDue(saturday)).toBe(true);
    recordTaxCheck([], saturday);
    expect(taxCheckDue(new Date('2026-11-22T22:00:00Z'))).toBe(false); // Sunday, already done
    expect(taxCheckDue(new Date('2026-11-28T22:00:00Z'))).toBe(true); // next Saturday
  });
});
