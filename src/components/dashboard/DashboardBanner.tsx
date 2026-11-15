'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { bannerMessages, type BannerKind } from '@/lib/workpaper-banner';

const EYEBROW: Record<BannerKind, string> = {
  attention: 'bg-[#FFF1EE] text-[#C2410C]',
  ready: 'bg-[#E6F4EF] text-[#0B6B52]',
  notes: 'bg-[#EAF0FB] text-[#1D4E89]',
  deadline: 'bg-[#FFF4DB] text-[#8A5A00]',
  feature: 'bg-[#122654] text-white',
};

/** London skyline as a single-weight line drawing: Big Ben, the Eye, the Shard, the Gherkin and Tower Bridge over the Thames. */
function LondonLineArt({ className = '' }: { className?: string }) {
  const spokes = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  return (
    <svg viewBox="0 0 640 150" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {/* Thames */}
      <path d="M0 140 H640" />
      <path d="M10 146 q10 -3 20 0 t20 0 t20 0 M120 146 q10 -3 20 0 t20 0 M300 146 q10 -3 20 0 t20 0 t20 0 M500 146 q10 -3 20 0 t20 0" opacity="0.6" />
      {/* Big Ben and Parliament */}
      <path d="M40 140 V52 H62 V140 M40 70 H62 M44 52 V44 H58 V52 M44 44 L51 18 L58 44 M51 18 V12" />
      <circle cx="51" cy="61" r="6" />
      <path d="M51 61 V57 M51 61 H54" />
      <path d="M62 104 H150 V140 M74 104 V96 M90 104 V92 M106 104 V96 M122 104 V92 M138 104 V96 M70 118 H146 M78 118 V140 M94 118 V140 M110 118 V140 M126 118 V140 M142 118 V140" />
      {/* London Eye */}
      <circle cx="215" cy="78" r="48" />
      <circle cx="215" cy="78" r="5" />
      {spokes.map((a) => (
        <g key={a}>
          <path d={`M${215 + 5 * Math.cos(a)} ${78 + 5 * Math.sin(a)} L${215 + 48 * Math.cos(a)} ${78 + 48 * Math.sin(a)}`} opacity="0.55" />
          <circle cx={215 + 52 * Math.cos(a)} cy={78 + 52 * Math.sin(a)} r="3" />
        </g>
      ))}
      <path d="M215 78 L192 140 M215 78 L238 140 M186 140 H244" />
      {/* The Shard */}
      <path d="M300 140 L322 22 L344 140 M322 22 L326 140 M310 90 L336 90 M306 112 L340 112 M318 46 L327 46" />
      {/* The Gherkin */}
      <path d="M366 140 C354 104 360 64 378 52 C396 64 402 104 390 140 Z" />
      <path d="M362 112 L392 86 M360 96 L388 72 M364 128 L396 100 M372 140 L398 118 M366 82 L384 62" opacity="0.55" />
      {/* Tower Bridge */}
      <path d="M440 140 V64 H462 V140 M520 140 V64 H542 V140" />
      <path d="M440 64 L445 50 L451 40 L457 50 L462 64 M520 64 L525 50 L531 40 L537 50 L542 64 M451 40 V34 M531 40 V34" />
      <path d="M446 84 h10 v14 h-10 Z M526 84 h10 v14 h-10 Z" opacity="0.7" />
      <path d="M462 72 H520 M462 78 H520 M462 112 H520" />
      <path d="M470 72 V78 M482 72 V78 M494 72 V78 M506 72 V78" opacity="0.6" />
      <path d="M400 112 Q420 74 440 70 M542 70 Q562 74 582 112 M400 112 H440 M542 112 H600" />
      <path d="M412 112 V96 M424 112 V84 M558 112 V84 M570 112 V96" opacity="0.6" />
      {/* Terraces */}
      <path d="M600 140 V110 L612 100 L624 110 V140 M612 140 V124" />
    </svg>
  );
}

/**
 * Banner under the dashboard's client list: live working-paper news first, then what Blynt can do, with a
 * London skyline line drawing. It moves on every 7 seconds, pauses on hover or focus, and stays still for reduced motion.
 */
export function DashboardBanner() {
  const [slides] = useState(() => bannerMessages());
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % slides.length), 7000);
    return () => clearInterval(t);
  }, [paused, slides.length]);

  const m = slides[i];
  const step = (d: number) => setI((n) => (n + d + slides.length) % slides.length);

  return (
    <section
      aria-label="Working paper highlights"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative flex-1 min-h-[230px] overflow-hidden rounded-xl border border-[#E3E7EF] bg-gradient-to-br from-white via-[#F7F9FD] to-[#EAF0FB] px-5 pt-5 pb-28 shadow-2xs"
    >
      <LondonLineArt className="absolute inset-x-0 bottom-0 w-full h-auto max-h-[130px] text-[#1D4E89]/30 pointer-events-none" />

      <div className="relative max-w-xl" aria-live="polite">
        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${EYEBROW[m.kind]}`}>{m.eyebrow}</span>
        <h2 className="mt-2 text-lg sm:text-xl font-extrabold tracking-tight leading-snug text-[#122654]">{m.title}</h2>
        <p className="mt-1 text-xs text-[#4A5878]">{m.body}</p>
        <Link href={m.href} className="mt-3 inline-flex items-center gap-1.5 min-h-[32px] px-3.5 rounded-lg bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold transition-colors">
          {m.action} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {slides.length > 1 && (
        <div className="absolute right-4 top-4 flex items-center gap-1.5">
          <button type="button" onClick={() => step(-1)} aria-label="Previous update" className="p-1 rounded-full text-[#4A5878] hover:text-[#122654] hover:bg-white cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="flex items-center gap-1">
            {slides.map((s, n) => (
              <button
                key={n}
                type="button"
                onClick={() => setI(n)}
                aria-label={`Slide ${n + 1} of ${slides.length}: ${s.eyebrow}`}
                aria-current={n === i ? 'true' : undefined}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${n === i ? 'w-5 bg-[#122654]' : 'w-1.5 bg-[#122654]/25 hover:bg-[#122654]/50'}`}
              />
            ))}
          </span>
          <button type="button" onClick={() => step(1)} aria-label="Next update" className="p-1 rounded-full text-[#4A5878] hover:text-[#122654] hover:bg-white cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </section>
  );
}
