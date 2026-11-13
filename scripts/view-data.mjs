// Read-only viewer for the workspace data. Reads Postgres when DATABASE_URL is set, else the local .workspace_state.json.
// Usage: npm run view-data                      -> list every collection with its row count
//        npm run view-data -- clients           -> show that collection as a table
//        npm run view-data -- clients acme      -> only rows containing "acme"
//        npm run view-data -- clients --json    -> full rows as JSON
//        npm run view-data -- --serve           -> browse it at http://localhost:4400 (this machine only)
import fs from 'fs';
import http from 'http';
import pg from 'pg';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const serve = args.includes('--serve');
const [name, filter] = args.filter((a) => !a.startsWith('--'));
const source = process.env.DATABASE_URL ? 'database' : 'local file';

async function load() {
  if (process.env.DATABASE_URL) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(`SELECT version, data FROM workspace_state WHERE id = 'default'`);
      const state = rows[0] ?? { version: 0, data: {} };
      const files = await client.query('SELECT id, filename, mime, size, created_at FROM attachment_files ORDER BY created_at');
      state.data.attachment_files = files.rows;
      return state;
    } finally {
      await client.end();
    }
  }
  if (fs.existsSync('.workspace_state.json')) return JSON.parse(fs.readFileSync('.workspace_state.json', 'utf8'));
  console.error('No DATABASE_URL and no .workspace_state.json: start the dev server and use the app first.');
  process.exit(1);
}

// Password hashes, MFA secrets and access tokens never get shown
const hide = /hash|secret|token/i;
const rowsOf = (data, c, q) =>
  (data[c] ?? [])
    .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hide.test(k) && v ? '***' : v])));

if (serve) {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const cell = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const c = url.searchParams.get('c');
      const q = url.searchParams.get('q') ?? '';
      const { version, data = {} } = await load();
      const nav = Object.entries(data)
        .map(([k, v]) => `<a href="?c=${encodeURIComponent(k)}"${k === c ? ' class="on"' : ''}>${esc(k)} <small>${Array.isArray(v) ? v.length : ''}</small></a>`)
        .join('');
      let main = `<p>Pick a collection on the left. Workspace version ${esc(version)}, read from the ${source}.</p>`;
      if (c && c in data) {
        const rows = rowsOf(data, c, q);
        const cols = [...new Set(rows.flatMap(Object.keys))];
        main = `<form><input type="hidden" name="c" value="${esc(c)}"><input name="q" value="${esc(q)}" placeholder="Filter rows" aria-label="Filter rows"> <button>Filter</button> ${rows.length} row(s)</form>
<div class="wrap"><table><thead><tr>${cols.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${cols.map((k) => `<td>${esc(cell(r[k]))}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Workspace data</title><style>
body{margin:0;display:flex;font:13px system-ui,sans-serif;color:#122654;height:100vh}
nav{width:230px;overflow:auto;border-right:1px solid #E3E7EF;background:#F5F8FD;padding:8px}
nav a{display:flex;justify-content:space-between;padding:4px 8px;border-radius:6px;color:inherit;text-decoration:none}
nav a:hover,nav a.on{background:#122654;color:#fff}main{flex:1;overflow:hidden;display:flex;flex-direction:column;padding:12px}
.wrap{overflow:auto;flex:1}table{border-collapse:collapse}th,td{border:1px solid #E3E7EF;padding:3px 6px;text-align:left;vertical-align:top;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{position:sticky;top:0;background:#fff}td:hover{white-space:normal;word-break:break-all}form{margin-bottom:8px}</style>
<nav>${nav}</nav><main>${main}</main>`);
    })
    .listen(4400, '127.0.0.1', () => console.log(`Open http://localhost:4400  (${source}, read-only, Ctrl+C to stop)`));
} else {
  const { version, data = {} } = await load();
  if (!name) {
    console.log(`Workspace version ${version} (${source})`);
    console.table(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { rows: Array.isArray(v) ? v.length : '-' }])));
    process.exit(0);
  }
  if (!(name in data)) {
    console.error(`No collection "${name}". Run without arguments to list them.`);
    process.exit(1);
  }
  const rows = rowsOf(data, name, filter);
  if (asJson) console.log(JSON.stringify(rows, null, 2));
  else console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : v]))));
  console.log(`${rows.length} row(s)`);
}
