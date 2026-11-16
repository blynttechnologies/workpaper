import { CheckCircle2 } from 'lucide-react';
import { BlyntLogo } from '@/components/ui/BlyntLogo';

const GHERKIN = 'M84 402 C62 330 50 262 54 200 C58 118 84 34 120 28 C156 34 182 118 186 200 C190 262 178 330 156 402 Z';

/** Workpapers' signature building: the Gherkin, 30 St Mary Axe in the City, in the dashboard's London line-art style. */
function GherkinLineArt({ className = '' }: { className?: string }) {
  const diagonals = Array.from({ length: 24 }, (_, i) => i * 22 - 240);
  const floors = Array.from({ length: 26 }, (_, i) => 52 + i * 14);
  return (
    <svg viewBox="0 0 240 402" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <defs>
        <clipPath id="auth-gherkin">
          <path d={GHERKIN} />
        </clipPath>
      </defs>
      <g clipPath="url(#auth-gherkin)">
        {/* Diamond glazing lattice */}
        {diagonals.map((x) => (
          <path key={x} d={`M${x} 402 L${x + 240} 0 M${x + 240} 402 L${x} 0`} opacity="0.35" />
        ))}
        {/* Floor lines, bowed to show the round plan */}
        {floors.map((y) => (
          <path key={y} d={`M0 ${y} Q120 ${y + 7} 240 ${y}`} opacity="0.2" />
        ))}
        {/* The dark spiral bands, picked out in coral */}
        {[-150, -30, 90, 210].map((x) => (
          <path key={x} d={`M${x} 402 Q${x + 150} 250 ${x + 230} 0`} stroke="#FF7A66" strokeWidth="5" opacity="0.35" />
        ))}
      </g>
      <path d={GHERKIN} strokeWidth="1.6" />
      {/* Glass lens cap and entrance */}
      <path d="M102 38 Q120 30 138 38" />
      <path d="M104 402 V390 H136 V402" />
    </svg>
  );
}

/** The navy Blynt panel on the left of the sign-in and two-factor pages. */
export function AuthBrandPanel() {
  return (
    <div className="lg:col-span-6 xl:col-span-5 bg-[#0B1A3B] text-white p-8 sm:p-12 lg:p-16 flex flex-col justify-between">
      <div className="relative z-10">
        <div className="mb-16">
          <BlyntLogo variant="full" theme="dark" size="lg" />
        </div>

        <div className="max-w-[420px]">
          <span className="text-xs font-bold uppercase tracking-wider text-[#FF7A66] bg-[#122654] px-3 py-1 rounded-full border border-[#FF7A66]/30 inline-block mb-4">
            UK Cloud Accounting &amp; Workpapers
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight mb-4">
            Financial workpapers built with zero fluff
          </h1>
          <p className="text-sm text-[#A6B4D0] leading-relaxed mb-8">
            One unified Blynt account for client bookkeeping, VAT, annual statutory accounts, and transparent working papers.
          </p>

          <div className="flex flex-col gap-3.5 text-xs text-[#A6B4D0]">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Strict integer pence precision</strong>: Zero floating-point rounding anomalies.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">AI suggests, people decide</strong>: Full lineage and explicit named sign-offs.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Append-only activity log</strong>: every change records who, when and why.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative pt-8 border-t border-[#24396B] text-xs text-[#7E8DA6] flex items-center justify-between">
        {/* Stands on the footer rule like the skyline stands on the Thames */}
        <GherkinLineArt className="hidden lg:block absolute bottom-full right-4 h-[min(380px,45vh)] w-auto text-[#A6B4D0]/45 pointer-events-none" />
        <span>Blynt Technologies UK Ltd</span>
        <span>SOC 2 Type II • WCAG 2.2 AA</span>
      </div>
    </div>
  );
}
