// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ask, AskHost } from '../components/ui/ask';

afterEach(cleanup);

describe('Blynt confirm, prompt and notice boxes', () => {
  it('confirm resolves true on the action button and false on Cancel', async () => {
    render(<AskHost />);
    let answer!: Promise<boolean>;
    act(() => { answer = ask.confirm({ title: 'Delete this file?', text: 'It goes to the bin.', action: 'Delete', danger: true }); });
    expect(screen.getByRole('dialog').textContent).toContain('It goes to the bin.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await answer).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => { answer = ask.confirm({ title: 'Delete this file?' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBe(false);
  });

  it('text refuses an answer that is too short, then resolves the trimmed answer', async () => {
    render(<AskHost />);
    let answer!: Promise<string | null>;
    act(() => { answer = ask.text({ title: 'Why?', label: 'Reason', action: 'Approve', minLength: 10 }); });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 10/);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  sole practitioner  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await answer).toBe('sole practitioner');
  });

  it('asks one at a time when two arrive together', async () => {
    render(<AskHost />);
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = ask.tell({ title: 'One' }); second = ask.tell({ title: 'Two' }); });
    expect(screen.getByRole('dialog').textContent).toContain('One');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await first;
    expect(screen.getByRole('dialog').textContent).toContain('Two');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await second;
  });
});
