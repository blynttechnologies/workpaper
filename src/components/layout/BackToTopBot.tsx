'use client';

import { useEffect, useState } from 'react';

// Show the button once the page has scrolled this far
const SHOW_AFTER = 400;

/**
 * Back to top, as a small Blynt Bot: it appears once you scroll down and takes you back up when clicked.
 * It bobs and blinks, waves on hover or focus, and keeps still for reduced motion.
 */
export function BackToTopBot() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setShow(window.scrollY > SHOW_AFTER);
      // The page scrollbar turns navy while the page moves and fades back once it stops (globals.css)
      root.classList.add('is-scrolling');
      clearTimeout(idle);
      idle = setTimeout(() => root.classList.remove('is-scrolling'), 700);
    };
    setShow(window.scrollY > SHOW_AFTER);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(idle);
      root.classList.remove('is-scrolling');
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    // Keyboard and screen reader users land at the top of the page too
    document.getElementById('main-content')?.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className={`bot-button group fixed bottom-5 right-5 z-40 flex flex-col items-center cursor-pointer rounded-2xl p-1 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A66] focus-visible:ring-offset-2 ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      {/* Speech bubble */}
      <span className="mb-1 px-2 py-0.5 rounded-full bg-[#122654] text-white text-[11px] font-semibold shadow-sm opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" aria-hidden="true">
        Back to top
      </span>
      <svg viewBox="0 0 64 72" width="52" height="58" aria-hidden="true" className="bot-bob drop-shadow-md">
        {/* Up arrow above the head */}
        <path d="M32 2 L39 10 H35 V15 H29 V10 H25 Z" fill="#FF7A66" />
        {/* Antenna */}
        <line x1="32" y1="17" x2="32" y2="23" stroke="#122654" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="17" r="3" fill="#FF7A66" />
        {/* Head */}
        <rect x="12" y="23" width="40" height="30" rx="12" fill="#122654" />
        <rect x="17" y="29" width="30" height="18" rx="8" fill="#F5F8FD" />
        {/* Eyes and smile */}
        <ellipse className="bot-eye" cx="26" cy="37" rx="2.6" ry="3.2" fill="#122654" />
        <ellipse className="bot-eye" cx="38" cy="37" rx="2.6" ry="3.2" fill="#122654" />
        <path d="M27 42 Q32 46 37 42" stroke="#FF7A66" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* Ears */}
        <rect x="8" y="33" width="4" height="10" rx="2" fill="#FF7A66" />
        <rect x="52" y="33" width="4" height="10" rx="2" fill="#FF7A66" />
        {/* Body and waving arm */}
        <rect x="20" y="55" width="24" height="14" rx="6" fill="#122654" />
        <circle cx="32" cy="62" r="2.5" fill="#FF7A66" />
        <path className="bot-arm" d="M44 60 Q52 58 55 51" stroke="#122654" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M20 60 Q13 62 11 66" stroke="#122654" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}
