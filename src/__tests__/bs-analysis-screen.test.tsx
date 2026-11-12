import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { BsAnalysisSchedule } from '../components/workpaper/papers/bs-analysis';

afterEach(cleanup);

describe('balance sheet analysis screen', () => {
  it('renders the seeded file and records the going concern decision', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'Z-40') ?? db.addWorkpaper(eng.id, 'Z-40')!;
    db.workpapers.some((w) => w.engagement_id === eng.id && w.ref === 'D-20') || db.addWorkpaper(eng.id, 'D-20');
    const saved: Record<string, any>[] = [];
    render(
      <BsAnalysisSchedule
        data={wp.data_json}
        result={evaluatePaper(wp)!}
        locked={false}
        save={(p) => saved.push(p)}
        filesFor={() => []}
        attachTo={() => {}}
        preview={() => {}}
        tickFor={() => null}
        live={() => wp.data_json}
      />
    );
    expect(screen.getAllByText('Balance sheet').length).toBeGreaterThan(0);
    expect(screen.getByText('Size test')).toBeTruthy();
    expect(screen.getAllByText(/Director.s loan/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Agree: no indicators'));
    expect(saved).toContainEqual({ going_concern: 'none' });
  });
});
