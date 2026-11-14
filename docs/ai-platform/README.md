# Blynt Workpaper AI platform

How the multi-AI platform is built, what is finished, and how to switch it on. Read this with [gap-assessment.md](gap-assessment.md), the Phase A audit it answers.

Status at 14 November 2026: built and tested on branch `feat/ai-platform`, **not pushed and not deployed** (every push deploys to production).

---

## 1. Status by phase

"Tested" means automated tests plus an end-to-end HTTP run against a local server. "Live check" means it needs real API keys or an outside account, which have not been available yet.

| Phase | What was built | Status |
|---|---|---|
| B: AI gateway | `src/lib/server/ai/`. Includes: one `run(task, input, ctx)` for every model call; a provider interface; task registry; routing per task and per practice; retries with backoff; provider fallback; structured-output validation; a read-only tool-calling loop; timeouts; per-practice monthly spending limit; request, usage and cost logging (`ai_requests` table) | Tested |
| C: Claude | Anthropic adapter (SDK, streaming, server-side refusal fallback). The bank statement read moved onto the gateway with the same prompt, schema and year-end picking | Tested with a stand-in provider. **Live check: needs `ANTHROPIC_API_KEY` locally** |
| D: OpenAI API | Responses API adapter over HTTPS (`store: false`), with structured output, PDF and image input, function calling, and errors mapped for retry and fallback. Independent of ChatGPT | Tested with a stand-in. **Live check: needs `OPENAI_API_KEY` and `OPENAI_MODEL`** |
| D2: Google Gemini API | Third provider: `generateContent` over HTTPS (key in a header, not the URL), with structured output (JSON Schema), PDF and image input, function calling (thought signatures handed back), and thinking tokens billed as output. Default model `gemini-4-hydrogen` (`GEMINI_MODEL` overrides) | **Live checked 14 Nov 2026**: connection, structured output, PDF statement read (injection line ignored), research tool loop, mapping, all passing |
| E: Microsoft Copilot | Served by the shared MCP server and Workpaper OAuth (section 4). Copilot is recognised from its registration name | Tested over HTTP. **Live check: needs your Microsoft 365 tenant with Copilot Studio** |
| F: ChatGPT | MCP server at `/api/mcp` with the 8 required tools, OAuth 2.1 (dynamic registration, PKCE, rotating refresh tokens), a consent page, role, client and practice checks, and draft-only writes | Tested over HTTP. **Live check: needs a ChatGPT account with developer mode** |
| G: shared AI services | `src/lib/server/ai/services.ts` and `ai/documents.ts`. **Document intelligence:** classify, then read fields per document type; the hard-coded sample extraction is removed. **Accounting:** mapping help after the rules. **Risk:** unusual balances, and a review of each paper that raises findings. **Reporting:** conclusion drafts, plus status, exceptions and management summaries. **Workflow:** engagement facts and outstanding work. **Research:** answers from the standards library through a read-only tool | Tested with stand-ins |
| H: multi-AI | Three modes per task, set in the Control Centre: single; review (two providers read independently, and a disagreement makes the result Check); collaborate (one drafts, the other checks). Second model only where an admin chooses it | Tested |
| I: data | 2 new tables, `ai_requests` and `oauth_records`, created on first use. Existing tables reused: `ai_action_logs`, `ai_review_findings` (new `source` and `model` fields), `ai_lineage` (now written when an AI value is confirmed), `audit_logs`, and `firm.settings.ai` | Tested |
| J: AI Control Centre | `/settings/ai` (partner and admin). Shows provider status and a test button; usage, tokens, cost and latency by provider, module and channel; failed and blocked requests; routing and mode per task; monthly limit; outside-assistant switch and per-tool switches; CSV audit export | Tested over HTTP |
| K: security | See section 3 | Tested |
| L: testing | 4 new test files, 44 tests. Full suite 371 passing; typecheck clean; production build succeeds | Done, except the live checks above and reference-case accuracy runs (need keys and anonymised sample documents) |
| M: deployment | Runbook in section 5. Nothing deployed | Waiting for your go-ahead |

---

## 2. Where things are

