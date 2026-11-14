'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, AlertCircle, Download, Plug, Sparkles } from 'lucide-react';

/**
 * AI Control Centre (partner and admin): providers, usage and cost, routing per task, spending limit,
 * outside assistants (ChatGPT, Microsoft Copilot) and the audit export. API keys are not entered here:
 * they live in the server's secrets, so the page shows whether each one is set and lets you test it.
 */

type Bucket = { requests: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number; unpriced: number; avg_latency_ms: number };
type Route = { provider?: string; mode?: string; fallback?: boolean } | null;
interface Data {
  days: number;
  providers: { id: string; label: string; configured: boolean; enabled: boolean; model: string | null }[];
  settings: { providers?: Record<string, { enabled?: boolean; model?: string }>; routes?: Record<string, Route>; monthly_limit_usd?: number | null; mcp?: { enabled?: boolean; disabled_tools?: string[] } };
  tasks: { id: string; label: string; module: string; provider: string; mode: string; route: Route }[];
  month_spend_usd: number;
  usage: { total: Bucket; by_provider: Record<string, Bucket>; by_module: Record<string, Bucket>; by_channel: Record<string, Bucket>; by_task: Record<string, Bucket>; failures: any[] };
  recent: any[];
  mcp: { server_enabled: boolean; practice_enabled: boolean; url: string; tools: { name: string; title: string; write: boolean; enabled: boolean }[] };
}

const card = 'bg-white border border-[#E3E7EF] rounded-[16px] p-5 shadow-xs';
const h2 = 'text-sm font-bold text-[#122654]';
const muted = 'text-xs text-[#4A5878]';
const select = 'min-h-[36px] px-2 text-xs bg-[#F5F8FD] border border-[#D3DCEE] rounded-[8px] text-[#122654]';
const usd = (n: number) => `$${n.toFixed(2)}`;
const MODE_TEXT: Record<string, string> = { single: 'One model', review: 'Two read independently', collaborate: 'One drafts, one checks' };

