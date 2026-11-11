import type React from 'react';
import type { ScheduleProps } from '../schedules';
import { CreditorsSchedule } from './creditors';
import { OtherDebtorsSchedule } from './other-debtors';
import { PrepaymentsSchedule } from './prepayments';
import { StockSchedule } from './stock';
import { EquitySchedule } from './equity';
import { RevenueSchedule } from './revenue';
import { PlAnalysisSchedule } from './pl-analysis';
import { StatutoryInfoSchedule } from './statutory';
import { FixedAssetsSchedule } from './fixed-assets';
import { DlaSchedule } from './dla';
import { ReservesSchedule } from './reserves';
import { InvestmentsSchedule } from './investments';

/** Redesigned papers with a screen of their own, by reference. */
export const PAPER_SCREENS: Record<string, (props: ScheduleProps) => React.ReactNode> = {
  'K-10': CreditorsSchedule,
  'C-30': OtherDebtorsSchedule,
  'C-20': PrepaymentsSchedule,
  'D-10': StockSchedule,
  'E-10': EquitySchedule,
  'I-10': RevenueSchedule,
  'Z-30': PlAnalysisSchedule,
  'R-20': StatutoryInfoSchedule,
  'F-10': FixedAssetsSchedule,
  'D-20': DlaSchedule,
  'E-20': ReservesSchedule,
  'G-10': InvestmentsSchedule,
};
