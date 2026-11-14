# Blynt Workpaper: Multi-AI Platform: Phase A audit and gap assessment

Prepared 14 November 2026 from branch `feat/self-service-password-reset` (commit 569209a).
Status: approved and built on branch `feat/ai-platform` (see [README.md](README.md) for what was built and what is left).

---

## 1. Summary

1. **Only one feature calls a real AI model.** That is the bank statement balance read (`statement-reader.ts`), which calls Claude Opus 5.5 directly. Most other features labelled "AI" are keyword rules, or **hard-coded demo values**.
2. **Document extraction returns made-up figures for real uploads.** The Documents page calls `/documents/{id}/extract`. For a lease, loan, payroll, VAT return, stock count, prior-year accounts or invoice, this returns fixed sample data (for example, every lease is "Grosvenor Estates PLC, £10,200 a year") at 92–98% confidence. A person must confirm each value before sign-off, but the figures are not read from the document. This is the most urgent finding.
3. **The parts that make AI safe already exist and should be reused, not rebuilt:**
   - a confidence gate with per-practice thresholds (`gate.ts`)
   - a rules library that learns from corrections
   - an append-only AI decision log, with accuracy reporting
   - an append-only audit log
   - "AI values must be confirmed before sign-off"
   - journals proposed by AI stay as drafts until a person approves them, and nobody can approve their own adjustment
