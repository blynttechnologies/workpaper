import { db } from '@/lib/server/db';

export type BannerKind = 'attention' | 'ready' | 'notes' | 'deadline' | 'tip';
export interface BannerMessage {
  kind: BannerKind;
  text: string;
  href: string;
  action: string;
}

// Short tips about what the app already does
const TIPS: BannerMessage[] = [
  { kind: 'tip', text: 'Filter a client’s working papers by Needs attention, In progress or Done', href: '/clients', action: 'Clients' },
  { kind: 'tip', text: 'Xero clients are checked every night; a moved balance shows in My work', href: '/my-work', action: 'My work' },
  { kind: 'tip', text: 'Press ⌘K to find any client, account or working paper', href: '/clients', action: 'Clients' },
];

/** Live working-paper messages from the practice's data, most urgent first, then the tips. */
export function bannerMessages(now = Date.now()): BannerMessage[] {
  const live = new Set(db.clients.filter((c) => !c.archived_at).map((c) => c.id));
  const engs = db.engagements.filter((e) => live.has(e.client_id) && e.status !== 'locked');
  const engIds = new Set(engs.map((e) => e.id));
  const papers = db.workpapers.filter((w) => engIds.has(w.engagement_id) && w.applicable !== false);
  const out: BannerMessage[] = [];

  const off = papers.filter((w) => w.status === 'unreconciled').length;
  if (off) out.push({ kind: 'attention', text: `${off} working paper${off === 1 ? ' does' : 's do'} not agree to the trial balance`, href: '/clients', action: 'Review' });
  const ready = papers.filter((w) => w.status === 'prepared').length;
  if (ready) out.push({ kind: 'ready', text: `${ready} working paper${ready === 1 ? ' is' : 's are'} prepared and ready for review`, href: '/review', action: 'Review' });
  const notes = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open').length;
  if (notes) out.push({ kind: 'notes', text: `${notes} review note${notes === 1 ? ' is' : 's are'} still open`, href: '/review', action: 'Open' });

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
    out.push({ kind: 'deadline', text: `${name}: accounts due for filing in ${soon.days} day${soon.days === 1 ? '' : 's'}`, href: `/clients/${soon.e.client_id}`, action: 'Open' });
  }
  return [...out, ...TIPS];
}

