import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { BackToTopBot } from '../components/layout/BackToTopBot';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const scrollTo = (y: number) =>
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  });

describe('back to top bot', () => {
  it('stays hidden near the top and appears once you scroll down', () => {
    const { container } = render(<BackToTopBot />);
    scrollTo(0);
    // Hidden from assistive tech while not needed, so find it directly
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-hidden')).toBe('true');
    expect(button.tabIndex).toBe(-1);
    scrollTo(900);
    expect(button.getAttribute('aria-hidden')).toBe('false');
    expect(button.tabIndex).toBe(0);
  });

  it('takes you back to the top', () => {
    const spy = vi.fn();
    window.scrollTo = spy as unknown as typeof window.scrollTo;
    render(<BackToTopBot />);
    scrollTo(900);
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});
