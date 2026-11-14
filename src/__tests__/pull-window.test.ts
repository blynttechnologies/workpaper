// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canPull, mustKeep } from '../lib/periods';
import { requirePullable } from '../lib/server/xero';

describe('Xero and QuickBooks pull window: current financial year and the two before it', () => {
  // Today is 14 Nov 2026; the year to 31 Mar 2027 is current
  const today = '2026-11-14';

  it('lets the current year and the two before it be pulled, not the fourth', () => {
    expect(canPull('2026-04-01', today)).toBe(true); // year to Mar 2027
    expect(canPull('2025-04-01', today)).toBe(true); // year to Mar 2026
    expect(canPull('2024-04-01', today)).toBe(true); // year to Mar 2025
    expect(canPull('2023-04-01', today)).toBe(false); // year to Mar 2024
    // A December year end: 2026 is current, 2023 is the fourth
    expect(canPull('2024-01-01', today)).toBe(true);
    expect(canPull('2023-01-01', today)).toBe(false);
    // On the day a new year starts, it becomes current and the oldest drops out
    expect(canPull('2023-11-14', today)).toBe(false);
    expect(canPull('2023-11-15', today)).toBe(true);
  });

  it('a year too old to pull is still kept for 6 years after its year end', () => {
    expect(canPull('2023-04-01', today)).toBe(false);
    expect(mustKeep('2024-03-31', today)).toBe(true);
    expect(mustKeep('2020-03-31', today)).toBe(false);
  });

  it('the server refuses a pull outside the window and says why', () => {
    expect(() => requirePullable('2020-04-01', 'Xero')).toThrow(/only read for the current financial year and the 2 before it/);
    expect(() => requirePullable(new Date().toISOString().slice(0, 10), 'QuickBooks')).not.toThrow();
  });
});
