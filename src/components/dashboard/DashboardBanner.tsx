'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { bannerMessages, type BannerKind } from '@/lib/workpaper-banner';

const ICON = { attention: AlertTriangle, ready: CheckCircle2, notes: MessageSquare, deadline: CalendarClock, feature: Sparkles };
const EYEBROW: Record<BannerKind, string> = {
  attention: 'bg-[#FF7A66] text-[#0B1A3B]',
  ready: 'bg-[#6EE7B7] text-[#063B2C]',
  notes: 'bg-[#BFD7FF] text-[#0B1A3B]',
  deadline: 'bg-[#FCD34D] text-[#3D2A00]',
  feature: 'bg-white/15 text-white',
};

/**
 * The dashboard's top banner: live working-paper news first, then what Blynt can do, one slide at a time.
 * It moves on every 7 seconds, pauses on hover or focus, and stays still for reduced motion.
 */
export function DashboardBanner({ summary }: { summary: string }) {
  const [slides] = useState(() => bannerMessages());
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % slides.length), 7000);
    return () => clearInterval(t);
  }, [paused, slides.length]);

  const m = slides[i];
  const Icon = ICON[m.kind];
  const step = (d: number) => setI((n) => (n + d + slides.length) % slides.length);
  const hour = new Date().getHours();

  return (
    <section
      aria-label="Working paper highlights"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0B1A3B] via-[#122654] to-[#1D4E89] text-white px-5 sm:px-7 py-5 shadow-sm"
    >
      {/* Soft shapes behind the text */}
      <span aria-hidden="true" className="absolute -right-16 -top-20 w-72 h-72 rounded-full bg-white/5" />
      <span aria-hidden="true" className="absolute right-24 -bottom-24 w-56 h-56 rounded-full bg-[#FF7A66]/10" />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/70">
          <span className="font-bold text-white">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</span> · {summary}
        </p>
        <Link href="/engagements/new" className="min-h-[36px] px-3.5 flex items-center gap-1.5 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-lg shadow-sm transition-colors">
          <Plus className="w-4 h-4 stroke-[2.5]" /> New engagement
        </Link>
      </div>

      <div className="relative mt-4 flex items-center gap-6 min-h-[112px]">
        <div className="flex-1 min-w-0" aria-live="polite">
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${EYEBROW[m.kind]}`}>{m.eyebrow}</span>
          <h2 className="mt-2 text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">{m.title}</h2>
          <p className="mt-1 text-sm text-white/75 max-w-2xl">{m.body}</p>
          <Link href={m.href} className="mt-3 inline-flex items-center gap-1.5 min-h-[34px] px-3.5 rounded-lg bg-white text-[#122654] text-xs font-bold hover:bg-[#EAF0FB] transition-colors">
            {m.action} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
        <span aria-hidden="true" className="hidden md:flex w-24 h-24 rounded-3xl bg-white/10 border border-white/15 items-center justify-center shrink-0 rotate-3">
          <Icon className="w-11 h-11 text-white/90" />
        </span>
      </div>

      {slides.length > 1 && (
        <div className="relative mt-4 flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="Previous update" className="p-1 rounded-full text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="flex items-center gap-1.5">
            {slides.map((s, n) => (
              <button
                key={n}
                type="button"
                onClick={() => setI(n)}
                aria-label={`Slide ${n + 1} of ${slides.length}: ${s.eyebrow}`}
                aria-current={n === i ? 'true' : undefined}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${n === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'}`}
              />
            ))}
          </span>
          <button type="button" onClick={() => step(1)} aria-label="Next update" className="p-1 rounded-full text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-auto text-[10px] text-white/50 font-mono">{i + 1}/{slides.length}</span>
        </div>
      )}
    </section>
  );
}
