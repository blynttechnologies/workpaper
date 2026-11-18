'use client';

import { Notice } from '@/components/ui/Notice';
import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

/**
 * Run an AI review of the paper, or ask for a draft conclusion. Findings land in the paper's AI review list
 * (the workspace reloads after the request); a draft conclusion is shown here and is only used if
 * someone chooses to.
 */
export function AiPaperActions({ workpaperId, readOnly, onUseDraft, onDone }: { workpaperId: string; readOnly: boolean; onUseDraft?: (text: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState<'review' | 'draft' | null>(null);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');

  const call = async (kind: 'review' | 'draft') => {
    setBusy(kind);
    setMessage('');
    try {
      const res = await fetch(`/api/v1/workpapers/${encodeURIComponent(workpaperId)}/${kind === 'review' ? 'ai-review' : 'ai-draft'}`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) setMessage(j.error || 'The AI could not do that just now.');
      else if (kind === 'review') setMessage(j.findings.length ? `${j.findings.length} finding${j.findings.length === 1 ? '' : 's'} added below.${j.agreement === false ? ' A second model saw it differently.' : ''}` : 'The AI found nothing to raise.');
      else setDraft(j.draft);
    } catch {
      setMessage('The AI could not do that just now.');
    } finally {
      setBusy(null);
      onDone();
    }
  };

  if (readOnly) return null;
  return (
    <div className="flex flex-col gap-2 p-3 rounded-[10px] bg-[#F3F0FE] border border-[#DDD6FA]">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => call('review')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#DDD6FA] text-[11px] font-bold text-[#3F2A9E] cursor-pointer disabled:opacity-50">
          {busy === 'review' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Run AI review
        </button>
        {onUseDraft && (
          <button type="button" disabled={!!busy} onClick={() => call('draft')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#DDD6FA] text-[11px] font-bold text-[#3F2A9E] cursor-pointer disabled:opacity-50">
            {busy === 'draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Draft conclusion
          </button>
        )}
      </div>
      {message && <Notice tone="info" inline>{message}</Notice>}
      {draft && onUseDraft && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-[#122654] whitespace-pre-wrap bg-white rounded-lg p-2 border border-[#DDD6FA]">{draft}</p>
          <div className="flex gap-3">
            <button type="button" className="text-[11px] font-bold text-[#1D4E89] hover:underline cursor-pointer" onClick={() => { onUseDraft(draft); setDraft(''); }}>
              Use as conclusion
            </button>
            <button type="button" className="text-[11px] text-[#4A5878] hover:underline cursor-pointer" onClick={() => setDraft('')}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
