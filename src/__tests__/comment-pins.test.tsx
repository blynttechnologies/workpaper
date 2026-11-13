import { describe, it, expect } from 'vitest';
import { anchorAt, placeOf, isPin, initials } from '../components/workpaper/comment-pins';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function paper() {
  const el = document.createElement('div');
  el.innerHTML = '<table><tbody><tr><td></td><td>6100 Savings account <span>Bank</span></td><td><b id="amt">55,000.00</b></td></tr></tbody></table>';
  const free = document.createElement('p');
  free.className = 'free';
  free.textContent = 'Checks';
  el.appendChild(free);
  document.body.appendChild(el);
  el.getBoundingClientRect = () => rect(100, 50, 800, 600);
  return el;
}

describe('comment pins', () => {
  it('pins to the row clicked and finds it again after the paper moves', () => {
    const el = paper();
    const tr = el.querySelector('tr')!;
    tr.getBoundingClientRect = () => rect(100, 150, 800, 40);
    const a = anchorAt(el, el.querySelector('#amt') as HTMLElement, 700, 160);
    expect(a).toMatchObject({ kind: 'pin', row: '6100 Savings account Bank', x: 0.75, y: 0.25, label: '6100 Savings account Bank' });
    expect(isPin(a)).toBe(true);
    // The row is now lower on the paper: the pin goes with it
    tr.getBoundingClientRect = () => rect(100, 250, 800, 40);
    expect(placeOf(el, a)).toEqual({ left: 600, top: 210 });
    tr.remove();
    expect(placeOf(el, a)).toBeNull();
  });

  it('off a row, keeps its place on the paper', () => {
    const el = paper();
    const a = anchorAt(el, el.querySelector('.free') as HTMLElement, 500, 400);
    expect(a).toMatchObject({ kind: 'pin', x: 0.5, top: 350 });
    expect(placeOf(el, a)).toEqual({ left: 400, top: 350 });
    expect(initials('Sri Perera')).toBe('SP');
  });
});
