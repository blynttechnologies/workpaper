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

const POINTS = [
  { title: 'Pence-exact', body: 'Whole pence throughout, so totals never drift.' },
  { title: 'AI drafts, you sign', body: 'Blynt Bot suggests. A named reviewer signs off.' },
  { title: 'Nothing changes quietly', body: 'Every edit records who, when and why.' },
];

/** The navy Blynt panel on the left of the sign-in, two-factor and password pages. */
export function AuthBrandPanel() {
  return (
    <div className="lg:col-span-6 xl:col-span-5 bg-[#0B1A3B] text-white p-8 sm:p-12 lg:px-14 lg:py-10 flex flex-col justify-between gap-8">
      <BlyntLogo variant="full" theme="dark" size="lg" />

      <div className="flex items-end gap-8">
        <div className="flex-1 min-w-0 max-w-[420px]">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF7A66] mb-4">
            <span className="w-6 h-px bg-[#FF7A66]" aria-hidden="true" />
            Year-end working papers
          </p>
          <h1 className="text-3xl sm:text-[36px] font-extrabold tracking-tight leading-[1.08] mb-3">
            Every number
            <br />
            in its place.
          </h1>
          <p className="text-sm text-[#A6B4D0] leading-relaxed mb-6">
            Lead schedules, adjustments and sign-offs for UK accounts, tied back to the trial balance.
          </p>

          <ol className="border-t border-[#24396B]">
            {POINTS.map((p, i) => (
              <li key={p.title} className="flex gap-4 py-3 border-b border-[#24396B]">
                <span className="font-mono text-[11px] text-[#FF7A66] pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-xs text-[#A6B4D0] leading-relaxed">
                  <strong className="block text-sm text-white font-bold mb-0.5">{p.title}</strong>
                  {p.body}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Its own column from xl up, so the drawing never sits behind the copy */}
        <figure className="hidden xl:flex flex-col items-center shrink-0 w-[130px] 2xl:w-[160px]">
          <GherkinLineArt className="w-full h-auto text-[#A6B4D0]/55" />
          <figcaption className="pt-2 w-full border-t border-[#24396B] text-center font-mono text-[10px] uppercase tracking-wider text-[#7E8DA6]">
            30 St Mary Axe
          </figcaption>
        </figure>
      </div>

      <div className="flex items-center justify-between text-xs text-[#7E8DA6]">
        <span>Blynt Technologies UK Ltd</span>
        <span>SOC 2 Type II • WCAG 2.2 AA</span>
      </div>
    </div>
  );
}
