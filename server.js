import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, 'backup');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LEGACY_ANNOTATIONS_FILE = path.join(__dirname, 'annotations.json');
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ─── Target website config (set via the /setup popup, persisted locally) ─────

let REMOTE_HOST = null;
let START_PATH = '/';
let REVIEWER_NAME = null;

async function loadConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'));
    if (cfg.remoteHost) { REMOTE_HOST = cfg.remoteHost; START_PATH = cfg.startPath || '/'; }
    if (cfg.reviewerName) REVIEWER_NAME = cfg.reviewerName;
  } catch { /* no config yet — user will be prompted via /setup */ }
}

async function saveConfig(remoteHost, startPath, reviewerName) {
  REMOTE_HOST = remoteHost;
  START_PATH = startPath || '/';
  if (reviewerName) REVIEWER_NAME = reviewerName;
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ remoteHost, startPath: START_PATH, reviewerName: REVIEWER_NAME }, null, 2), 'utf-8');
}

function domEsc() {
  return REMOTE_HOST.replace(/\./g, '\\.');
}

// Scan annotations-<slug>.json files for previously reviewed sites (for the /setup dropdown).
async function listReviewedSites() {
  let files;
  try { files = await fs.readdir(__dirname); } catch { return []; }
  const sites = [];
  for (const f of files) {
    if (!/^annotations-[a-z0-9]+\.json$/.test(f)) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(__dirname, f), 'utf-8'));
      if (!Array.isArray(data) && data.site) sites.push({ site: data.site, lastModified: data.lastModified || '' });
    } catch { /* skip unreadable/invalid files */ }
  }
  sites.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return sites;
}

