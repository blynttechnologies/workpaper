import { db } from '@/lib/server/db';

export type BannerKind = 'attention' | 'ready' | 'notes' | 'deadline' | 'feature';
export interface BannerMessage {
  kind: BannerKind;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  action: string;
}

// What the app already does, told as short banners
const FEATURES: BannerMessage[] = [
  {
    kind: 'feature',
    eyebrow: 'Blynt Workpapers',
    title: 'Pull the trial balance straight from Xero',
    body: 'Connect a client once. Blynt checks every night and tells you in My work when a balance moves.',
    href: '/clients',
    action: 'Open clients',
  },
  {
    kind: 'feature',
    eyebrow: 'Blynt Workpapers',
    title: 'Every working paper, sorted by where it stands',
    body: 'On each client, papers are grouped by area and filtered by Needs attention, In progress or Done.',
    href: '/clients',
    action: 'See clients',
  },
  {
    kind: 'feature',
    eyebrow: 'Tax library',
    title: 'VAT rates checked against GOV.UK every weekend',
    body: 'Every rate and threshold is dated with its source, and a changed GOV.UK page is flagged for review.',
    href: '/library/tax',
    action: 'Tax library',
  },
];

/** Banners for the dashboard: live working-paper news first, most urgent first, then what Blynt can do. */
export function bannerMessages(now = Date.now()): BannerMessage[] {
  const live = new Set(db.clients.filter((c) => !c.archived_at).map((c) => c.id));
  const engs = db.engagements.filter((e) => live.has(e.client_id) && e.status !== 'locked');
  const engIds = new Set(engs.map((e) => e.id));
  const papers = db.workpapers.filter((w) => engIds.has(w.engagement_id) && w.applicable !== false);
  const out: BannerMessage[] = [];
  const s = (n: number) => (n === 1 ? '' : 's');

  const off = papers.filter((w) => w.status === 'unreconciled').length;
  if (off)
    out.push({ kind: 'attention', eyebrow: 'Needs attention', title: `${off} working paper${s(off)} ${off === 1 ? 'does' : 'do'} not agree to the trial balance`, body: 'Clear the differences and they move on to prepared, ready for review.', href: '/clients', action: 'Review papers' });
  const ready = papers.filter((w) => w.status === 'prepared').length;
  if (ready)
    out.push({ kind: 'ready', eyebrow: 'Ready for review', title: `${ready} working paper${s(ready)} ${ready === 1 ? 'is' : 'are'} prepared`, body: 'A reviewer can sign them off now.', href: '/review', action: 'Start review' });
  const notes = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open').length;
  if (notes)
    out.push({ kind: 'notes', eyebrow: 'Review notes', title: `${notes} review note${s(notes)} ${notes === 1 ? 'is' : 'are'} still open`, body: 'Reply to or resolve them to keep the files moving.', href: '/review', action: 'Open notes' });

  // Nearest statutory filing (9 months after year end) inside the next 60 days
  const soon = engs
    .map((e) => {
      const due = new Date(e.period_end);
      due.setMonth(due.getMonth() + 9);
      return { e, days: Math.ceil((due.getTime() - now) / 86400000) };
    })
    .filter((d) => d.days >= 0 && d.days <= 60)
    .sort((a, b) => a.days - b.days)[0];
  if (soon) {
    const name = db.clients.find((c) => c.id === soon.e.client_id)?.name ?? 'A client';
    out.push({ kind: 'deadline', eyebrow: 'Deadline', title: `${name}: accounts due for filing in ${soon.days} day${s(soon.days)}`, body: 'Statutory accounts are due nine months after the year end.', href: `/clients/${soon.e.client_id}`, action: 'Open client' });
  }
  return [...out, ...FEATURES];
}
