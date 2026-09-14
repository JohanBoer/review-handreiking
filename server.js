import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANNOTATIONS_FILE = path.join(__dirname, 'annotations.json');
const BACKUP_DIR = path.join(__dirname, 'backup');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ─── Target website config (set via the /setup popup, persisted locally) ─────

let REMOTE_HOST = null;
let START_PATH = '/';

async function loadConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'));
    if (cfg.remoteHost) { REMOTE_HOST = cfg.remoteHost; START_PATH = cfg.startPath || '/'; }
  } catch { /* no config yet — user will be prompted via /setup */ }
}

async function saveConfig(remoteHost, startPath) {
  REMOTE_HOST = remoteHost;
  START_PATH = startPath || '/';
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ remoteHost, startPath: START_PATH }, null, 2), 'utf-8');
}

function domEsc() {
  return REMOTE_HOST.replace(/\./g, '\\.');
}

function setupPageHtml(errorMsg) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>Review-tool instellen</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#1a1a1a}
  h1{font-size:1.3rem}
  input{width:100%;box-sizing:border-box;padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;margin:12px 0}
  button{padding:10px 18px;font-size:1rem;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer}
  button:hover{background:#1d4ed8}
  .err{color:#b91c1c;margin-top:8px}
  p{color:#555;font-size:.9rem}
</style></head>
<body>
  <h1>📝 Welke website wil je reviewen?</h1>
  <p>Vul de URL in van de website die je via deze tool wilt bekijken en annoteren.</p>
  <form id="f">
    <input name="url" type="url" placeholder="https://voorbeeld.nl/pagina" required autofocus>
    <button type="submit">Starten</button>
    <div class="err" id="err">${errorMsg ? esc(errorMsg) : ''}</div>
  </form>
  <script>
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = new FormData(e.target).get('url');
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
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

// ─── Annotations storage ──────────────────────────────────────────────────────

async function loadAnnotations() {
  try { return JSON.parse(await fs.readFile(ANNOTATIONS_FILE, 'utf-8')); }
  catch { return []; }
}

async function saveAnnotations(list) {
  const json = JSON.stringify(list, null, 2);
  await fs.writeFile(ANNOTATIONS_FILE, json, 'utf-8');
  await backupAnnotations(json);
}

async function backupAnnotations(json) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, one backup per day
  const backupFile = path.join(BACKUP_DIR, `annotations-${today}.json`);
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

    // Root → redirect to the configured site, or show the setup popup first
    if (pathname === '/') {
      if (!REMOTE_HOST) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
      res.writeHead(302, { Location: `/proxy${START_PATH}` });
      return res.end();
    }

    // Setup popup: choose which website to review
    if (pathname === '/setup') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(setupPageHtml());
      return;
    }

    if (pathname === '/api/config') {
      if (method === 'GET') return jsonRes(res, 200, { remoteHost: REMOTE_HOST, startPath: START_PATH });
      if (method === 'POST') {
        const body = await readBody(req).catch(() => null);
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
        await saveConfig(finalHost, finalPath);
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