function setupPageHtml(errorMsg, sites) {
  const options = (sites || []).map(s => `<option value="${esc(s.site)}">${esc(s.site)}</option>`).join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>Review-tool instellen</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#1a1a1a}
  h1{font-size:1.3rem}
  label{display:block;font-size:.85rem;color:#555;margin-top:12px}
  input,select{width:100%;box-sizing:border-box;padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;margin:6px 0}
  button{padding:10px 18px;font-size:1rem;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;margin-top:6px}
  button:hover{background:#1d4ed8}
  .err{color:#b91c1c;margin-top:8px}
  p{color:#555;font-size:.9rem}
  .help-link{display:inline-block;margin-top:14px;font-size:.85rem;color:#2563eb;text-decoration:none;border:1px solid #d1d5db;padding:6px 12px;border-radius:6px}
  .help-link:hover{background:#f3f4f6}
</style></head>
<body>
  <h1>📝 Welke website wil je reviewen?</h1>
  <p>Kies een eerder gereviewde website of vul de URL in van een nieuwe website.</p>
  <form id="f">
    <label for="name">Jouw naam</label>
    <input id="name" name="name" type="text" placeholder="Jouw naam" value="${REVIEWER_NAME ? esc(REVIEWER_NAME) : ''}" required>
    ${options ? `<label for="siteSelect">Eerder gereviewde websites</label>
    <select id="siteSelect">
      <option value="">— Nieuwe website —</option>
      ${options}
    </select>` : ''}
    <label for="url">Website-URL</label>
    <input id="url" name="url" type="text" placeholder="https://voorbeeld.nl/pagina" required autofocus>
    <button type="submit">Starten</button>
    <div class="err" id="err">${errorMsg ? esc(errorMsg) : ''}</div>
  </form>
  <a class="help-link" href="/handleiding" target="_blank">Handleiding</a>
  <script>
    var siteSelect = document.getElementById('siteSelect');
    if (siteSelect) {
      siteSelect.addEventListener('change', function () {
        if (this.value) document.getElementById('url').value = this.value;
      });
    }
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(e.target);
      var url = data.get('url').trim();
      if (url && !/^https?:/i.test(url)) url = 'https://' + url;
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, name: data.get('name') }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { document.getElementById('err').textContent = res.d.error || 'Ongeldige URL'; return; }
          location.href = res.d.redirect;
        })
        .catch(function () { document.getElementById('err').textContent = 'Kon niet verbinden met de server.'; });
    });
  </script>
</body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal markdown-lite → HTML for showing Readme (no external deps).
function mdInline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let para = [];
  const flushPara = () => { if (para.length) { html += `<p>${mdInline(para.join(' '))}</p>`; para = []; } };
  for (const line of lines) {
    if (/^```/.test(line)) { flushPara(); html += inCode ? '</pre>' : '<pre>'; inCode = !inCode; continue; }
    if (inCode) { html += esc(line) + '\n'; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h${heading[1].length}>${mdInline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      flushPara();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${mdInline(line.replace(/^\s*-\s+/, ''))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!line.trim()) { flushPara(); continue; }
    para.push(line.trim());
  }
  flushPara();
  if (inList) html += '</ul>';
  if (inCode) html += '</pre>';
  return html;
}

function handleidingPageHtml(md) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>Handleiding</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:32px 24px 64px;color:#1a1a1a;line-height:1.55}
  h1{font-size:1.6rem} h2{font-size:1.25rem;margin-top:2em} h3{font-size:1.05rem}
  code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:.9em}
  pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto}
  a{color:#2563eb}
  ul{padding-left:1.4em}
</style></head>
<body>${mdToHtml(md)}</body></html>`;
}

// ─── Annotations storage ──────────────────────────────────────────────────────
// File format: { site: "<exacte gereviewde URL>", annotations: [...] }

function siteUrl() {
  return REMOTE_HOST ? `https://${REMOTE_HOST}${START_PATH}` : null;
}

async function loadAnnotations() {
  try {
    const raw = JSON.parse(await fs.readFile(await annotationsFile(), 'utf-8'));
    return Array.isArray(raw) ? raw : (raw.annotations || []);
  } catch { return []; }
}

async function saveAnnotations(list) {
  const file = await annotationsFile();
  let prevFirstReviewDate = null;
  try {
    const prev = JSON.parse(await fs.readFile(file, 'utf-8'));
    if (!Array.isArray(prev)) prevFirstReviewDate = prev.firstReviewDate || null;
  } catch { /* file doesn't exist yet */ }
  const timestamps = list.map(a => a.timestamp).filter(Boolean).sort();
  const payload = {
    site: siteUrl(),
    reviewer: REVIEWER_NAME,
    firstReviewDate: prevFirstReviewDate || timestamps[0] || null,
    lastModified: new Date().toISOString(),
    annotations: list,
  };
  const json = JSON.stringify(payload, null, 2);
  await fs.writeFile(file, json, 'utf-8');
  await backupAnnotations(json);
}

// Site-specific file: annotations-<eerste 10 letters van de site-url>.json
function siteSlug() {
  if (!REMOTE_HOST) return 'default';
  const stripped = REMOTE_HOST.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
  return stripped.slice(0, 10) || 'default';
}

async function annotationsFile() {
  const file = path.join(__dirname, `annotations-${siteSlug()}.json`);
  // One-time migration from the old shared annotations.json, if present.
  try {
    await fs.access(file);
  } catch {
    try {
      const legacy = JSON.parse(await fs.readFile(LEGACY_ANNOTATIONS_FILE, 'utf-8'));
      const annotations = Array.isArray(legacy) ? legacy : (legacy.annotations || []);
      const timestamps = annotations.map(a => a.timestamp).filter(Boolean).sort();
      await fs.writeFile(file, JSON.stringify({
        site: siteUrl(),
        reviewer: REVIEWER_NAME,
        firstReviewDate: timestamps[0] || null,
        lastModified: new Date().toISOString(),
        annotations,
      }, null, 2), 'utf-8');
    } catch { /* no legacy file to migrate */ }
  }
  return file;
}

async function backupAnnotations(json) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, one backup per day
  const backupFile = path.join(BACKUP_DIR, `annotations-${siteSlug()}-${today}.json`);
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.writeFile(backupFile, json, 'utf-8');
  } catch (e) {
    console.warn('[backup] failed:', e.message);
  }
}

// ─── Remote fetching ─────────────────────────────────────────────────────────

function fetchRemote(url, hops = 8) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https://') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HRReview/1.0)',
        'Accept': '*/*',
        'Accept-Language': 'nl,en;q=0.5',
        'Accept-Encoding': 'gzip, identity',
      }
    }, (res) => {
      const { statusCode, headers } = res;
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && hops > 0) {
        res.resume();
        const next = headers.location.startsWith('http')
          ? headers.location
          : `https://${REMOTE_HOST}${headers.location}`;
        fetchRemote(next, hops - 1).then(resolve).catch(reject);
        return;
      }
      const stream = headers['content-encoding'] === 'gzip' ? res.pipe(createGunzip()) : res;
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({ statusCode, headers, body: Buffer.concat(chunks), finalUrl: url }));
      stream.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── HTML/CSS rewriting ───────────────────────────────────────────────────────

