import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEngagementTimer, IDLE_MS } from '../components/layout/useEngagementTimer';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('engagement timer', () => {
  it('pauses after five minutes without activity and resumes on the next one', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ restart: false }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useEngagementTimer('eng_1'));

    // Two minutes of work, then nothing
    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(result.current).toEqual({ seconds: 120, paused: false });

    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS + 60_000);
    });
    expect(result.current.paused).toBe(true);
    const counted = result.current.seconds;
    expect(counted).toBeLessThanOrEqual(IDLE_MS / 1000 + 1);

    // Paused: no heartbeats and no counting
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(result.current.seconds).toBe(counted);

    // Back at the desk: counting and recording again at once
    await act(async () => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.paused).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });
});
