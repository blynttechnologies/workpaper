// One look for every message Blynt shows on a page: a boxed banner, or (inline) a line of text by a field.
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const TONES = {
  ok: { box: 'bg-[#E6F4EF] border-[#0B6B52]/20', text: 'text-[#0B6B52]', Icon: CheckCircle2 },
  error: { box: 'bg-[#FDECEA] border-[#B42318]/20', text: 'text-[#B42318]', Icon: AlertCircle },
  warn: { box: 'bg-[#FFF4DB] border-[#6B4700]/20', text: 'text-[#6B4700]', Icon: AlertTriangle },
  info: { box: 'bg-[#F5F8FD] border-[#D3DCEE]', text: 'text-[#122654]', Icon: Info },
} as const;

export interface NoticeProps {
  /** error (the default) and warn are announced at once; ok and info politely */
  tone?: keyof typeof TONES;
  /** Text only, no box: for a message beside or under a control */
  inline?: boolean;
  /** Shows a close button */
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function Notice({ tone = 'error', inline, onClose, className = '', children }: NoticeProps) {
  const { box, text, Icon } = TONES[tone];
  const role = tone === 'error' || tone === 'warn' ? 'alert' : 'status';
  if (inline) {
    return (
      <span role={role} className={`flex items-start gap-1.5 text-xs font-medium ${text} ${className}`}>
        <Icon className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span>{children}</span>
      </span>
    );
  }
  return (
    <div role={role} className={`flex items-start gap-2 p-3 rounded-[10px] border text-xs font-medium ${box} ${text} ${className}`}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 break-words">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close message" className="shrink-0 cursor-pointer">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
