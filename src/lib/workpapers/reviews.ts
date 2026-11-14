import type { PaperContext } from './common';
import { reviewCreditors } from './creditors';
import { reviewOtherDebtors } from './other-debtors';
import { reviewPrepayments } from './prepayments';
import { reviewStock } from './stock';
import { reviewEquity } from './equity';
import { reviewRevenue } from './revenue';
import { reviewPl } from './pl-analysis';
import { reviewStatutory } from './statutory';
import { reviewFixedAssets } from './fixed-assets';
import { reviewDla } from './dla';
import { reviewReserves } from './reserves';
import { reviewInvestments } from './investments';
import { reviewBs } from './bs-analysis';
import { reviewLoans } from './loans';

/** Papers with their own checks and totals, by reference. Each returns the conclusion draft. */
export const PAPER_REVIEWS: Record<string, (ctx: PaperContext) => string> = {
  'K-10': reviewCreditors,
  'C-30': reviewOtherDebtors,
  'C-20': reviewPrepayments,
  'D-10': reviewStock,
  'E-10': reviewEquity,
  'I-10': reviewRevenue,
  'Z-30': reviewPl,
  'R-20': reviewStatutory,
  'F-10': reviewFixedAssets,
  'D-20': reviewDla,
  'E-20': reviewReserves,
  'G-10': reviewInvestments,
  'Z-40': reviewBs,
  'L-20': reviewLoans,
  'L-30': reviewLoans,
};
