// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseSettings, toCsv, requireAiAdmin } from '@/lib/server/ai/admin';

describe('AI Control Centre settings', () => {
  it('only partners and admins may use it', () => {
    expect(() => requireAiAdmin({ role: 'manager' })).toThrow(/partner or admin/);
    expect(() => requireAiAdmin({ role: 'admin' })).not.toThrow();
  });

  it('keeps known settings and refuses anything else', () => {
    expect(
      parseSettings({
        providers: { openai: { enabled: true, model: 'gpt-x.1' } },
        routes: { review_workpaper: { provider: 'openai', mode: 'review', fallback: false } },
        monthly_limit_usd: 250,
        mcp: { enabled: true, disabled_tools: ['generate_report'] },
      })
    ).toEqual({
      providers: { openai: { enabled: true, model: 'gpt-x.1' } },
      routes: { review_workpaper: { provider: 'openai', mode: 'review', fallback: false } },
      monthly_limit_usd: 250,
      mcp: { enabled: true, disabled_tools: ['generate_report'] },
    });
    expect(() => parseSettings({ providers: { gemini: {} } })).toThrow(/Unknown provider/);
    expect(() => parseSettings({ routes: { drop_tables: {} } })).toThrow(/Unknown task/);
    expect(() => parseSettings({ routes: { research: { mode: 'all' } } })).toThrow(/Mode/);
    expect(() => parseSettings({ monthly_limit_usd: -1 })).toThrow(/monthly limit/);
    expect(() => parseSettings({ mcp: { disabled_tools: ['rm_rf'] } })).toThrow(/Unknown tool/);
    expect(() => parseSettings({ providers: { anthropic: { model: 'claude"; drop' } } })).toThrow(/model name/);
    // An API key is not a setting: it is ignored, never stored
    expect(parseSettings({ providers: { openai: { api_key: 'sk-secret' } } })).toEqual({ providers: { openai: {} } });
  });

  it('exports the log as CSV that a spreadsheet will not run as formulas', () => {
    const csv = toCsv([{ id: '1', firm_id: 'f', user_id: '=HYPERLINK("x")', channel: 'app', kind: 'model', module: 'm', task: 't', provider: 'anthropic', model: 'claude-opus-5-5', status: 'ok', input_tokens: 1, output_tokens: 2, cost_usd: 0.1, latency_ms: 5, created_at: '2026-11-14' }]);
    expect(csv.split('\n')[0]).toMatch(/^created_at,id,user_id/);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
