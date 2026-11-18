import crypto from 'crypto';
import { hasDatabase, query } from '../store';
import { db } from '../db';
import type { Channel } from '../ai/types';

/**
 * OAuth 2.1 for outside assistants (ChatGPT, Microsoft Copilot Studio) reaching the Workpaper MCP server.
 * Workpaper is its own authorisation server: a person approves the connection while signed in to Workpaper
 * (password and MFA as usual), so the assistant acts as that user, with that user's role and clients.
 * Public clients with PKCE (S256), dynamic client registration, short-lived access tokens, rotating
 * refresh tokens. Codes and tokens are stored only as SHA-256 hashes.
 */

export const SCOPES = ['workpaper.read', 'workpaper.draft'] as const;
const CODE_TTL_S = 10 * 60;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
// A registration nobody connects with lapses; every token issued renews it (longer than a refresh token lives)
const CLIENT_TTL_S = 90 * 24 * 60 * 60;

// shortcut: per-instance limit (each Lambda instance counts alone); move to a shared store if abuse is seen
const hits = new Map<string, { n: number; until: number }>();
/** True once `key` has made more than `limit` requests in the current minute. */
export function limited(key: string, limit: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.until < now) {
    // Keys can be IP addresses, so finished windows are dropped before the map grows without end
    if (hits.size > 5000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    hits.set(key, { n: 1, until: now + 60_000 });
    return false;
  }
  return ++h.n > limit;
}

/** The whole outside-assistant feature is off unless MCP_ENABLED=1 on the server. */
export const mcpServerEnabled = () => process.env.MCP_ENABLED === '1';
/** A practice turns it on in the AI Control Centre. */
export const mcpFirmEnabled = (firmId: string) => !!db.firms.find((f) => f.id === firmId)?.settings?.ai?.mcp?.enabled;

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

export interface Grant {
  client_id: string;
  client_name: string;
  user_id: string;
  firm_id: string;
  scope: string;
  /** One per connection, carried through every refresh, so revoking any of its tokens ends all of them */
  grant_id?: string;
}

// ---------------------------------------------------------------- storage (Postgres, or memory without a database)

const memory = new Map<string, { kind: string; data: unknown; expires_at: number | null }>();
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');

async function put(id: string, kind: string, data: unknown, ttlS: number | null) {
  const expires = ttlS ? Date.now() + ttlS * 1000 : null;
  if (!hasDatabase()) {
    memory.set(id, { kind, data, expires_at: expires });
    return;
  }
  await query('INSERT INTO oauth_records (id, kind, data, expires_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at', [
    id,
    kind,
    JSON.stringify(data),
    expires ? new Date(expires).toISOString() : null,
  ]);
}

async function get<T>(id: string): Promise<T | null> {
  if (!hasDatabase()) {
    const r = memory.get(id);
    if (!r || (r.expires_at && r.expires_at < Date.now())) return null;
    return r.data as T;
  }
  const rows = await query<{ data: T }>('SELECT data FROM oauth_records WHERE id = $1 AND (expires_at IS NULL OR expires_at > now())', [id]);
  return rows[0]?.data ?? null;
}

/** Deletes and returns in one step, so a code or refresh token can be used only once. */
async function take<T>(id: string): Promise<T | null> {
  if (!hasDatabase()) {
    const v = await get<T>(id);
    memory.delete(id);
    return v;
  }
  const rows = await query<{ data: T }>('DELETE FROM oauth_records WHERE id = $1 AND (expires_at IS NULL OR expires_at > now()) RETURNING data', [id]);
  return rows[0]?.data ?? null;
}

/** Drops everything past its expiry: used codes and tokens are deleted on use, unused ones only here. */
async function sweep() {
  if (!hasDatabase()) {
    for (const [id, r] of memory) if (r.expires_at && r.expires_at < Date.now()) memory.delete(id);
  } else await query('DELETE FROM oauth_records WHERE expires_at < now()');
}