function UsageTable({ title, rows }: { title: string; rows: Record<string, Bucket> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1].requests - a[1].requests);
  return (
    <div>
      <h3 className="text-xs font-bold text-[#122654] mb-2">{title}</h3>
      {entries.length === 0 ? (
        <p className={muted}>No requests yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[#4A5878]">
              <th className="py-1 font-semibold"></th>
              <th className="py-1 font-semibold text-right">Requests</th>
              <th className="py-1 font-semibold text-right">Failed</th>
              <th className="py-1 font-semibold text-right">Tokens</th>
              <th className="py-1 font-semibold text-right">Cost</th>
              <th className="py-1 font-semibold text-right">Avg time</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, b]) => (
              <tr key={k} className="border-t border-[#EEF1F6] text-[#122654]">
                <td className="py-1.5">{k}</td>
                <td className="py-1.5 text-right tabular-nums">{b.requests}</td>
                <td className="py-1.5 text-right tabular-nums">{b.failed}</td>
                <td className="py-1.5 text-right tabular-nums">{(b.input_tokens + b.output_tokens).toLocaleString('en-GB')}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {usd(b.cost_usd)}
                  {b.unpriced ? <span title="Requests on a model with no price set (AI_PRICES)"> *</span> : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">{(b.avg_latency_ms / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AiControlCentre() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | 'running'>>({});
  const [limit, setLimit] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/ai/admin');
    const j = await r.json();
    if (!r.ok) return setError(j.error || 'Could not load the AI Control Centre.');
    setData(j);
    setLimit(j.settings.monthly_limit_usd == null ? '' : String(j.settings.monthly_limit_usd));
  }, []);

  useEffect(() => {
    load().catch(() => setError('Could not load the AI Control Centre.'));
  }, [load]);

  const save = async (update: Record<string, unknown>, done = 'Saved') => {
    const r = await fetch('/api/v1/ai/admin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
    const j = await r.json();
    if (!r.ok) return setToast(j.error || 'Not saved');
    setData(j);
    setToast(done);
    setTimeout(() => setToast(''), 3000);
  };

  const test = async (provider: string) => {
    setTests((t) => ({ ...t, [provider]: 'running' }));
    const r = await fetch('/api/v1/ai/admin/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
    const j = await r.json();
    setTests((t) => ({ ...t, [provider]: j.ok ? { ok: true, text: `Connected: ${j.model}, ${(j.latency_ms / 1000).toFixed(1)}s` } : { ok: false, text: j.error || 'Failed' } }));
    load();
  };

  if (error) return <div className={`${card} max-w-3xl mx-auto mt-6 text-sm text-[#B42318]`}>{error}</div>;
  if (!data) return <div className={`${muted} p-6`}>Loading…</div>;

  const s = data.settings;
  const setProvider = (id: string, p: { enabled?: boolean; model?: string }) => save({ providers: { ...(s.providers ?? {}), [id]: { ...(s.providers?.[id] ?? {}), ...p } } });
  const setRoute = (task: string, r: Route) => save({ routes: { ...(s.routes ?? {}), [task]: { ...(s.routes?.[task] ?? {}), ...r } } });
  const offTools = new Set(s.mcp?.disabled_tools ?? []);

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto pb-16">
      <div className={`${card} flex flex-col md:flex-row md:items-center justify-between gap-3`}>
        <div>
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-[#4A5878] hover:text-[#122654]">
            <ArrowLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold text-[#122654] tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#FF7A66]" /> AI Control Centre
          </h1>
          <p className={`${muted} mt-1`}>Every AI request in Workpaper goes through one gateway. AI only proposes: figures still need a person to confirm them.</p>
        </div>
        <a href="/api/v1/ai/admin/export" className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[#122654] border border-[#D3DCEE] rounded-xl hover:bg-[#F5F8FD]">
          <Download className="w-4 h-4" /> Export request log (CSV)
        </a>
      </div>

      {toast && <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs px-4 py-3 rounded-xl">{toast}</div>}

      {/* Providers */}
      <section className={card}>
        <h2 className={h2}>Providers</h2>
        <p className={`${muted} mt-1`}>API keys are stored in the server&apos;s secrets, never in Workpaper. A provider is used when its key is set and it is switched on here.</p>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          {data.providers.map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="border border-[#EEF1F6] rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#122654]">{p.label}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${p.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-[#FFF4ED] text-[#B54708]'}`}>
                    {p.configured ? 'Key set' : 'No key on server'}
                  </span>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-[#122654]">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => setProvider(p.id, { enabled: e.target.checked })} /> Use this provider
                </label>
                <label className="mt-3 block text-xs text-[#4A5878]">
                  Model
                  <input
                    className={`${select} w-full mt-1`}
                    defaultValue={s.providers?.[p.id]?.model ?? ''}
                    placeholder={p.model ?? (p.id === 'openai' ? 'Set OPENAI_MODEL on the server' : '')}
                    onBlur={(e) => e.target.value !== (s.providers?.[p.id]?.model ?? '') && setProvider(p.id, { model: e.target.value.trim() || undefined })}
                  />
                </label>
                <button type="button" onClick={() => test(p.id)} disabled={!p.configured || t === 'running'} className="mt-3 text-xs font-bold text-[#1D4E89] hover:underline disabled:opacity-50 cursor-pointer">
                  {t === 'running' ? 'Testing…' : 'Test connection'}
                </button>
                {t && t !== 'running' && (
                  <p className={`mt-1 text-xs flex gap-1 ${t.ok ? 'text-emerald-700' : 'text-[#B42318]'}`}>
                    {t.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {t.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Usage */}
      <section className={card}>
        <div className="flex items-baseline justify-between">
          <h2 className={h2}>Usage, last {data.days} days</h2>
          <span className={muted}>This month: {usd(data.month_spend_usd)}{s.monthly_limit_usd != null ? ` of ${usd(s.monthly_limit_usd)} limit` : ''}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ['Requests', data.usage.total.requests.toLocaleString('en-GB')],
            ['Failed', data.usage.total.failed.toLocaleString('en-GB')],
            ['Tokens', (data.usage.total.input_tokens + data.usage.total.output_tokens).toLocaleString('en-GB')],
            ['Cost', usd(data.usage.total.cost_usd)],
            ['Avg response', `${(data.usage.total.avg_latency_ms / 1000).toFixed(1)}s`],
          ].map(([k, v]) => (
            <div key={k} className="bg-[#F5F8FD] rounded-xl p-3">
              <div className={muted}>{k}</div>
              <div className="text-lg font-bold text-[#122654] tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid md:grid-cols-3 gap-6">
          <UsageTable title="By provider" rows={data.usage.by_provider} />
          <UsageTable title="By module" rows={data.usage.by_module} />
          <UsageTable title="By channel" rows={data.usage.by_channel} />
        </div>
        {data.usage.total.unpriced > 0 && <p className={`${muted} mt-3`}>* Some requests used a model with no price set. Add it to AI_PRICES on the server to cost them.</p>}
        <label className="mt-5 flex items-center gap-2 text-xs text-[#122654]">
          Monthly spending limit (USD, empty for none)
          <input className={`${select} w-28`} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          <button type="button" className="font-bold text-[#1D4E89] hover:underline cursor-pointer" onClick={() => save({ monthly_limit_usd: limit.trim() === '' ? null : Number(limit) }, 'Limit saved')}>
            Save
          </button>
        </label>
      </section>

      {/* Routing */}
      <section className={card}>
        <h2 className={h2}>Routing by task</h2>
        <p className={`${muted} mt-1`}>
          Which provider goes first, and whether a second model is used. Two models cost about twice as much and take longer, so use them for high-risk work. A
          disagreement between two models always goes to a person.
        </p>
        <table className="mt-4 w-full text-xs">
          <thead>
            <tr className="text-left text-[#4A5878]">
              <th className="py-1 font-semibold">Task</th>
              <th className="py-1 font-semibold">Module</th>
              <th className="py-1 font-semibold">First provider</th>
              <th className="py-1 font-semibold">Mode</th>
              <th className="py-1 font-semibold">Fall back if it fails</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((t) => (
              <tr key={t.id} className="border-t border-[#EEF1F6] text-[#122654]">
                <td className="py-2">{t.label}</td>
                <td className="py-2">{t.module}</td>
                <td className="py-2">
                  <select className={select} value={t.route?.provider ?? t.provider} onChange={(e) => setRoute(t.id, { provider: e.target.value })}>
                    {data.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  <select className={select} value={t.route?.mode ?? t.mode} onChange={(e) => setRoute(t.id, { mode: e.target.value })}>
                    {Object.entries(MODE_TEXT).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  <input type="checkbox" checked={t.route?.fallback !== false} onChange={(e) => setRoute(t.id, { fallback: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`${muted} mt-3`}>
          Confidence thresholds (Ready, Check, Exception) are set per output type under <Link href="/settings?tab=rules" className="underline">AI Rules &amp; Accuracy</Link>.
        </p>
      </section>

      {/* Outside assistants */}
      <section className={card}>
        <h2 className={`${h2} flex items-center gap-2`}>
          <Plug className="w-4 h-4 text-[#1D4E89]" /> ChatGPT and Microsoft Copilot
        </h2>
        <p className={`${muted} mt-1`}>
          Lets your team use Workpaper from ChatGPT or Microsoft Copilot. Each person signs in to Workpaper to connect, and the assistant sees only what they can see. It cannot
          approve, sign off or post anything.
        </p>
        {!data.mcp.server_enabled ? (
          <p className="mt-3 text-xs text-[#B54708]">Not available on this server yet (MCP_ENABLED is not set).</p>
        ) : (
          <>
            <label className="mt-4 flex items-center gap-2 text-xs text-[#122654] font-semibold">
              <input type="checkbox" checked={data.mcp.practice_enabled} onChange={(e) => save({ mcp: { enabled: e.target.checked, disabled_tools: [...offTools] } })} /> Allow outside assistants for this practice
            </label>
            <p className={`${muted} mt-2`}>
              Connector URL: <code className="bg-[#F5F8FD] px-1.5 py-0.5 rounded">{data.mcp.url}</code>
            </p>
            <div className="mt-4 grid md:grid-cols-2 gap-2">
              {data.mcp.tools.map((t) => (
                <label key={t.name} className="flex items-center gap-2 text-xs text-[#122654]">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => {
                      const next = new Set(offTools);
                      if (e.target.checked) next.delete(t.name);
                      else next.add(t.name);
                      save({ mcp: { enabled: data.mcp.practice_enabled, disabled_tools: [...next] } });
                    }}
                  />
                  {t.title} {t.write && <span className="text-[10px] font-bold text-[#B54708]">DRAFT WRITE</span>}
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Failures */}
      <section className={card}>
        <h2 className={h2}>Failed and blocked requests</h2>
        {data.usage.failures.length === 0 ? (
          <p className={`${muted} mt-2`}>None in this period.</p>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-[#4A5878]">
                <th className="py-1 font-semibold">When</th>
                <th className="py-1 font-semibold">Channel</th>
                <th className="py-1 font-semibold">Task or tool</th>
                <th className="py-1 font-semibold">Provider</th>
                <th className="py-1 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.usage.failures.map((f) => (
                <tr key={f.id} className="border-t border-[#EEF1F6] text-[#122654]">
                  <td className="py-1.5">{new Date(f.created_at).toLocaleString('en-GB')}</td>
                  <td className="py-1.5">{f.channel}</td>
                  <td className="py-1.5">{f.task}</td>
                  <td className="py-1.5">{f.provider}</td>
                  <td className="py-1.5">
                    {f.status}
                    {f.error_code ? `: ${f.error_code}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
