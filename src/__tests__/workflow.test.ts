import { describe, it, expect } from 'vitest';
import { buildWorkflow, nextStep, type WorkflowStep } from '@/lib/workflow';

const step = (key: string, state: WorkflowStep['state']): WorkflowStep => ({ key, title: key, unit: '', detail: '', state, done: 0, total: 0, href: '' });

describe('year workflow', () => {
  it('has the six steps in order and waits on the import for an empty engagement', () => {
    const steps = buildWorkflow('nothing_here');
    expect(steps.map((s) => s.key)).toEqual(['import', 'map', 'journals', 'papers', 'review', 'signoff']);
    expect(steps[0].state).toBe('todo');
    expect(steps[1]).toMatchObject({ state: 'blocked', blockedBy: 'Import the trial balance first' });
    expect(steps.every((s) => s.href.startsWith('/engagements/nothing_here/'))).toBe(true);
  });

  it('points to the step under way, not an optional one left to do', () => {
    const steps = [step('import', 'done'), step('map', 'done'), step('journals', 'todo'), step('papers', 'doing'), step('review', 'blocked')];
    expect(nextStep(steps)?.key).toBe('papers');
  });

  it('falls back to the first step ready to start, and to nothing once all are done', () => {
    expect(nextStep([step('import', 'done'), step('map', 'todo'), step('journals', 'todo')])?.key).toBe('map');
    expect(nextStep([step('import', 'done'), step('map', 'done')])).toBeUndefined();
  });
});
