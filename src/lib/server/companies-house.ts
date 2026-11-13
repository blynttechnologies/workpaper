/**
 * Companies House public data API: the company profile, officers and people with significant
 * control, turned into the Statutory information paper's people and company details.
 * Share counts are not in the API (they are only in the confirmation statement), so shareholders
 * found as PSCs come with their ownership band and the number of shares is left to enter.
 */

const BASE = 'https://api.company-information.service.gov.uk';

export interface ChPerson {
  first_name: string;
  surname: string;
  is_director: boolean;
  is_secretary: boolean;
  is_shareholder: boolean;
  psc: boolean;
  appointed?: string;
  resigned?: string;
  /** e.g. "25-50%" from the PSC register */
  ownership?: string;
}

export interface ChCompany {
  registered_office: string;
  incorporated: string;
  sic: string;
  last_cs: string;
  next_cs: string;
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** "SURNAME, Forename Middle" as Companies House writes officer names. */
function splitName(name: string) {
  const [surname, rest = ''] = name.split(',');
  return { surname: title(surname.trim()), first_name: rest.trim().split(/\s+/)[0] ?? '' };
}

const key = (p: { first_name: string; surname: string }) => `${p.first_name} ${p.surname}`.toLowerCase();

/** The API's JSON to the paper's people and company details. */
export function fromCompaniesHouse(profile: any, officers: any, pscs: any): { people: ChPerson[]; company: ChCompany } {
  const people = new Map<string, ChPerson>();
  for (const o of officers?.items ?? []) {
    const role = String(o.officer_role ?? '');
    if (!/director|secretary/.test(role)) continue;
    const n = splitName(String(o.name ?? ''));
    const prev = people.get(key(n));
    // The same person can hold several appointments; keep the current one's dates
    const current = !o.resigned_on;
    people.set(key(n), {
      ...n,
      is_director: (prev?.is_director ?? false) || (role.includes('director') && current),
      is_secretary: (prev?.is_secretary ?? false) || (role.includes('secretary') && current),
      is_shareholder: false,
      psc: false,
      appointed: current || !prev ? o.appointed_on : prev.appointed,
      resigned: current ? undefined : (prev?.resigned ?? o.resigned_on),
    });
  }
  for (const p of pscs?.items ?? []) {
    if (p.ceased_on || !String(p.kind ?? '').startsWith('individual')) continue;
    const e = p.name_elements ?? {};
    const n = { first_name: title(e.forename ?? ''), surname: title(e.surname ?? '') };
    const band = (p.natures_of_control ?? []).map((c: string) => /ownership-of-shares-(\d+)-to-(\d+)/.exec(c) ?? /ownership-of-shares-(more-than-25)/.exec(c)).find(Boolean);
    const ownership = band ? (band[2] ? `${band[1]}-${band[2]}%` : 'over 25%') : undefined;
    const prev = people.get(key(n));
    people.set(key(n), { ...(prev ?? { ...n, is_director: false, is_secretary: false }), psc: true, is_shareholder: !!band || !!prev?.is_shareholder, ownership });
  }
  const a = profile?.registered_office_address ?? {};
  return {
    people: [...people.values()],
    company: {
      registered_office: [a.care_of, a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code].filter(Boolean).join(', '),
      incorporated: profile?.date_of_creation ?? '',
      sic: (profile?.sic_codes ?? []).join(', '),
      last_cs: profile?.confirmation_statement?.last_made_up_to ?? '',
      next_cs: profile?.confirmation_statement?.next_due ?? '',
    },
  };
}

/** Null when no API key is set. Throws when Companies House answers with an error. */
export async function readCompaniesHouse(companyNumber: string) {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) return null;
  const n = encodeURIComponent(companyNumber.trim().toUpperCase());
  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Companies House answered ${res.status} for ${path}`);
    return res.json();
  };
  const profile = await get(`/company/${n}`);
  if (!profile) return { found: false as const };
  const [officers, pscs] = await Promise.all([get(`/company/${n}/officers?items_per_page=100`), get(`/company/${n}/persons-with-significant-control?items_per_page=100`)]);
  return { found: true as const, name: String(profile.company_name ?? ''), ...fromCompaniesHouse(profile, officers, pscs) };
}