```
src/lib/server/ai/
  gateway.ts        run(), routing, retries, fallback, modes, logging, testProvider()
  types.ts          shared shapes; modules never see provider types
  providers/        anthropic.ts (SDK), openai.ts (Responses API over fetch), gemini.ts (generateContent over fetch)
  tasks/            statement.ts, documents.ts, accounting.ts: prompt, version, schema, defaults per task
  services.ts       mapping, review, conclusion, summaries, risk, research
  documents.ts      extractWithAi: classify and read a stored document
  usage.ts          ai_requests log and summaries     pricing.ts   USD per million tokens
  admin.ts          Control Centre data, settings checks, CSV    catalog.ts  task list
  validate.ts       JSON-schema check for model output and tool input
src/lib/server/mcp/ oauth.ts, server.ts (JSON-RPC), tools.ts (the 8 tools)
src/app/api/mcp, src/app/api/oauth/*, src/app/.well-known/*, src/app/oauth/authorize (consent page)
src/app/api/v1/ai/{admin,research,suggest-mapping}, workpapers/[id]/{ai-review,ai-draft}, engagements/[id]/{ai-summary,ai-risk}
src/app/(dashboard)/settings/ai (Control Centre), components/workpaper/AiPaperActions.tsx
```

**Adding a task:** add a `TaskDef` in `tasks/`, add it to `catalog.ts`, call `run()` from a service. Bump `version` whenever the prompt or schema changes; the version is logged with every request and every accepted value.

**Adding a provider:** implement `Provider` in `providers/`, add it to `PROVIDER_IDS` and the `providers` map, and add its prices to `pricing.ts` (or the `AI_PRICES` environment variable).

---

## 3. Safety rules the code enforces

- **AI proposes, people decide.** Read values go in as unconfirmed confidence-gate items. Review findings block preparation until they are fixed or dismissed. Draft conclusions sit beside the conclusion and are never written into it. The accounting engine (`lib/workpapers/*`, journals, sign-off) still does every calculation.
- **No invented figures.** A value that was not read stays blank and is marked Check. The hard-coded sample extraction, the made-up fill-in defaults (lease, fixed assets, loans, payroll month 12, VAT zeros) and the fixed prior-year import figures are all removed.
- **Untrusted documents.** The system prompts say client content is data, never instructions. Tasks that read documents get no tools. Every model output and tool input is checked against its schema before use.
- **Tenant isolation.** Each MCP call looks up the user afresh (role, practice, assigned clients). A token is bound to its practice. Deactivated users lose access at once. Tests cover other practices, unassigned clients and locked engagements.
- **Least privilege.** Read-only roles and read-only tokens never see the write tool. Admins can switch off any tool. The whole MCP surface is off unless `MCP_ENABLED=1` on the server and the practice turns it on.
- **The one external write** (`create_reconciliation_draft`) fills only an empty balance, on an unlocked and unsigned bank paper. It adds an unconfirmed gate item, which blocks sign-off, and writes an audit entry.
- **Secrets.** API keys live only in Secrets Manager and environment variables, never in the workspace or the browser. The Control Centre shows whether each key is set; it cannot read or set keys. Settings updates accept known fields only.
- **Data minimisation and retention.** No prompt or document content is logged. OpenAI calls use `store: false`. Each task sends only what it needs; working papers over 400,000 characters are refused rather than cut off.
- **Logging.** Every provider call and every tool call writes one `ai_requests` row (provider, model, user, practice, channel, task, status, tokens, cost, latency). Changes caused by AI also go to the append-only audit log, and confirmed values go to `ai_lineage`.
- **Abuse limits.** There is a per-practice monthly spending limit. The MCP endpoint allows 120 calls per minute per token on each server instance (a shortcut, marked in code).

---

## 4. Connecting ChatGPT and Microsoft Copilot

Both use the same server address: `https://<your Workpaper address>/api/mcp`. The Control Centre shows it once outside assistants are on.

**Before either:** set `MCP_ENABLED=1` on the server (section 5). Then a partner or admin ticks *Allow outside assistants for this practice* in the AI Control Centre.

