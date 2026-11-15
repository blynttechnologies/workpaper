import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';
import { WorkpaperBanner } from '../components/layout/WorkpaperBanner';
import { bannerMessages } from '../lib/workpaper-banner';

afterEach(cleanup);

describe('working paper banner', () => {
  it('leads with live counts, then the tips', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.status !== 'locked' && !db.clients.find((c) => c.id === e.client_id)?.archived_at)!;
    const papers = db.workpapers.filter((w) => w.engagement_id === eng.id);
    db.workpapers.forEach((w) => { if (w.status === 'unreconciled') w.status = 'in_progress'; });
    papers[0].status = 'unreconciled';
    papers[1].status = 'unreconciled';
    papers[1].applicable = true;

    const msgs = bannerMessages();
    expect(msgs[0]).toMatchObject({ kind: 'attention', text: '2 working papers do not agree to the trial balance' });
    expect(msgs.at(-1)!.kind).toBe('tip');
  });

  it('leaves out a count that is nothing', () => {
    db.seed(true);
    db.workpapers.forEach((w) => { if (w.status === 'unreconciled') w.status = 'in_progress'; });
    expect(bannerMessages().some((m) => m.kind === 'attention')).toBe(false);
  });

  it('steps through the messages', () => {
    db.seed(true);
    const total = bannerMessages().length;
    render(<WorkpaperBanner />);
    expect(screen.getByText(`1/${total}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next update' }));
    expect(screen.getByText(`2/${total}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous update' }));
    expect(screen.getByText(`${total}/${total}`)).toBeTruthy();
  });
});
