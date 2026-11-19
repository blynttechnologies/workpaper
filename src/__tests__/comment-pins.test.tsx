import { describe, it, expect } from 'vitest';
import { anchorAt, placeOf, isPin, initials, onOpenTabs, paperTabs } from '../components/workpaper/comment-pins';

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

  it('left on one tab of the paper, shows only while that tab is open', () => {
    const el = paper();
    const tabs = document.createElement('div');
    tabs.innerHTML = '<button role="tab" aria-selected="true">Sri</button><button role="tab" aria-selected="false">Chand</button>';
    el.prepend(tabs);
    const tr = el.querySelector('tr')!;
    tr.getBoundingClientRect = () => rect(100, 150, 800, 40);
    const a = anchorAt(el, el.querySelector('#amt') as HTMLElement, 700, 160);
    expect(a).toMatchObject({ view: ['Sri'], label: '6100 Savings account Bank · Sri' });
    expect(placeOf(el, a)).not.toBeNull();
    const [sri, chand] = Array.from(tabs.querySelectorAll('button'));
    sri.setAttribute('aria-selected', 'false');
    chand.setAttribute('aria-selected', 'true');
    expect(placeOf(el, a)).toBeNull();
  });

  it('knows a tab by its name, not its count, and shows what was left on a tab that has gone', () => {
    const el = paper();
    const tabs = document.createElement('div');
    tabs.innerHTML = '<button role="tab" data-tab-name="Prepayments" aria-selected="true">Prepayments (40)</button><button role="tab" data-tab-name="Accrued income" aria-selected="false">Accrued income (2)</button>';
    el.prepend(tabs);
    el.querySelector('tr')!.getBoundingClientRect = () => rect(100, 150, 800, 40);
    const a = anchorAt(el, el.querySelector('b') as HTMLElement, 700, 160);
    expect(a.view).toEqual(['Prepayments']);
    // A line is added: the tab is still the same tab. A pin saved with the count in its tab's name is found too
    tabs.firstElementChild!.textContent = 'Prepayments (41)';
    expect(placeOf(el, a)).not.toBeNull();
    expect(onOpenTabs(['Prepayments (40)'], paperTabs(el))).toBe(true);
    expect(onOpenTabs(['Accrued income'], paperTabs(el))).toBe(false);
    // Nothing left on a tab that is no longer on the paper is hidden for good; the whole paper's shows everywhere
    expect(onOpenTabs(['A director who left'], paperTabs(el))).toBe(true);
    expect(onOpenTabs(undefined, paperTabs(el))).toBe(true);
    // A tab named by its label keeps a number in brackets: two loans that differ only by it are two tabs
    tabs.innerHTML = '<button role="tab" aria-selected="true">HSBC loan (2021)</button><button role="tab" aria-selected="false">HSBC loan (2023)</button>';
    expect(onOpenTabs(['HSBC loan (2021)'], paperTabs(el))).toBe(true);
    expect(onOpenTabs(['HSBC loan (2023)'], paperTabs(el))).toBe(false);
  });

  it('off a row, keeps its place on the paper', () => {
    const el = paper();
    const a = anchorAt(el, el.querySelector('.free') as HTMLElement, 500, 400);
    expect(a).toMatchObject({ kind: 'pin', x: 0.5, top: 350 });
    expect(placeOf(el, a)).toEqual({ left: 400, top: 350 });
    expect(initials('Sri Perera')).toBe('SP');
  });
});