4. **Tenant isolation is enforced in application code** (by `firm_id`, plus each user's assigned clients). The whole workspace, covering every practice, is stored as **one JSON row** in Postgres and loaded on every request. High-volume AI request logs must therefore go in their own tables, not in the workspace.
5. **The live Lambda times out after 30 seconds.** A long statement read, and any two-model review, can run past that. The timeout needs to be raised before multi-AI work goes live.
6. **Pushing any branch deploys to production.** Unfinished integrations therefore need feature flags that are off by default, or the deploy trigger needs changing.
7. **ChatGPT and Microsoft Copilot can share one MCP server.** Both now connect to remote MCP servers over OAuth. Building one secured MCP endpoint, with Workpaper as the OAuth sign-in, covers Phases E and F without duplicate infrastructure.
8. Of the 10 proposed `ai_*` tables, **2 new tables are needed** (plus OAuth tables for MCP). The rest already exist under other names or belong in code and configuration (see section 6).

Baseline: 47 test files, 327 tests, all passing (run from `D:\Project\WP`; run from a lowercase `d:` path, Vitest loads itself twice and every file fails).

---

## 2. Current architecture

| Area | What is there |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript. UI pages under `src/app/(dashboard)`, API under `src/app/api/v1` (about 80 routes) |
| Hosting | One AWS Lambda (`workpaper`, eu-north-1, 1 GB, **30 s timeout**) behind a public Function URL (buffered, no streaming), running a Docker image through the Lambda Web Adapter |
| Deploy | GitHub webhook to CodeBuild to ECR to Lambda, on **every push to any branch**. Environment variables are rewritten from Secrets Manager `workpaper/app` on each deploy, using a fixed list in the inline buildspec |
| Data | Postgres (RDS). `workspace_state` holds one JSONB row for the whole workspace, with optimistic version locking. `attachment_files` holds file bytes. Locally, a JSON file is used instead |
| Request model | Each request runs `syncIn()` (load the whole workspace into the in-memory `db`), changes it, then `syncOut()` (write it back if the version is unchanged). Two writes at once means one gets "changed by someone else, retry" |
| Browser sync | `/api/v1/state` sends the browser its own practice's slice (`publicSlice`). Browser saves go through `mergeFirmState` and `checkRules` (`state-guard.ts`), which refuse forbidden changes |
| Auth | Signed HttpOnly session cookie (`AUTH_SECRET`), scrypt-style password hashes, login lockout, TOTP MFA with backup codes, invites, password reset. `proxy.ts` blocks unsigned requests to everything except auth routes |
| Roles | `readonly`, `preparer`, `reviewer`, `manager`, `partner`, `admin`. Read-only users are refused on every non-GET request |
| Tenancy | `firm_id` on all records, plus `membership.client_ids` (assigned clients). Checked by `requireEngagementAccess`, `requireWorkpaperAccess`, `canAccessFile` and similar helpers |
| Audit | `db.logAudit()` writes frozen entries to `audit_logs`, append-only. The state guard refuses edits or deletes from the browser |
| Accounting engine | `src/lib/workpapers/*` (per-paper calculations and checks), `journals.ts`, `signoff.ts` (sign-off levels, blocks on unconfirmed AI values and open findings), `roll-forward.ts`, `schedules-service.ts`. All amounts are in pence as bigint strings |
| Integrations | Xero and QuickBooks (OAuth, tokens encrypted with AES-GCM), Companies House (no key yet), Amazon SES email, Open Banking (**simulated**) |
| Errors | `logError()` writes one JSON line to stderr (CloudWatch). No alerting |
| Tests | Vitest + jsdom, 47 files, 327 tests |

---

## 3. AI inventory

| Feature | Where | Real model? | Notes |
|---|---|---|---|
| Bank statement balance read | `lib/server/statement-reader.ts`, called by `POST /files/{key}/read-statement` from the workpaper page | **Yes: Claude Opus 5.5** (Anthropic SDK 1.8, beta streaming, JSON-schema output, `effort: low`, server-side fallback beta) | Year-end balance picked in code (`pickBalances`), not by the model. Returns null with no key. **No usage, cost or request logging. No firm or user recorded. No timeout setting** |
| Document type tagging on upload | `extraction.ts` `suggestDocumentType` | No | Filename keywords, after learned rules |
| Document extraction (lease, loan, payroll, VAT, stock, prior-year accounts, invoice) | `extraction.ts` `extract`, called by the Documents page | **No: hard-coded sample values** | Fake figures at high confidence. Bank statement extraction here also hard-codes sort code, account number, opening balance and uncleared items |
| Fill schedule from document | `extraction.ts` `fillScheduleFromDocument` | No (uses the above) | Correctly fills blanks only, adds confidence-gate items and an audit entry |
| Account mapping suggestions | `lib/mapping/auto-mapper.ts` through `gate.ts` `runGated` | No | Keyword and chart rules. The mapping page records `model_version: 'gpt-4o-accountant-v1.1'`, which is **mislabelled** |
| `/api/v1/ai/suggest-mapping` | route | No | Same auto-mapper. **No auth check inside the route** (the proxy requires a session, but there is no firm scoping; it reads only the shared chart, so low risk) |
| Capital vs revenue detector | `invoice-platform.ts` | No | Keywords |
| Journal proposals (depreciation, accruals, bad debt, tax, VAT flat rate) | `schedules-service.ts`, `journals.ts` | No | Deterministic accounting rules. **Correct as is: this is the rules engine, not AI** |
| AI review findings | `ai_review_findings` | No | Seed data only; nothing generates them. They do block sign-off |
| AI draft conclusions (`ai_draft`) | workpaper `data_json` | No | Seed data only |
| AI accuracy | `/api/v1/ai/accuracy`, `gate.ts` `accuracy()` | n/a | Works from the decision log |
| AI lineage | `AiLineage` type, `ai_lineage` collection | n/a | **Never written** |
| "AI Copilot" badge | `components/ui/AiCard.tsx` | n/a | Will be confused with Microsoft Copilot; rename it |

---

## 4. Security assessment (AI-relevant)

**Strong already:**
- Every API route resolves the actor from the signed cookie and checks firm and client access. Errors never leak internals.
- The browser never sees other practices, password hashes, OAuth tokens or invite tokens.
- Append-only audit and AI decision logs are enforced on the server.
- AI output never changes records on its own. Gate items need confirmation, journals stay as drafts, and there is no self-approval.
- Secrets live in Secrets Manager and reach the Lambda as environment variables. They are never sent to the browser.

**Gaps to close in this project:**
1. The Function URL is public with `AuthType NONE`. That is fine for the app, but the MCP endpoint will need its own bearer-token auth and rate limiting.
2. There is no per-practice AI spend or request limit. Once AI is used more widely, one practice could run up the bill.
3. There is no record of which provider or model processed which practice's data. This is needed for data-processing obligations.
4. Uploaded documents are sent to the model whole. There is no prompt-injection boundary yet (the one current prompt has no tools, so the risk today is low).
5. Secrets have no rotation schedule. The Xero token key falls back to a value derived from `AUTH_SECRET`.
6. Writes that can conflict (whole-workspace version lock) will conflict more often once external agents call tools. Reads are unaffected.
7. **Every request loads every practice's data** into memory. That is not a leak, because access is filtered, but a bug in any new tool could expose another practice. Each MCP tool needs a test that proves it cannot read another firm's data.

---

## 5. Target architecture

```
 Workpaper UI ─┐                         ┌─ Anthropic adapter (Claude)
 API routes ───┤                         │
               ├─► AI Gateway ─► router ─┼─ OpenAI adapter (Responses API)
 MCP server ───┘   (ai/gateway.ts)       │
   ▲    ▲           │  task registry     └─ (future providers)
   │    │           │  schema check, retries, fallback
   │    │           │  usage + cost ─► ai_requests table
   │    │           └─ single / review / collaborate modes
   │    │
 ChatGPT   Microsoft Copilot Studio
 (Apps SDK) (MCP connector)
   └── both sign in through Workpaper OAuth (login + MFA) ──► same actor, firm and role checks
```

**Principles**
- Modules call **named tasks** (`readBankStatement`, `extractDocument`, `classifyDocument`, `suggestMapping`, `reviewWorkpaper`, `summarise`, ...), never a provider. Each task holds its prompt, prompt version, output schema and default route.
- **The gateway proposes and the existing engine decides.** Every AI result still goes through `runGated` (confidence gate, rules first) and the confirm flow. Accounting calculations stay in `lib/workpapers/*`.
- **External agents (ChatGPT, Copilot) can read, and can create drafts only.** Approval of anything financial happens inside Workpaper by a named user, through the existing journal approval and sign-off rules. This is the simplest way to meet "financial changes need approval", and it reuses code that is already tested.
- **One MCP server for both external agents.** Tools call the same service functions and access checks as the API routes, with the actor taken from the OAuth token.
- **Workpaper is its own OAuth server** for MCP (authorise page reuses login and MFA, with tokens bound to user and practice). A Microsoft or Entra ID user then maps naturally, because they sign in as their Workpaper user. Entra single sign-on can be added as a login method later, matched by verified email.
- **Data minimisation:** each task sends only the fields it needs. Documents are marked as untrusted content. Tasks that read documents get no write tools.
- **Feature flags** (off by default in production): `AI_GATEWAY_OPENAI`, `AI_MULTI_MODE`, `MCP_ENABLED`, needed because every push deploys.

**Proposed files** (one folder, no framework):
```
src/lib/server/ai/
  gateway.ts        run(task, input, ctx): route, call, validate, fallback, log
  types.ts          request and response shapes, errors
  tasks/*.ts        one file per task: prompt, version, schema, default route
  providers/anthropic.ts, providers/openai.ts
  pricing.ts        per-model token prices (from provider price lists, set at build time)
  usage.ts          ai_requests insert and queries for the dashboard
src/lib/server/mcp/ server.ts, tools.ts, oauth.ts
src/app/api/mcp/route.ts, src/app/api/oauth/*, src/app/.well-known/*
src/app/(dashboard)/settings/ai/page.tsx   AI Control Centre
```

New dependencies: `openai` (Phase D) and `@modelcontextprotocol/sdk` (Phases E and F). Output schemas use the provider's own structured output, plus a small validator in code. No other libraries.

---

## 6. Database change proposal

**Reuse (no new table):**

| Proposed table | Use instead | Change |
|---|---|---|
| ai_audit_logs | `audit_logs` (record changes) + `ai_requests` (AI calls) | Add provider and model to the audit entry when AI caused a change |
| ai_reviews | `ai_action_logs` (human accept, edit or reject) + `ai_review_findings` | Add `provider` and `request_id` columns to `ai_action_logs` |
| ai_evaluations | `accuracy()` over `ai_action_logs` + reference-case runs in tests | Group accuracy by provider and model |
| ai_prompt_versions | Prompts versioned in code (git is the history). The version string is logged on every request and in `ai_lineage` | Start writing `ai_lineage` |
| ai_providers, ai_models, ai_routing_rules | Code defaults + per-practice overrides in `firm.settings.ai` (no secrets there) | Extend the `Firm.settings` type |
| ai_tool_permissions | Role-to-tool map in code + per-practice tool on/off in `firm.settings.ai` | n/a |
| ai_usage | Columns on `ai_requests` | n/a |

**New Postgres tables** (outside the workspace JSON, like `attachment_files`):

1. **`ai_requests`**: one row per provider call.
   - Who and where: `id`, `firm_id`, `user_id`, `channel` (app, chatgpt, copilot), `module`, `task`, `mode`.
   - Model: `provider`, `model`, `prompt_version`.
   - Outcome: `status`, `error_code`, `input_tokens`, `output_tokens`, `cost_micros`, `latency_ms`.
   - Links: `fallback_of`, `parent_id` (links review and collaborate calls), `created_at`.
   - Prompt and document content is **not** stored.
   - Indexed on (`firm_id`, `created_at`).
2. **`oauth_clients`, `oauth_tokens`**: MCP client registrations and hashed access and refresh tokens, bound to user and firm (Phases E and F).

Every row carries `firm_id`, and every query filters on it. Migrations follow the existing pattern (`CREATE TABLE IF NOT EXISTS` on first query).

---

## 7. Implementation task breakdown

Each task is done only when its "done when" check passes and is recorded.

| # | Task | Done when |
|---|---|---|
| B1 | Gateway core: types, task registry, `run()`, provider interface, error types | Unit tests with a fake provider: routing, schema rejection, retry, fallback |
| B2 | `ai_requests` table, usage and cost logging, pricing table | Each call writes one row with tokens, cost and latency; test proves the firm filter |
| B3 | Routing config: task defaults, `firm.settings.ai` overrides, fallback chain, per-firm monthly limit | Tests: override, fallback on provider error or timeout, limit refusal |
| C1 | Anthropic adapter; move `readStatement` onto the gateway, keeping prompt, schema and `pickBalances` unchanged | Existing statement-reader tests pass; one live read of a sample statement gives the same balance as before |
| D1 | OpenAI adapter (Responses API, structured output, PDF and image input, tool calls) | Same sample statements read through OpenAI; results compared and recorded |
| G1 | Document intelligence: replace the hard-coded extraction with gateway tasks per document type (the TypeScript shapes already exist), and AI classification after rules | Real values from sample documents; the confirm gate is unchanged; no fixed demo values outside seed data |
| G2 | Accounting: AI fallback in mapping after rules (`runGated` already has the hook); inconsistency detection | Mapping accuracy measured on sample trial balances |
| G3 | Risk and review: a task that writes `ai_review_findings` for a workpaper | Findings appear and block sign-off as today |
| G4 | Reporting: workpaper summaries, conclusion drafts, commentary (drafts only) | Drafts saved as `ai_draft`; nothing signed automatically |
| G5 | Workflow: outstanding-work summary over `myWork` and `getEngagementBlockers` | Matches the deterministic lists |
| G6 | Research: see decision 5 | n/a |
| H1 | Review mode (two providers, compare, disagreement goes to Check) and collaborate mode (draft, then reviewer), set per task | Tests; used first on statement reads and journal drafts |
| EF1 | OAuth 2.1 server: metadata, dynamic client registration, authorise (login and MFA), token, revoke | Tokens refused on another practice; expiry and revoke tested |
| EF2 | MCP server and the 8 tools (`search_workpapers`, `get_client_summary`, `get_account_details`, `find_missing_documents`, `generate_report`, `create_reconciliation_draft`, `retrieve_review_exceptions`, `get_workpaper_status`) | Per-tool tests for role, assigned clients and other firms; write tool creates a Draft only; every call audited |
| F1 | ChatGPT app: connect in developer mode, test every tool | Recorded test session |
| E1 | Copilot Studio agent with an MCP connector using Workpaper OAuth | Recorded test session in your Microsoft tenant |
| J1 | AI Control Centre (admin only): provider status and test, usage and cost by provider, module and practice, failures, latency, routing per task, thresholds (existing), limits, audit export | Page tests; numbers agree with `ai_requests` |
| K1 | Hardening: injection tests with malicious documents, rate limit on MCP, provider retention settings, secrets rotation runbook | Security test file passes |
| L1 | Reference cases: anonymised sample documents with human-checked answers, run against each provider | Accuracy, cost and latency table per provider |
| M1 | Release: Lambda timeout, new secrets in `workpaper/app` + buildspec, flags on, rollback note | Your approval at each production step |

---

## 8. Decisions needed before building

1. **Fake extraction now.** Should the hard-coded document extraction be switched off right away (values left blank for a person to enter, as the bank read already does) until G1 replaces it? Recommended: yes.
2. **Copilot sign-in.** Workpaper as the OAuth server for both ChatGPT and Copilot (recommended: one auth path, existing roles and MFA), or Entra ID first as the plan states?
3. **API keys in the Control Centre.** Recommended: keys stay in Secrets Manager only, and the dashboard shows status and a test button. Typing keys into the UI would mean storing them in the workspace and weakens Phase K.
4. **Deploys.** Every push goes live. Should I work on a local branch and push only with your go-ahead, behind off-by-default flags? Or would you rather add the master-only webhook filter back?
5. **Research intelligence.** Should it use internal sources only (standards library, practice rules, documents), or also live web search through the provider? Web search sends queries outside, so it needs a decision.
6. **Lambda timeout.** May I raise it from 30 s to 300 s when Claude-through-gateway ships? This is a production change.
7. **Base branch.** Should I build on `feat/self-service-password-reset`? It is 10 commits ahead of `master` and contains the current statement reader.

---

## 9. Keys and accounts needed, and when

| When | What | Where it goes |
|---|---|---|
| C1 (soon) | `ANTHROPIC_API_KEY` for local testing (prod already has one) | `.env.local` |
| D1 | `OPENAI_API_KEY` (an OpenAI Platform project key) | `.env.local`, then `workpaper/app` + buildspec list (you add the secret value) |
| F1 | A ChatGPT account with developer mode or apps access, to connect the MCP server | You connect it; I give the URL |
| E1 | Microsoft 365 tenant with Copilot Studio access; permission to create an agent and a custom connector | You sign in; I give the connector settings |
| M1 | Production values for the above in Secrets Manager | You store them; I update the buildspec list |

---

## 10. Risks

- **Whole-workspace locking:** agent-driven writes will hit "changed by someone else" more often. Write tools retry once and keep writes small. Moving to per-table storage is a larger, separate project.
- **Lambda limits:** a 15-minute ceiling, buffered responses and cold starts. The MCP server is stateless with JSON responses, which suits this.
- **External platform changes:** Apps SDK and Copilot Studio MCP support move quickly. Exact connector steps will be checked against current Microsoft and OpenAI docs when E1 and F1 start.
- **Cost:** review and collaborate modes double the spend on the tasks they cover. They are on only for tasks you choose, with per-practice limits.
