'use client';

// Blynt's own confirm, prompt and notice boxes, in place of the browser's (which show the site address
// and ignore the theme). Call ask.confirm / ask.text / ask.tell from anywhere; <AskHost /> draws them.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';

type Request = {
  kind: 'confirm' | 'text' | 'tell';
  title: string;
  text?: string;
  /** The word on the main button: say what it does ("Delete", "Remove") */
  action?: string;
  /** Red main button, and Cancel is focused first */
  danger?: boolean;
  label?: string;
  initial?: string;
  minLength?: number;
  done: (value: any) => void;
};
type Options = Omit<Request, 'kind' | 'done'>;

let show: ((r: Request) => void) | null = null;

// No host on the page (a test, a page outside the dashboard): the browser's own box still works
const request = <T,>(kind: Request['kind'], o: Options, fallback: () => T) =>
  show ? new Promise<T>((done) => show!({ ...o, kind, done })) : Promise.resolve(fallback());

const plain = (o: Options) => [o.title, o.text].filter(Boolean).join('\n\n');

export const ask = {
  /** Yes or no. Resolves true only when the main button is pressed. */
  confirm: (o: Options) => request<boolean>('confirm', o, () => window.confirm(plain(o))),
  /** A short written answer. Resolves the trimmed text, or null if cancelled. */
  text: (o: Options) => request<string | null>('text', o, () => window.prompt(plain(o), o.initial)?.trim() || null),
  /** Something the person needs to know, with one button to close it. */
  tell: (o: Options) => request<void>('tell', o, () => window.alert(plain(o))),
};

const button = 'min-h-[40px] px-4 rounded-lg text-sm font-bold cursor-pointer focus-visible:outline-3 focus-visible:outline-[#FF7A66]';

export function AskHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [error, setError] = useState('');
  const main = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const r = queue[0];

  useEffect(() => {
    show = (next) => setQueue((q) => [...q, next]);
    return () => { show = null; };
  }, []);

  const finish = useCallback((value: unknown) => {
    r?.done(value);
    setError('');
    setQueue((q) => q.slice(1));
  }, [r]);
  const close = useCallback(() => finish(r?.kind === 'confirm' ? false : r?.kind === 'text' ? null : undefined), [finish, r]);

  if (!r) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (r.kind !== 'text') return finish(r.kind === 'confirm' ? true : undefined);
    const value = input.current?.value.trim() ?? '';
    const min = r.minLength ?? 1;
    if (value.length < min) return setError(min > 1 ? `Write at least ${min} characters.` : 'Write something first.');
    finish(value);
  };

  return (
    <Dialog isOpen onClose={close} title={r.title} maxWidth="sm" initialFocus={r.kind === 'text' ? input : r.danger ? cancel : main}>
      <form onSubmit={submit} className="space-y-4">
        {r.text && <p className="text-sm text-[#4A5878] break-words">{r.text}</p>}
        {r.kind === 'text' && (
          <div>
            <input
              ref={input}
              defaultValue={r.initial}
              aria-label={r.label ?? r.title}
              aria-invalid={Boolean(error)}
              placeholder={r.label}
              className="w-full min-h-[40px] px-3 rounded-lg border border-[#D3DCEE] text-sm text-[#122654] focus-visible:outline-3 focus-visible:outline-[#FF7A66]"
            />
            {error && <p role="alert" className="mt-1 text-xs text-[#B8432F]">{error}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {r.kind !== 'tell' && (
            <button ref={cancel} type="button" onClick={close} className={`${button} border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]`}>Cancel</button>
          )}
          <button ref={main} type="submit" className={`${button} text-white ${r.danger ? 'bg-[#B8432F] hover:bg-[#9C3626]' : 'bg-[#122654] hover:bg-[#0B1A3B]'}`}>
            {r.action ?? (r.kind === 'text' ? 'Save' : 'OK')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
