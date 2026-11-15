// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { amount, pullTaxFigures } from '../lib/server/tax-pull';
import { TAX_KEYS } from '../lib/tax';

// A stand-in GOV.UK Content API with the wording the real pages use (checked against them on 15 Nov 2026)
const pages = (standardRate = '20') =>
  (async (url: string) => {
    const slug = String(url).split('/api/content/')[1];
    const body = ({
      'vat-rates': { details: { body: `<table><tr><td>Standard rate</td><td>${standardRate}%</td></tr><tr><td>Reduced rate</td><td>5%</td></tr><tr><td>Zero rate</td><td>0%</td></tr></table>` } },
      'register-for-vat': {
        details: {
          parts: [
            { slug: 'when-register-for-vat', body: '<p>your total taxable turnover for the last 12 months goes over £90,000 (the VAT threshold)</p>' },
            { slug: 'cancel-your-registration', body: '<p>If your taxable turnover falls below £88,000 you can ask</p>' },
          ],
        },
      },
      'vat-flat-rate-scheme': {
        details: {
          parts: [
            { slug: 'who-can-join', body: '<p>you expect your <abbr>VAT</abbr> taxable turnover to be £150,000 or less (excluding <abbr>VAT</abbr>)</p>' },
            { slug: 'how-much-you-pay', body: '<p>You get a 1% discount if you’re in your first year</p><p>This means you pay a higher rate of 16.5%.</p>' },
          ],
        },
      },
      'vat-cash-accounting-scheme': { details: { parts: [{ slug: 'eligibility', body: '<p>your estimated VAT taxable turnover is £1.35 million or less in the next 12 months</p>' }] } },
    } as Record<string, unknown>)[slug];
    return body ? Response.json(body) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;

describe('pull from GOV.UK', () => {
  it('reads each figure and sets it beside the library', async () => {
    const figures = await pullTaxFigures(pages(), undefined, '2026-11-15');
    const by = (k: string) => figures.find((f) => f.key === k)!;
    expect(by('vat.rate.standard')).toMatchObject({ gov: 20, library: 20, status: 'match' });
    expect(by('vat.threshold.registration')).toMatchObject({ gov: 90000, status: 'match' });
    expect(by('vat.flat_rate.join')).toMatchObject({ gov: 150000, status: 'match' });
    expect(by('vat.cash.join')).toMatchObject({ gov: 1350000, status: 'match' });
  });

  it('flags a figure GOV.UK states differently', async () => {
    const figures = await pullTaxFigures(pages('22'), undefined, '2026-11-15');
    expect(figures.find((f) => f.key === 'vat.rate.standard')).toMatchObject({ gov: 22, library: 20, status: 'differs' });
  });

  it('says when a page cannot be read instead of guessing', async () => {
    const figures = await pullTaxFigures(pages(), undefined, '2026-11-15');
    expect(figures.find((f) => f.key === 'vat.annual.join')).toMatchObject({ gov: null, status: 'unread' });
  });

  it('reads amounts written in millions', () => {
    expect(amount('1.35 million')).toBe(1350000);
    expect(amount('90,000')).toBe(90000);
  });

  it('only pulls figures the library knows', async () => {
    const figures = await pullTaxFigures(pages(), undefined, '2026-11-15');
    expect(figures.every((f) => TAX_KEYS.some((t) => t.key === f.key))).toBe(true);
  });
});
