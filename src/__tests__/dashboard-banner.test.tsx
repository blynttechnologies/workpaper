import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';
import { DashboardBanner } from '../components/dashboard/DashboardBanner';
import { bannerMessages } from '../lib/workpaper-banner';

afterEach(cleanup);

describe('dashboard banner', () => {
  it('leads with live working-paper news, then the feature banners', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.status !== 'locked' && !db.clients.find((c) => c.id === e.client_id)?.archived_at)!;
    const papers = db.workpapers.filter((w) => w.engagement_id === eng.id);
    db.workpapers.forEach((w) => { if (w.status === 'unreconciled') w.status = 'in_progress'; });
    papers[0].status = 'unreconciled';
    papers[1].status = 'unreconciled';
    papers[1].applicable = true;

    const msgs = bannerMessages();
    expect(msgs[0]).toMatchObject({ kind: 'attention', title: '2 working papers do not agree to the trial balance' });
    expect(msgs.at(-1)!.kind).toBe('feature');
  });

  it('leaves out news that is nothing', () => {
    db.seed(true);
    db.workpapers.forEach((w) => { if (w.status === 'unreconciled') w.status = 'in_progress'; });
    expect(bannerMessages().some((m) => m.kind === 'attention')).toBe(false);
  });

  it('steps through the slides with the arrows and the dots', () => {
    db.seed(true);
    const slides = bannerMessages();
    render(<DashboardBanner />);
    expect(screen.getByRole('heading', { name: slides[0].title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next update' }));
    expect(screen.getByRole('heading', { name: slides[1].title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous update' }));
    expect(screen.getByRole('heading', { name: slides.at(-1)!.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Slide 1 of ${slides.length}`) }));
    expect(screen.getByRole('heading', { name: slides[0].title })).toBeTruthy();
  });
});