function proxyPath(p) {
  if (!p || p.startsWith('/proxy/') || p.startsWith('/annotation-ui') || p.startsWith('/api/')) return null;
  return `/proxy${p.startsWith('/') ? '' : '/'}${p}`;
}

function rewriteHtml(html, remotePath) {
  html = html.replace(/<base\b[^>]*>/gi, '');

  // Absolute same-domain URLs
  html = html.replace(
    new RegExp(`(href|src|action)="https://${domEsc()}(/[^"#]*)"`, 'gi'),
    (_, attr, p) => `${attr}="/proxy${p}"`
  );

  // Root-relative hrefs and srcs
  html = html.replace(/\bhref="(\/[^"#]+)"/g, (m, p) => { const r = proxyPath(p); return r ? `href="${r}"` : m; });
  html = html.replace(/\bsrc="(\/[^"]+)"/g, (m, p) => { const r = proxyPath(p); return r ? `src="${r}"` : m; });

  // srcset
  html = html.replace(/\bsrcset="([^"]+)"/g, (_, set) => {
    const rw = set.split(',').map(part => {
      const [u, ...rest] = part.trim().split(/\s+/);
      const r = u.startsWith('/') ? proxyPath(u) : null;
      return [r || u, ...rest].join(' ');
    }).join(', ');
    return `srcset="${rw}"`;
  });

  // Strip /proxy prefix from URL before the SPA router initialises.
  const spy = `<script>(function(){var l=location.pathname;if(l.startsWith('/proxy/')){history.replaceState(history.state,'',l.slice(6)+location.search+location.hash);}}());<\/script>`;
  html = html.replace(/<head>/i, '<head>\n  ' + spy);

  // Inject annotation UI
  html = html.replace(/<\/body>/i,
    `  <link rel="stylesheet" href="/annotation-ui.css">\n` +
    `  <script>window.__PROXY_PAGE__=${JSON.stringify(remotePath)};<\/script>\n` +
    `  <script src="/annotation-ui.js" defer><\/script>\n` +
    `</body>`
  );

  return html;
}

