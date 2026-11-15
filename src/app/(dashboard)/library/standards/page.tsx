'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Check, CheckCircle2, ChevronDown, GraduationCap, HelpCircle, ListChecks, Search, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { STANDARDS, requiredSchedules } from '@/lib/standards';
import { TEMPLATES, templateFor, type TemplateDef } from '@/lib/workpapers/templates';

// Which lessons this browser has marked as learned: a per-person convenience, so browser storage is enough
const READ_KEY = 'blynt.learning.read';
// Lessons teach the shape of a paper, not the whole of it
const KEY_STEPS = 3;
const loadRead = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/**
 * Learning library (STD-01): the UK standards Blynt works to, taught from the app's own content. Each standard
 * shows who it is for, its key rules and the questions to ask on every file; each working paper it requires is a
 * lesson built from the paper's template (why it matters, what it proves, how to prepare it).
 */
export default function LearningLibraryPage() {
  const standards = STANDARDS.filter((s) => !s.effective_to);
  const [selected, setSelected] = useState(standards[0].id);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [read, setRead] = useState<string[]>([]);
  const [view, setView] = useState<'standards' | 'templates'>('standards');
  useEffect(() => setRead(loadRead()), []);

  const toggleRead = (ref: string) => {
    const next = read.includes(ref) ? read.filter((r) => r !== ref) : [...read, ref];
    setRead(next);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      // Private window or blocked storage: the tick still shows until the page closes
    }
  };

  const current = standards.find((s) => s.id === selected) ?? standards[0];
  const earlier = STANDARDS.filter((o) => o.code === current.code && o.effective_to);
  const lessons = requiredSchedules(current).map((ref) => templateFor(ref)).filter((t): t is TemplateDef => Boolean(t));
  const q = search.trim().toLowerCase();
  const shown = lessons.filter((t) => !q || `${t.ref} ${t.title} ${t.summary} ${t.objective}`.toLowerCase().includes(q));
  const areas = [...new Map(shown.map((t) => [t.area, t.areaName])).entries()].sort(([a], [b]) => a.localeCompare(b));
  const done = lessons.filter((t) => read.includes(t.ref)).length;
  const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;

  const openLesson = (ref: string) => {
    setSearch('');
    setOpen(ref);
    requestAnimationFrame(() => document.getElementById(`lesson-${ref}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#122654] flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5 text-[#FF7A66]" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-[#122654]">Learning library</h1>
            <p className="text-xs text-[#4A5878] mt-0.5 max-w-2xl">
              The UK standards Blynt works to, and a short lesson on every working paper they need: why it matters, what it proves and how to prepare it.
            </p>
          </div>
        </div>
        <div className="min-w-[220px]">
          <p className="text-[11px] text-[#4A5878] mb-1">
            <strong className="text-[#122654]">{done}</strong> of {lessons.length} lessons learned for {current.code}
          </p>
          <div className="h-2 rounded-full bg-[#E3E7EF] overflow-hidden" role="progressbar" aria-label={`Lessons learned for ${current.name}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-[#0B6B52] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* What's new */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[#FFF1EE] border border-[#FF7A66]/40">
        <Sparkles className="w-5 h-5 text-[#FF7A66] shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 text-xs text-[#A23A27] leading-relaxed">
          <strong>What&apos;s new: FRS 102 2024 amendments.</strong> Leases starting on or after 1 January 2026 move to the on-balance-sheet right-of-use model on the leases schedule. Micro-entities under FRS 105 continue under the commitment disclosure rules.
        </div>
        {lessons.some((t) => t.ref === 'L-10') && (
          <button type="button" onClick={() => openLesson('L-10')} className="shrink-0 text-xs font-bold text-[#A23A27] underline cursor-pointer">
            Learn the leases paper
          </button>
        )}
      </div>

      {/* Two ways in: by standard, or every template */}
      <div role="tablist" aria-label="Learning library sections" className="inline-flex self-start p-0.5 rounded-lg border border-[#D3DCEE] bg-[#F5F8FD]">
        {(
          [
            ['standards', 'Standards'],
            ['templates', `Template guide (${TEMPLATES.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => setView(k)}
            className={`min-h-[32px] px-4 text-xs font-semibold rounded-md cursor-pointer ${view === k ? 'bg-[#122654] text-white' : 'text-[#4A5878] hover:text-[#122654]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'templates' && <TemplateGuide />}

      {view === 'standards' && (
        <>
      {/* Choose a standard */}
      <div role="tablist" aria-label="Standards" className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {standards.map((s) => {
          const refs = requiredSchedules(s);
          const learned = refs.filter((r) => read.includes(r)).length;
          const on = s.id === current.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setSelected(s.id);
                setOpen(null);
              }}
              className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${on ? 'bg-white border-[#122654] ring-1 ring-[#122654] shadow-sm' : 'bg-white border-[#E3E7EF] hover:border-[#A6B4D0]'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#122654]">{s.name}</span>
                {on && <CheckCircle2 className="w-4 h-4 text-[#0B6B52] shrink-0" aria-hidden="true" />}
              </span>
              <span className="block text-[10px] text-[#7E8DA6] mt-0.5">{s.version} · periods ending from {s.effective_from}</span>
              <span className="mt-3 flex items-center justify-between text-[10px] text-[#4A5878]">
                <span>{refs.length} lessons</span>
                <span className="font-semibold text-[#0B6B52]">{learned} learned</span>
              </span>
              <span className="mt-1 block h-1 rounded-full bg-[#EEF2F9] overflow-hidden">
                <span className="block h-full bg-[#0B6B52]" style={{ width: `${refs.length ? (learned / refs.length) * 100 : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* The standard in brief */}
      <section aria-label={`${current.name} in brief`} className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-[#E3E7EF] rounded-xl p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-[#122654] mb-2">
            <Target className="w-3.5 h-3.5 text-[#1D4E89]" aria-hidden="true" /> Who it is for
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {current.company_types.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#EAF0FB] text-[#1D4E89] font-semibold">{t}</span>
            ))}
          </div>
          <p className="text-[11px] text-[#4A5878] mt-3">
            {current.version}, for periods ending from {current.effective_from}.
            {earlier.length > 0 && ` Earlier: ${earlier.map((o) => `${o.version} (to ${o.effective_to})`).join(', ')}.`}
          </p>
        </div>
        <div className="bg-white border border-[#E3E7EF] rounded-xl p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-[#122654] mb-2">
            <BookOpen className="w-3.5 h-3.5 text-[#1D4E89]" aria-hidden="true" /> Key rules to know
          </h2>
          <ul className="space-y-2">
            {current.disclosures.map((d) => (
              <li key={d.code} className="text-[11px] text-[#4A5878] leading-snug">
                <span className="font-mono font-bold text-[10px] text-[#1D4E89] bg-[#EAF5FC] px-1.5 py-0.5 rounded mr-1">{d.code}</span>
                <strong className="text-[#122654]">{d.title}.</strong> {d.requirement}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-[#E3E7EF] rounded-xl p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-[#122654] mb-2">
            <HelpCircle className="w-3.5 h-3.5 text-[#1D4E89]" aria-hidden="true" /> Ask on every file
          </h2>
          <ul className="space-y-1.5">
            {current.checklist.map((c) => (
              <li key={c.id} className="flex gap-2 text-[11px] text-[#122654] leading-snug">
                <span className="text-[#FF7A66] font-bold" aria-hidden="true">?</span> {c.question}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Lessons */}
      <section aria-labelledby="lessons-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="lessons-heading" className="text-sm font-bold text-[#122654]">
            Lessons: the {lessons.length} working papers {current.code} needs
          </h2>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7E8DA6] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lessons, e.g. bank, leases" aria-label="Search lessons" className="min-h-[32px] pl-8 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-lg w-64 max-w-full" />
          </div>
        </div>

        {!shown.length && <p className="text-xs text-[#4A5878]">No lesson matches. Try another word.</p>}

        {areas.map(([area, name]) => (
          <div key={area}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#4A5878] mb-1.5">
              <span className="w-5 h-5 rounded bg-[#122654] text-white text-[10px] flex items-center justify-center">{area}</span> {name}
            </p>
            <ul className="space-y-1.5">
              {shown
                .filter((t) => t.area === area)
                .map((t) => {
                  const isOpen = open === t.ref;
                  const learned = read.includes(t.ref);
                  return (
                    <li key={t.ref} id={`lesson-${t.ref}`} className={`bg-white border rounded-xl overflow-hidden ${isOpen ? 'border-[#122654]' : 'border-[#E3E7EF]'}`}>
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.ref)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer hover:bg-[#F9FAFC]">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${learned ? 'bg-[#0B6B52]' : 'border border-[#D3DCEE]'}`} aria-hidden="true">
                          {learned && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className="font-mono text-[10px] font-bold text-[#7E8DA6] w-10 shrink-0">{t.ref}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-[#122654] truncate">{t.title}</span>
                          <span className="block text-[10px] text-[#4A5878] truncate">{t.summary}</span>
                        </span>
                        {learned && <span className="sr-only">Learned</span>}
                        <ChevronDown className={`w-4 h-4 text-[#7E8DA6] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 border-t border-[#EEF2F9]">
                          <div className="space-y-3 pt-3">
                            <div>
                              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#122654] mb-1">
                                <Target className="w-3.5 h-3.5 text-[#FF7A66]" aria-hidden="true" /> Why it matters
                              </p>
                              <p className="text-xs text-[#4A5878] leading-relaxed">{t.objective}</p>
                            </div>
                            {t.assertions.length > 0 && (
                              <div>
                                <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#122654] mb-1">
                                  <ShieldCheck className="w-3.5 h-3.5 text-[#0B6B52]" aria-hidden="true" /> What it proves
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {t.assertions.map((a) => (
                                    <span key={a} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52]">{a}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="pt-3">
                            <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#122654] mb-1.5">
                              <ListChecks className="w-3.5 h-3.5 text-[#1D4E89]" aria-hidden="true" /> Key steps
                            </p>
                            {/* A taste of the method, not the whole paper: the full steps live in the working paper itself */}
                            <ol className="space-y-1.5">
                              {t.procedures.slice(0, KEY_STEPS).map((p, n) => (
                                <li key={n} className="flex gap-2 text-xs text-[#122654] leading-snug">
                                  <span className="w-4 h-4 rounded-full bg-[#EAF0FB] text-[#1D4E89] text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n + 1}</span>
                                  {p}
                                </li>
                              ))}
                            </ol>
                            {t.procedures.length > KEY_STEPS && (
                              <p className="mt-1.5 text-[10px] text-[#7E8DA6]">…and {t.procedures.length - KEY_STEPS} more steps inside the working paper.</p>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleRead(t.ref)}
                              className={`mt-3 inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-lg text-[11px] font-bold cursor-pointer ${learned ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#122654] text-white hover:bg-[#0B1A3B]'}`}
                            >
                              <Check className="w-3.5 h-3.5" aria-hidden="true" /> {learned ? 'Learned' : 'Mark as learned'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </section>
        </>
      )}
    </div>
  );
}

/**
 * Every working paper template, taught briefly: what it is, why it matters and what it proves, and which
 * standards use it. The build of the paper (leads, columns, full procedures) is left to the paper itself.
 */
function TemplateGuide() {
  const [search, setSearch] = useState('');
  const current = STANDARDS.filter((s) => !s.effective_to);
  const usedBy = (ref: string) => current.filter((s) => requiredSchedules(s).includes(ref)).map((s) => s.code);
  const q = search.trim().toLowerCase();
  const shown = TEMPLATES.filter((t) => !q || `${t.ref} ${t.title} ${t.summary} ${t.objective}`.toLowerCase().includes(q));
  const areas = [...new Map(shown.map((t) => [t.area, t.areaName])).entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <section aria-labelledby="guide-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="guide-heading" className="text-sm font-bold text-[#122654]">Template guide</h2>
          <p className="text-[11px] text-[#4A5878]">
            What each working paper template is for. Open the paper in a client file to work through it in full.{' '}
            <Link href="/library/templates" className="font-semibold text-[#1D4E89] hover:underline">Manage templates</Link>
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#7E8DA6] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="min-h-[32px] pl-8 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-lg w-64 max-w-full" />
        </div>
      </div>

      {!shown.length && <p className="text-xs text-[#4A5878]">No template matches. Try another word.</p>}

      {areas.map(([area, name]) => (
        <div key={area}>
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#4A5878] mb-1.5">
            <span className="w-5 h-5 rounded bg-[#122654] text-white text-[10px] flex items-center justify-center">{area}</span> {name}
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {shown
              .filter((t) => t.area === area)
              .map((t) => {
                const standards = usedBy(t.ref);
                return (
                  <li key={t.ref} aria-label={`${t.ref} ${t.title}`} className="bg-white border border-[#E3E7EF] rounded-xl p-3 flex flex-col gap-2">
                    <span className="flex items-start gap-2">
                      <span className="font-mono text-[10px] font-bold text-[#7E8DA6] bg-[#F5F8FD] border border-[#E3E7EF] rounded px-1.5 py-0.5 shrink-0">{t.ref}</span>
                      <span className="text-xs font-bold text-[#122654] leading-snug">{t.title}</span>
                    </span>
                    <p className="text-[11px] text-[#4A5878] leading-snug">{t.objective}</p>
                    <span className="mt-auto flex flex-wrap items-center gap-1">
                      {t.assertions.slice(0, 3).map((a) => (
                        <span key={a} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52]">{a}</span>
                      ))}
                      <span className="ml-auto text-[9px] text-[#7E8DA6]">{standards.length ? standards.join(' · ') : 'Add when needed'}</span>
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
