'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, MessageSquare } from 'lucide-react';
import { bannerMessages, BannerKind } from '@/lib/workpaper-banner';

const ICON = { attention: AlertTriangle, ready: CheckCircle2, notes: MessageSquare, deadline: CalendarClock, tip: Lightbulb };
const TONE: Record<BannerKind, string> = {
  attention: 'bg-[#FFF1EE] text-[#C2410C]',
  ready: 'bg-[#E6F4EF] text-[#0B6B52]',
  notes: 'bg-[#EAF0FB] text-[#1D4E89]',
  deadline: 'bg-[#FFF4DB] text-[#8A5A00]',
  tip: 'bg-[#F5F8FD] text-[#4A5878]',
};

/** A slim strip in the header that steps through working-paper messages; it pauses on hover and stays still for reduced motion. */
export function WorkpaperBanner() {
  const [messages] = useState(() => bannerMessages());
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || messages.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 6000);
    return () => clearInterval(t);
  }, [paused, messages.length]);

  const m = messages[i];
  const Icon = ICON[m.kind];
  const step = (d: number) => setI((n) => (n + d + messages.length) % messages.length);

  return (
    <div
      role="region"
      aria-label="Working paper updates"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="hidden md:flex items-center gap-2 min-w-0 max-w-xl flex-1 h-9 pl-1.5 pr-1 rounded-full border border-[#E3E7EF] bg-white"
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${TONE[m.kind]}`} aria-hidden="true">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <p className="flex-1 min-w-0 truncate text-xs text-[#122654]" title={m.text}>
        {m.kind === 'tip' && <span className="font-semibold text-[#4A5878]">Tip: </span>}
        {m.text}
      </p>
      <Link href={m.href} className="shrink-0 text-[11px] font-bold text-[#B8432F] hover:underline">
        {m.action} →
      </Link>
      {messages.length > 1 && (
        <span className="flex items-center shrink-0">
          <button type="button" onClick={() => step(-1)} aria-label="Previous update" className="p-1 rounded-full text-[#7E8DA6] hover:text-[#122654] hover:bg-[#F5F8FD] cursor-pointer">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-[#7E8DA6] font-mono w-7 text-center" aria-live="polite">{i + 1}/{messages.length}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next update" className="p-1 rounded-full text-[#7E8DA6] hover:text-[#122654] hover:bg-[#F5F8FD] cursor-pointer">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}