function rewriteCss(css) {
  css = css.replace(
    new RegExp(`url\\(["']?https://${domEsc()}(/[^"')]+)["']?\\)`, 'gi'),
    (_, p) => `url('/proxy${p}')`
  );
  css = css.replace(/url\(["']?(\/[^"')]+)["']?\)/g, (m, p) => {
    if (p.startsWith('/proxy/') || p.startsWith('/annotation-ui')) return m;
    return `url('/proxy${p}')`;
  });
  return css;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function jsonRes(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 200_000) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function proxyToRemote(remotePath, res) {
  const url = `https://${REMOTE_HOST}${remotePath}`;
  const { statusCode, headers, body } = await fetchRemote(url);
  const ct = (headers['content-type'] || '').toLowerCase();

  if (ct.includes('text/html')) {
    const html = rewriteHtml(body.toString('utf-8'), remotePath.split('?')[0]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (ct.includes('text/css')) {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    res.end(rewriteCss(body.toString('utf-8')));
  } else {
    const safe = { 'Content-Type': ct || 'application/octet-stream' };
    if (headers['cache-control']) safe['Cache-Control'] = headers['cache-control'];
    res.writeHead(statusCode, safe);
    res.end(body);
  }
}

// ─── Main server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    const method = req.method.toUpperCase();

    // Root → proxy to the configured site (its own root page lives here too,
    // once the /proxy prefix is stripped from the address bar client-side).
    // The startup popup is served separately at /setup so it never collides
    // with the reviewed site's own root path.
    if (pathname === '/') {
      if (!REMOTE_HOST) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
      res.writeHead(302, { Location: `/proxy${START_PATH}` });
      return res.end();
    }

    // Setup popup: choose which website to review
    if (pathname === '/setup') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(setupPageHtml(null, await listReviewedSites()));
      return;
    }

    // Handleiding: toont Readme als leesbare pagina
    if (pathname === '/handleiding') {
      let md;
      try { md = await fs.readFile(path.join(__dirname, 'Readme.md'), 'utf-8'); }
      catch { md = '# Handleiding niet gevonden'; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(handleidingPageHtml(md));
      return;
    }

    if (pathname === '/api/config') {
      if (method === 'GET') return jsonRes(res, 200, { remoteHost: REMOTE_HOST, startPath: START_PATH, reviewerName: REVIEWER_NAME });
      if (method === 'POST') {
        const body = await readBody(req).catch(() => null);
        if (!String(body?.name || '').trim())
          return jsonRes(res, 400, { error: 'Vul je naam in' });
        let target;
        try { target = new URL(body?.url); }
        catch { return jsonRes(res, 400, { error: 'Vul een geldige URL in, bijv. https://voorbeeld.nl/pagina' }); }
        if (!/^https?:$/.test(target.protocol))
          return jsonRes(res, 400, { error: 'Alleen http(s) URLs worden ondersteund' });
        // Resolve redirects up front so a marketing/redirect domain doesn't
        // silently break every asset request (redirects can drop the path).
        let finalHost = target.hostname;
        let finalPath = target.pathname || '/';
        try {
          const probe = await fetchRemote(target.href);
          const resolved = new URL(probe.finalUrl);
          finalHost = resolved.hostname;
          finalPath = resolved.pathname || '/';
        } catch { /* probe failed — fall back to the URL as typed */ }
        await saveConfig(finalHost, finalPath, String(body.name).trim());
        return jsonRes(res, 200, { redirect: `/proxy${START_PATH}` });
      }
      return jsonRes(res, 405, { error: 'Method not allowed' });
    }

    // Static annotation UI files
    if (pathname === '/annotation-ui.js' || pathname === '/annotation-ui.css') {
      try {
        const content = await fs.readFile(path.join(PUBLIC_DIR, pathname.slice(1)));
        const ct = pathname.endsWith('.js')
          ? 'application/javascript; charset=utf-8'
          : 'text/css; charset=utf-8';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
        res.end(content);
      } catch {
        res.writeHead(404); res.end();
      }
      return;
    }

    // Annotations API – list / create
    if (pathname === '/api/annotations') {
      if (method === 'GET') {
        const page = new URL(req.url, 'http://x').searchParams.get('page');
        const all = await loadAnnotations();
        return jsonRes(res, 200, page ? all.filter(a => a.page === page) : all);
      }
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body?.page || !body?.selectedText || !body?.comment)
          return jsonRes(res, 400, { error: 'Missing fields: page, selectedText, comment' });
        const ann = {
          id: randomUUID(),
          page: String(body.page).slice(0, 500),
          selectedText: String(body.selectedText).slice(0, 5000),
          prefix: String(body.prefix || '').slice(0, 200),
          suffix: String(body.suffix || '').slice(0, 200),
          comment: String(body.comment).slice(0, 20000),
          timestamp: new Date().toISOString(),
        };
        const all = await loadAnnotations();
        all.push(ann);
        await saveAnnotations(all);
        return jsonRes(res, 201, ann);
      }
      return jsonRes(res, 405, { error: 'Method not allowed' });
    }

    // Annotations API – delete by id
    const delMatch = pathname.match(/^\/api\/annotations\/([a-f0-9-]{36})$/);
    if (delMatch && method === 'DELETE') {
      const id = delMatch[1];
      const all = await loadAnnotations();
      await saveAnnotations(all.filter(a => a.id !== id));
      return jsonRes(res, 200, { deleted: id });
    }

    // Annotations API – update comment by id
    if (delMatch && method === 'PATCH') {
      const id = delMatch[1];
      const body = await readBody(req);
      if (!body?.comment) return jsonRes(res, 400, { error: 'Missing comment' });
      const all = await loadAnnotations();
      const ann = all.find(a => a.id === id);
      if (!ann) return jsonRes(res, 404, { error: 'Not found' });
      ann.comment = String(body.comment).slice(0, 20000);
      ann.modified = new Date().toISOString();
      await saveAnnotations(all);
      return jsonRes(res, 200, ann);
    }

    // Proxy: strip /proxy prefix if present, then forward everything to remote
    if (!REMOTE_HOST) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let remotePath = (pathname.startsWith('/proxy/') ? pathname.slice('/proxy'.length) : pathname) + qs;
    if (!remotePath || remotePath === '' || remotePath === '?') remotePath = '/';

    try {
      await proxyToRemote(remotePath, res);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(502); res.end(`Proxy error: ${e.message}`); }
    }
  } catch (e) {
    console.error('Server error:', e);
    if (!res.headersSent) { res.writeHead(500); res.end('Internal error'); }
  }
});

await loadConfig();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n📝  Handreiking Review Tool`);
  console.log(`    → http://localhost:${PORT}`);
  console.log(`\n    Selecteer tekst op de pagina om opmerkingen toe te voegen.`);
  console.log(`    Opmerkingen worden opgeslagen in annotations.json\n`);
  if (!REMOTE_HOST) console.log(`    Open de link hierboven om de te reviewen website in te stellen.\n`);
});
