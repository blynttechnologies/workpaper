import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import LearningLibraryPage from '../app/(dashboard)/library/standards/page';
import { STANDARDS, requiredSchedules } from '../lib/standards';
import { TEMPLATES, templateFor } from '../lib/workpapers/templates';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const first = STANDARDS.filter((s) => !s.effective_to)[0];
const refs = requiredSchedules(first);
const lesson = templateFor(refs.find((r) => (templateFor(r)?.procedures.length ?? 0) > 3)!)!;
const progress = () => screen.getByRole('progressbar', { name: /Lessons learned/ }).getAttribute('aria-valuenow');

describe('learning library', () => {
  it('lists a lesson for every paper the standard needs', () => {
    render(<LearningLibraryPage />);
    expect(screen.getByRole('heading', { name: new RegExp(`the ${refs.length} working papers`) })).toBeTruthy();
    for (const r of refs) expect(screen.getByText(r)).toBeTruthy();
  });

  it('opens a lesson with why it matters and only the key steps, and remembers it as learned', () => {
    render(<LearningLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${lesson.ref}`) }));
    expect(screen.getByText(lesson.objective)).toBeTruthy();
    expect(screen.getByText(lesson.procedures[0])).toBeTruthy();
    expect(screen.queryByText(lesson.procedures[3])).toBeNull();
    expect(screen.getByText(new RegExp(`and ${lesson.procedures.length - 3} more steps`))).toBeTruthy();
    expect(progress()).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Mark as learned' }));
    expect(screen.getByRole('button', { name: 'Learned' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('blynt.learning.read')!)).toEqual([lesson.ref]);
    expect(progress()).toBe(String(Math.round(100 / refs.length)));
  });

  it('searches the lessons', () => {
    render(<LearningLibraryPage />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search lessons' }), { target: { value: 'zzzz-nothing' } });
    expect(screen.getByText(/No lesson matches/)).toBeTruthy();
  });

  it('starts with the first lesson and then carries on from the next one not learned', () => {
    render(<LearningLibraryPage />);
    const start = screen.getByRole('button', { name: new RegExp(`^Start learning: ${refs[0]}`) });
    fireEvent.click(start);
    expect(screen.getByText(templateFor(refs[0])!.objective)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as learned' }));
    expect(screen.getByRole('button', { name: new RegExp(`^Continue learning: ${refs[1]}`) })).toBeTruthy();
  });

  it('shows the Blynt family in the brand kit wording, and opens Blynt Bot', () => {
    const opened = vi.fn();
    window.addEventListener('blynt:open-bot', opened);
    render(<LearningLibraryPage />);
    const family = screen.getByRole('region', { name: 'The Blynt family' });
    expect(within(family).getByText('Sorts the routine work and suggests. You decide.')).toBeTruthy();
    expect(within(family).getByText('Create, send and chase invoices.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Meet Blynt Bot' })).getByRole('button', { name: /Ask Blynt Bot/ }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('blynt:open-bot', opened);
  });

  it('teaches every template briefly, without the full procedures', () => {
    render(<LearningLibraryPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Template guide/ }));
    const guide = screen.getByRole('region', { name: 'Template guide' });
    for (const t of TEMPLATES) expect(within(guide).getByRole('listitem', { name: `${t.ref} ${t.title}` })).toBeTruthy();
    expect(within(guide).queryByText(lesson.procedures[1])).toBeNull();
  });
});