async function remove(id: string) {
  if (!hasDatabase()) memory.delete(id);
  else await query('DELETE FROM oauth_records WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- clients

export class OAuthError extends Error {
  constructor(
    public error: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** Redirects must be https, or http on this computer for local testing. */
export function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

export async function registerClient(body: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https (or http on localhost).');
  const client: OAuthClient = {
    client_id: `mcpc_${crypto.randomUUID()}`,
    client_name: String(body.client_name ?? 'Assistant').slice(0, 100),
    redirect_uris: uris,
    created_at: new Date().toISOString(),
  };
  await put(`client:${client.client_id}`, 'client', client, CLIENT_TTL_S);
  return client;
}

export const getClient = (clientId: string) => get<OAuthClient>(`client:${clientId}`);

/** Which outside assistant a client is, from the name it registered with. */
export function channelOf(clientName: string): Channel {
  if (/chatgpt|openai/i.test(clientName)) return 'chatgpt';
  if (/copilot|microsoft|power ?platform/i.test(clientName)) return 'copilot';
  return 'mcp';
}

// ---------------------------------------------------------------- authorisation

export interface AuthRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  state?: string;
}

/** Checks an authorisation request before the person is asked; returns the client to show them. */
export async function checkAuthRequest(r: AuthRequest): Promise<{ client: OAuthClient; scope: string }> {
  const client = r.client_id ? await getClient(r.client_id) : null;
  if (!client) throw new OAuthError('invalid_client', 'This assistant is not registered with Workpaper.');
  if (!client.redirect_uris.includes(r.redirect_uri)) throw new OAuthError('invalid_request', 'The return address does not match the registration.');
  if (r.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(r.code_challenge || '')) throw new OAuthError('invalid_request', 'PKCE with S256 is required.');
  const asked = (r.scope || SCOPES.join(' ')).split(' ').filter(Boolean);
  const scope = asked.filter((s) => (SCOPES as readonly string[]).includes(s));
  return { client, scope: (scope.length ? scope : ['workpaper.read']).join(' ') };
}

export async function createCode(r: AuthRequest, user: { id: string; firmId: string }): Promise<string> {
  const { client, scope } = await checkAuthRequest(r);
  const code = random();
  await put(`code:${hash(code)}`, 'code', { ...r, scope, client_name: client.client_name, user_id: user.id, firm_id: user.firmId }, CODE_TTL_S);
  return code;
}

// ---------------------------------------------------------------- tokens

async function issue(grant: Grant) {
  const g = { ...grant, grant_id: grant.grant_id ?? crypto.randomUUID() };
  await sweep();
  const client = await getClient(g.client_id);
  if (client) await put(`client:${g.client_id}`, 'client', client, CLIENT_TTL_S);
  const access = `wpa_${random()}`;
  const refresh = `wpr_${random()}`;
  await put(`at:${hash(access)}`, 'access', g, ACCESS_TTL_S);
  await put(`rt:${hash(refresh)}`, 'refresh', g, REFRESH_TTL_S);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: g.scope };
}

export async function exchangeCode(p: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string }) {
  const stored = p.code ? await take<AuthRequest & Grant>(`code:${hash(p.code)}`) : null;
  if (!stored) throw new OAuthError('invalid_grant', 'The code is not valid or has expired.');
  if (stored.client_id !== p.client_id || stored.redirect_uri !== p.redirect_uri) throw new OAuthError('invalid_grant', 'The code was issued to another client.');
  const challenge = crypto.createHash('sha256').update(p.code_verifier ?? '').digest('base64url');
  if (!p.code_verifier || challenge !== stored.code_challenge) throw new OAuthError('invalid_grant', 'The PKCE verifier does not match.');
  return issue({ client_id: stored.client_id, client_name: stored.client_name, user_id: stored.user_id, firm_id: stored.firm_id, scope: stored.scope });
}

export async function refreshTokens(p: { refresh_token?: string; client_id?: string }) {
  // Rotated: the old refresh token stops working the moment it is used
  const g = p.refresh_token ? await take<Grant>(`rt:${hash(p.refresh_token)}`) : null;
  if (!g || g.client_id !== p.client_id) throw new OAuthError('invalid_grant', 'The refresh token is not valid.');
  return issue(g);
}

export const verifyAccessToken = (token: string) => get<Grant>(`at:${hash(token)}`);

/** Ends the whole connection: the token given, its pair, and any still-live tokens from earlier refreshes. */
export async function revoke(token: string) {
  const ids = [`at:${hash(token)}`, `rt:${hash(token)}`];
  const g = (await get<Grant>(ids[0])) ?? (await get<Grant>(ids[1]));
  for (const id of ids) await remove(id);
  if (!g?.grant_id) return; // a token issued before connections had an id: only itself
  if (!hasDatabase()) {
    for (const [id, r] of memory) if ((r.data as Grant).grant_id === g.grant_id) memory.delete(id);
    return;
  }
  // shortcut: no index on grant_id, a full scan of a small table; add one if oauth_records grows large
  await query("DELETE FROM oauth_records WHERE data->>'grant_id' = $1", [g.grant_id]);
}
