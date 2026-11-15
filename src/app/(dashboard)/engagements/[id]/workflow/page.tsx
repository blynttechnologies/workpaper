'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Check, Lock, PartyPopper } from 'lucide-react';
import { db } from '@/lib/server/db';
import { buildWorkflow, nextStep, StepState } from '@/lib/workflow';
import { ukDate } from '@/lib/dates';

const STATE: Record<StepState, { label: string; pill: string }> = {
  todo: { label: 'To do', pill: 'bg-[#F5F8FD] text-[#4A5878]' },
  doing: { label: 'In progress', pill: 'bg-[#EAF5FC] text-[#1D4E89]' },
  done: { label: 'Done', pill: 'bg-[#E6F4EF] text-[#0B6B52]' },
  blocked: { label: 'Waiting', pill: 'bg-[#FFF8E6] text-[#8A5A00]' },
};

// What each step is for, in a line, and what its button says
const HELP: Record<string, { why: string; action: string }> = {
  import: { why: 'Bring in the year’s trial balance from Xero, QuickBooks or a file.', action: 'Import' },
  map: { why: 'Match each account to the Blynt chart so the papers and accounts pick it up.', action: 'Map accounts' },
  journals: { why: 'Record any adjustments the year needs, such as accruals or corrections. Skip it if none are needed.', action: 'Open journals' },
  papers: { why: 'Work through each working paper until it agrees to the trial balance.', action: 'Open papers' },
  review: { why: 'A reviewer raises points on the papers; answer or resolve each one.', action: 'Open review' },
  signoff: { why: 'Sign off the papers and lock the year so nothing changes afterwards.', action: 'Sign off' },
};

export default function WorkflowPage() {
  const engagementId = (useParams()?.id as string) ?? '';
  const eng = db.engagements.find((e) => e.id === engagementId);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  const steps = buildWorkflow(engagementId);
  const finished = steps.filter((s) => s.state === 'done').length;
  const next = nextStep(steps);
  const nextNo = next ? steps.indexOf(next) + 1 : 0;

  if (!eng) return <div className="p-6 text-sm text-[#4A5878]">Engagement not found.</div>;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#122654]">Workflow</h1>
          <p className="text-sm text-[#4A5878]">
            {client?.name ?? 'Client'} · {ukDate(eng.period_start)} to {ukDate(eng.period_end)}
          </p>
        </div>
        <div className="min-w-[180px]">
          <p className="text-[11px] text-[#4A5878] mb-1 text-right">
            <strong className="text-[#122654]">{finished}</strong> of {steps.length} steps done
          </p>
          <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished} aria-label="Workflow progress">
            {steps.map((s) => (
              <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.state === 'done' ? 'bg-[#0B6B52]' : s === next ? 'bg-[#FF7A66]' : 'bg-[#E3E7EF]'}`} />
            ))}
          </div>
        </div>
      </div>

      {/* What to do now */}
      {next ? (
        <section aria-label="Your next step" className="rounded-xl bg-gradient-to-r from-[#0B1A3B] to-[#1D4E89] text-white p-5 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#FF9C8C]">Your next step · {nextNo} of {steps.length}</p>
            <h2 className="mt-1 text-lg font-extrabold">{next.title}</h2>
            <p className="mt-0.5 text-xs text-white/75">{HELP[next.key]?.why}</p>
            <p className="mt-1 text-xs font-semibold text-white/90">{next.detail}</p>
          </div>
          <Link href={next.href} className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold transition-colors">
            {HELP[next.key]?.action ?? 'Open'} <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <section aria-label="Your next step" className="rounded-xl bg-[#E6F4EF] border border-[#0B6B52]/20 p-5 flex items-center gap-3">
          <PartyPopper className="w-6 h-6 text-[#0B6B52]" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-bold text-[#0B6B52]">Every step is done</h2>
            <p className="text-xs text-[#4A5878]">The year is signed off and locked.</p>
          </div>
        </section>
      )}

      {/* All the steps, as a timeline */}
      <ol className="bg-white border border-[#E3E7EF] rounded-xl p-2">
        {steps.map((s, i) => {
          const meta = STATE[s.state];
          const isNext = s === next;
          const last = i === steps.length - 1;
          return (
            <li key={s.key} className={`relative flex gap-3 p-3 rounded-lg ${isNext ? 'bg-[#FFF6F4]' : ''}`}>
              {/* The line joining this step to the next */}
              {!last && <span aria-hidden="true" className={`absolute left-[25px] top-11 bottom-[-12px] w-0.5 ${s.state === 'done' ? 'bg-[#0B6B52]' : 'bg-[#E3E7EF]'}`} />}
              <span
                className={`relative z-10 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  s.state === 'done' ? 'bg-[#0B6B52] text-white' : isNext ? 'bg-[#FF7A66] text-[#0B1A3B]' : s.state === 'blocked' ? 'bg-[#F5F8FD] text-[#7E8DA6]' : 'bg-[#EAF0F8] text-[#122654]'
                }`}
              >
                {s.state === 'done' ? <Check className="w-4 h-4" aria-hidden="true" /> : s.state === 'blocked' ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`text-sm font-semibold ${s.state === 'blocked' ? 'text-[#7E8DA6]' : 'text-[#122654]'}`}>{s.title}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
                </div>
                <p className="text-[11px] text-[#7E8DA6] mt-0.5">{HELP[s.key]?.why}</p>
                {s.state === 'blocked' ? (
                  <p className="text-[11px] font-semibold text-[#8A5A00] mt-1">Unlocks when: {s.blockedBy}</p>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] font-semibold text-[#4A5878]">{s.detail}</span>
                    {s.total > 1 && (
                      <span className="w-24 h-1.5 rounded-full bg-[#EAF0F8] overflow-hidden" aria-hidden="true">
                        <span className={`block h-full ${s.state === 'done' ? 'bg-[#0B6B52]' : 'bg-[#1D4E89]'}`} style={{ width: `${Math.min(100, (s.done / s.total) * 100)}%` }} />
                      </span>
                    )}
                  </div>
                )}
              </div>

              {s.state !== 'blocked' && (
                <Link
                  href={s.href}
                  aria-label={`${s.state === 'done' ? 'View' : HELP[s.key]?.action ?? 'Open'}: ${s.title}`}
                  className={`self-center shrink-0 inline-flex items-center gap-1 min-h-[30px] px-3 rounded-lg text-[11px] font-bold transition-colors ${
                    isNext ? 'bg-[#122654] text-white hover:bg-[#0B1A3B]' : 'border border-[#D3DCEE] text-[#122654] hover:border-[#122654]'
                  }`}
                >
                  {s.state === 'done' ? 'View' : HELP[s.key]?.action ?? 'Open'} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
