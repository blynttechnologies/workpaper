'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { KeyRound, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AuthBrandPanel } from '@/components/layout/AuthBrandPanel';

const inputClass =
  'w-full min-h-[44px] px-3.5 text-xs bg-[#F5F8FD] border border-[#D3DCEE] rounded-[10px] text-[#122654] outline-none focus:border-[#FF7A66] focus:ring-2 focus:ring-[#FF7A66]/20';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setSent(true);
      else setError('Could not send the link. Try again.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F5F8FD] text-[#122654]">
      <AuthBrandPanel />

      <div className="lg:col-span-6 xl:col-span-7 bg-white p-8 sm:p-12 lg:p-16 flex flex-col justify-center items-center">
        <div className="max-w-[420px] w-full">
          {sent ? (
            <>
              <div className="w-12 h-12 rounded-full bg-[#E6F4EF] text-[#0B6B52] flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Check your email</h2>
              <p className="text-xs text-[#4A5878] mt-1.5">
                If an account exists for that address, we&apos;ve sent a link to set a new password. It works once and
                expires in one hour.
              </p>
            </>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-[#122654]">Forgot your password?</h2>
                <p className="text-xs text-[#4A5878] mt-1.5">
                  Enter your work email and we&apos;ll send you a secure link to set a new one.
                </p>
              </div>

              {error && (
                <div role="alert" className="p-3 mb-4 rounded-[10px] bg-[#FDECEA] border border-[#B42318]/30 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={submit} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold mb-1.5">Work email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[44px] bg-[#122654] hover:bg-[#0B1A3B] text-white font-bold text-xs rounded-[10px] shadow-sm mt-2 cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <div className="p-4 mt-6 bg-[#F5F8FD] border border-[#E3E7EF] rounded-[12px] text-xs flex items-start gap-3">
                <KeyRound className="w-4 h-4 text-[#1D4E89] shrink-0 mt-0.5" />
                <p className="text-[#4A5878]">
                  No email arriving? Your practice admin or partner can also create a link from{' '}
                  <strong className="text-[#122654]">Settings → Users &amp; Roles</strong>. If you are the only admin and
                  can&apos;t sign in, contact Blynt support.
                </p>
              </div>
            </>
          )}

          <div className="mt-8 pt-6 border-t border-[#E3E7EF] text-center text-xs text-[#4A5878]">
            <Link href="/login" className="inline-flex items-center gap-1.5 hover:text-[#122654]">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
