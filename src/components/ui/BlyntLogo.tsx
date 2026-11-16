import React from 'react';

interface BlyntLogoProps {
  variant?: 'full' | 'mark' | 'text';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  theme?: 'dark' | 'light';
  className?: string;
}

/**
 * The official Blynt logo (brand kit v1): always inside its white rectangle, with clear space X
 * on every side (X = 32% of the mark height) and corner radius X / 5.
 */
function Rectangle({ height, children, className = '' }: { height: number; children: React.ReactNode; className?: string }) {
  const x = height * 0.32;
  return (
    <span className={`inline-flex shrink-0 bg-white ${className}`} style={{ padding: x, borderRadius: x / 5 }}>
      {children}
    </span>
  );
}

/** The symbol alone, for small spaces. */
export const BlyntMark: React.FC<{ size?: number; className?: string; theme?: 'dark' | 'light' }> = ({ size = 28, className = '' }) => (
  <Rectangle height={size} className={className}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/blynt-symbol.svg" alt="Blynt" width={Math.round(size * (740 / 924))} height={size} />
  </Rectangle>
);

export const BlyntLogo: React.FC<BlyntLogoProps> = ({ variant = 'full', size = 'md', theme = 'dark', className = '' }) => {
  // xl is the brand kit's 40 px size, for the sign-in panels
  const h = { sm: 20, md: 24, lg: 32, xl: 40 }[size];
  if (variant === 'mark') return <BlyntMark size={h} className={className} />;

  return (
    <div className={`flex items-center select-none ${size === 'xl' ? 'gap-4' : 'gap-2.5'} ${className}`}>
      <Rectangle height={h}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/blynt-horizontal.svg" alt="Blynt" width={Math.round(h * (2609 / 924))} height={h} />
      </Rectangle>
      {variant === 'full' && (
        <span
          className={`font-bold tracking-wider rounded-full uppercase ${size === 'xl' ? 'text-xs px-3.5 py-1.5' : 'text-[10px] px-2.5 py-0.5'} ${
            theme === 'dark' ? 'bg-white/10 text-white' : 'bg-[#EEF2F9] text-[#122654]'
          }`}
        >
          Workpapers
        </span>
      )}
    </div>
  );
};

export default BlyntLogo;
