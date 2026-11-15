'use client';

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { formatPence, formatPenceInput, toPence } from '@/lib/money';

const SHARES = [100, 75, 50, 25];

const parse = (s: string): bigint | null => {
  try {
    return s.trim() ? toPence(s) : null;
  } catch {
    return null;
  }
};

/**
 * Choosing a specific provision for one customer: a share of what is still due after receipts since the
 * period end, a custom amount, or the AI's suggestion with its reason. Saves the amount and how it was set.
 */
export function ProvisionPicker({
  engagementId,
  paperRef,
  lineId,
  customer,
  stillDue,
  start,
  onSave,
  onCancel,
}: {
  engagementId: string;
  paperRef: string;
  lineId: string;
  customer: string;
  stillDue: bigint;
  start: bigint;
  onSave: (amount_p: string, reason: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(formatPenceInput(start));
  const [how, setHow] = useState('');
  const [ai, setAi] = useState<{ percent: number; amount_p: string; reason: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const pence = parse(amount);
  const valid = pence !== null && pence > 0n && pence <= stillDue;

  const share = (pct: number) => {
    setAmount(formatPenceInput((stillDue * BigInt(pct)) / 100n));
    setHow(`${pct}% of ${formatPence(stillDue)} still due`);
  };
  const askAi = async () => {
    setAsking(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(engagementId)}/ai-provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: paperRef, lineId }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'The AI could not suggest a provision. Try again.');
      setAi(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const chip = 'px-2 py-1 text-[11px] font-semibold rounded-[6px] border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]/40 cursor-pointer';

  return (
    <div role="dialog" aria-label={`Provision for ${customer}`} className="absolute right-0 top-full mt-1 z-30 w-80 p-3 bg-white border border-[#D3DCEE] rounded-[10px] shadow-xl text-left text-[11px] text-[#122654] flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-bold">Provision for {customer}</span>
        <button type="button" onClick={onCancel} aria-label="Close" className="text-[#4A5878] cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <span className="text-[#4A5878]">{formatPence(stillDue)} is still due after receipts since the period end.</span>
      <div className="flex flex-wrap gap-1">
        {SHARES.map((p) => (
          <button key={p} type="button" onClick={() => share(p)} className={chip}>
            {p}%
          </button>
        ))}
        <button type="button" onClick={askAi} disabled={asking} className={`${chip} inline-flex items-center gap-1 text-[#B8432F] disabled:opacity-60`}>
          <Sparkles className="w-3 h-3" /> {asking ? 'Asking…' : 'Ask AI'}
        </button>
      </div>
      {ai && (
        <div className="p-2 rounded-[8px] bg-[#FFF8F6] border border-[#FF7A66]/30 flex flex-col gap-1">
          <span>
            <span className="font-bold">AI suggests {ai.percent}%</span> ({formatPence(BigInt(ai.amount_p))}): {ai.reason}
          </span>
          <button
            type="button"
            onClick={() => {
              setAmount(formatPenceInput(BigInt(ai.amount_p)));
              setHow(`AI suggested ${ai.percent}%: ${ai.reason}`);
            }}
            className="self-start text-[#1D4E89] font-semibold underline cursor-pointer"
          >
            Use this
          </button>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-[#4A5878]">Amount to provide (£)</span>
        <input
          value={amount}
          inputMode="decimal"
          aria-label={`Provision amount for ${customer}`}
          onChange={(e) => {
            setAmount(e.target.value);
            setHow('');
          }}
          className={`min-h-[32px] px-2 border rounded-[8px] font-mono text-right ${valid ? 'border-[#D3DCEE]' : 'border-[#B8432F]'}`}
        />
      </label>
      {!valid && <span className="text-[#B42318]">Enter an amount above nil and up to {formatPence(stillDue)}.</span>}
      {error && <span role="alert" className="text-[#B42318]">{error}</span>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className={chip}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSave(pence!.toString(), how || (pence === stillDue ? `All of ${formatPence(stillDue)} still due` : `Custom amount of ${formatPence(stillDue)} still due`))}
          className="px-3 py-1 text-[11px] font-bold rounded-[6px] bg-[#122654] text-white cursor-pointer disabled:opacity-50"
        >
          Provide {valid ? formatPence(pence!) : ''}
        </button>
      </div>
    </div>
  );
}