**ChatGPT** (developer mode, or an app in your ChatGPT workspace):
1. In ChatGPT settings, add a connector or app pointing at the MCP server address, with OAuth authentication.
2. ChatGPT registers itself and opens the Workpaper sign-in. The person signs in (password and MFA), then approves on the consent page.
3. Ask, for example, "Which Harlow papers are not signed off?" ChatGPT calls `search_workpapers` and `get_workpaper_status`.

**Microsoft Copilot Studio:**
1. In your agent, add a tool of type *Model Context Protocol* with the server address.
2. Choose OAuth 2.0 with dynamic discovery. If your tenant asks for manual settings, use the authorisation and token addresses from `/.well-known/oauth-authorization-server`, client authentication *none*, and scopes `workpaper.read workpaper.draft`.
3. Give the client a name containing "Copilot", so the Control Centre reports it as Copilot.
4. Each user connects once and signs in to Workpaper. Their Microsoft identity maps to their Workpaper user because they sign in as that user. Entra single sign-on into Workpaper can be added later as a login method.

The exact menu names in ChatGPT and Copilot Studio change often. Check them against current OpenAI and Microsoft documentation when you set these up.

---

## 5. Deployment runbook (needs your approval at each step)

Pushing any branch deploys. Do these in order.

1. **Secrets.** Add to Secrets Manager `workpaper/app`, then to the CodeBuild buildspec's `secrets-manager:` block **and** its `jq` Variables list:
   - `OPENAI_API_KEY` and `OPENAI_MODEL`, when OpenAI is wanted
   - `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, default `gemini-4-hydrogen`), when Gemini is wanted
   - `AI_PRICES`, for OpenAI model prices, e.g. `{"<model>":[input,output]}` in USD per million tokens
   - `MCP_ENABLED`: leave it out, or set `0`, for the first release
   - `ANTHROPIC_API_KEY` is already there
2. **Lambda timeout:** raise from 30 to 300 seconds (statement reads and two-model reviews can take longer than 30 seconds).
3. **First release:** merge with `MCP_ENABLED` unset. The gateway, Claude migration and Control Centre go live; outside assistants stay unreachable.
4. **Check:**
   - Control Centre, then *Test connection* for Claude.
   - Read one bank statement on a test client and compare it with the previous behaviour.
   - Read one lease on the Documents page.
5. **Turn on OpenAI:** add its key and model, test the connection, then optionally route one task to it or set *review* mode on statement reads.
6. **Turn on outside assistants:** set `MCP_ENABLED=1`, redeploy, switch it on for the practice, and connect one test user from ChatGPT and from Copilot.
7. **Monitoring:**
   - CloudWatch errors: search for `blynt_error` (`where: "ai-usage"` or `"mcp"`).
   - Control Centre failures table.
   - A CloudWatch alarm on Lambda errors and duration over 240 seconds is recommended.

**Rollback:** each feature has an off switch that needs no code change. Remove a provider key, or untick the provider, to stop its calls. Set `MCP_ENABLED=0`, or untick it for the practice, to cut off outside assistants at once. Revoke a single connection from inside the assistant. For a full rollback, redeploy the previous image tag on the Lambda. The 2 new tables are additive and can stay.

**Secrets rotation:** rotate keys in the provider console, update `workpaper/app`, and redeploy. Every 90 days is suggested, and at once if a key may have leaked. Then run *Test connection* afterwards.

---

## 6. Known limits

- OpenAI is called over HTTPS following the Responses API as documented. It has not been run against the live service yet (the account had no credit).
- Gemini 4 Argon and Carbon are priced at the rate from 1 December 2026; until then the real charge is half what the Control Centre shows. Gemini models other than the three Gemini 4 ones need a row in `AI_PRICES` to show a cost.
- The MCP rate limit is per server instance.
- AI request logs without a database (local development) are kept in memory only.
- Writes from outside assistants share the whole-workspace save lock, and retry once on a conflict.
- Research uses Workpaper's own standards library only. No web search, by decision.
- Accuracy against human-checked reference documents (Phase L quality tests) needs anonymised sample documents and keys.
