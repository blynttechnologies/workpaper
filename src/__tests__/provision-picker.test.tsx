import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProvisionPicker } from '../components/workpaper/ProvisionPicker';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = () => {
  const onSave = vi.fn();
  const onAi = vi.fn();
  render(<ProvisionPicker engagementId="eng_1" paperRef="C-10" lineId="deb_1" customer="Highway Stops Retail Ltd" stillDue={307014n} start={307014n} onSave={onSave} onAi={onAi} onCancel={() => {}} />);
  const amount = () => screen.getByLabelText(/Provision amount/) as HTMLInputElement;
  const save = () => screen.getByRole('button', { name: /^Provide/ });
  return { onSave, onAi, amount, save };
};

describe('choosing a bad debt provision', () => {
  it('starts on the suggestion and can take a share of what is still due', () => {
    const { onSave, amount, save } = setup();
    expect(amount().value).toBe('3070.14');
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(amount().value).toBe('1535.07');
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith('153507', '50% of £3,070.14 still due');
  });

  it('takes a custom amount, but not more than is still due', () => {
    const { onSave, amount, save } = setup();
    fireEvent.change(amount(), { target: { value: '5000' } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(amount(), { target: { value: '1200' } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith('120000', 'Custom amount of £3,070.14 still due');
  });

  it("asks the AI, shows its reason, and uses its amount when told to", async () => {
    const { onSave, onAi, amount, save } = setup();
    const answer = { percent: 40, amount_p: '122805', reason: 'Paid part of older invoices late; nothing since the period end.', classification: 'provide', confidence: 82, gate: 'check', source: 'ai', supplier: 'Highway Stops Retail Ltd' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.click(screen.getByRole('button', { name: /Ask AI/ }));
    expect(await screen.findByText(/AI suggests 40%/)).toBeTruthy();
    // The answer is handed back to be kept on the line, and the gate's reading of it is shown; neither fills in the amount
    expect(onAi).toHaveBeenCalledWith(answer);
    expect(screen.getByText('Check')).toBeTruthy();
    expect(screen.getByText(/AI 82% sure/)).toBeTruthy();
    expect(amount().value).toBe('3070.14');
    expect(onSave).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/engagements/eng_1/ai-provision', expect.objectContaining({ body: JSON.stringify({ ref: 'C-10', lineId: 'deb_1' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(amount().value).toBe('1228.05');
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith('122805', 'AI suggested 40%: Paid part of older invoices late; nothing since the period end.');
  });
});
