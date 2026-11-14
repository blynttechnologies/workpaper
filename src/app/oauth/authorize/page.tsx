'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { BlyntLogo } from '@/components/ui/BlyntLogo';
import { Button } from '@/components/ui/Button';

interface Info {
  client_name: string;
  redirect_host: string;
  scope: string[];
  user: string;
  role: string;
  practice?: string;
  practice_enabled: boolean;
}

const SCOPE_TEXT: Record<string, string> = {
  'workpaper.read': 'Read the clients, engagements, working papers and trial balances you can see in Workpaper',
  'workpaper.draft': 'Put draft figures on bank reconciliation papers, which stay unconfirmed until someone confirms them in Workpaper',
};

/**
 * Consent for an outside assistant (ChatGPT, Microsoft Copilot) to act as the signed-in user.
 * Reached after the normal Workpaper sign-in (password and MFA). The decision posts to /api/oauth/authorize.
 */
export default function AuthorizePage() {
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = window.location.search;
    setQuery(q);
    fetch(`/api/oauth/authorize${q}`)
      .then(async (r) => {
        const j = await r.json();
        if (r.ok) setInfo(j);
        else setError(j.error || 'This connection request is not valid.');
      })
      .catch(() => setError('Could not check this connection request.'));
  }, []);

  const hidden = Array.from(new URLSearchParams(query).entries()).filter(([k]) =>
    ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state'].includes(k)
  );

  return (
    <main className="min-h-screen bg-[#F5F8FD] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-[#D3DCEE] rounded-[14px] p-6 shadow-sm">
        <BlyntLogo />
        {error ? (
          <div className="mt-6 flex gap-2 text-sm text-[#B42318]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : !info ? (
          <p className="mt-6 text-sm text-[#4A5878]">Checking the request…</p>
        ) : (
          <>
            <h1 className="mt-6 text-lg font-semibold text-[#122654]">Connect {info.client_name} to Workpaper?</h1>
            <p className="mt-2 text-sm text-[#4A5878]">
              {info.client_name} will act as <strong>{info.user}</strong> ({info.role}) in {info.practice}. It sees only what you can see, and it cannot approve,
              sign off or post anything.
            </p>
            <ul className="mt-4 space-y-2">
              {info.scope.map((s) => (
                <li key={s} className="flex gap-2 text-sm text-[#122654]">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-[#1E7F4F]" />
                  {SCOPE_TEXT[s] ?? s}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[#4A5878]">After you allow it, you return to {info.redirect_host}. You can disconnect at any time by removing the connection in the assistant.</p>
            {!info.practice_enabled && (
              <p className="mt-4 text-sm text-[#B42318]">Your practice has not turned on outside assistants. An admin can turn them on in Settings, AI Control Centre.</p>
            )}
            <form method="post" action="/api/oauth/authorize" className="mt-6 flex gap-3">
              {hidden.map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Button type="submit" name="decision" value="allow" disabled={!info.practice_enabled}>
                Allow
              </Button>
              <Button type="submit" name="decision" value="deny" variant="outline">
                Cancel
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
