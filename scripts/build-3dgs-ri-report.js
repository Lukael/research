#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = process.env.REPORT_SOURCE_ROOT || '/home/lukael/data/3DGS-RI/ri_gaussian_tomography';
const projectSlug = '3dgs-ri';
const projectRoot = path.join(repoRoot, 'projects', projectSlug);
const assetsRoot = path.join(projectRoot, 'assets');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${projectSlug}-report-`));
const tmpHtml = path.join(tmpRoot, `${projectSlug}-report.html`);
const reportMd = path.join(sourceRoot, 'REPORT_ko.md');
const reportEnc = path.join(projectRoot, 'report.enc');
const embeddedAssetCache = new Map();
const imageMimes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_~[\](){}:,.!?/\\|+="']/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || `section-${Math.random().toString(36).slice(2)}`;
}

function inlineMarkdown(value) {
  let out = escapeHtml(value);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function rewriteAsset(src) {
  if (/^(https?:|data:|#)/.test(src)) return src;
  const withoutFragment = src.split('#')[0].split('?')[0];
  const ext = path.extname(withoutFragment).toLowerCase();
  const mime = imageMimes.get(ext);
  if (!mime) return src;

  const filePath = path.resolve(sourceRoot, withoutFragment);
  const sourceBoundary = `${path.resolve(sourceRoot)}${path.sep}`;
  if (!filePath.startsWith(sourceBoundary)) fail(`Refusing to embed image outside source root: ${src}`);
  if (!fs.existsSync(filePath)) fail(`Missing report image: ${filePath}`);
  if (!embeddedAssetCache.has(filePath)) {
    embeddedAssetCache.set(filePath, `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`);
  }
  return embeddedAssetCache.get(filePath);
}

function renderTable(rows) {
  const parsed = rows.map((row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const header = parsed[0] || [];
  const body = parsed.slice(2);
  const renderCell = (cell, tag) => {
    const imageOnly = cell.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    const content = imageOnly
      ? `<img src="${escapeHtml(rewriteAsset(imageOnly[1]))}" alt="" loading="lazy">`
      : inlineMarkdown(cell).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, src) => `<img src="${escapeHtml(rewriteAsset(src))}" alt="" loading="lazy">`);
    return `<${tag}>${content}</${tag}>`;
  };
  return [
    '<div class="table-wrap"><table>',
    '<thead><tr>' + header.map((cell) => renderCell(cell, 'th')).join('') + '</tr></thead>',
    '<tbody>' + body.map((row) => '<tr>' + row.map((cell) => renderCell(cell, 'td')).join('') + '</tr>').join('') + '</tbody>',
    '</table></div>',
  ].join('\n');
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const headings = [];
  let paragraph = [];
  let list = [];
  let table = [];
  let inCode = false;
  let codeLang = '';
  let code = [];
  let inBlockquote = false;
  let blockquote = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' ')).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, src) => `<img src="${escapeHtml(rewriteAsset(src))}" alt="" loading="lazy">`)}</p>`);
    paragraph = [];
  }
  function flushList() {
    if (!list.length) return;
    html.push('<ul>' + list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('') + '</ul>');
    list = [];
  }
  function flushTable() {
    if (!table.length) return;
    html.push(renderTable(table));
    table = [];
  }
  function flushBlockquote() {
    if (!blockquote.length) return;
    html.push(`<blockquote>${blockquote.map((line) => `<p>${inlineMarkdown(line)}</p>`).join('')}</blockquote>`);
    blockquote = [];
    inBlockquote = false;
  }
  function flushAll() {
    flushParagraph();
    flushList();
    flushTable();
    flushBlockquote();
  }

  for (const raw of lines) {
    const line = raw;
    const fence = line.match(/^```\s*([\w.+-]*)\s*$/);
    if (fence) {
      if (inCode) {
        html.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(code.join('\n'))}</code></pre>`);
        inCode = false;
        codeLang = '';
        code = [];
      } else {
        flushAll();
        inCode = true;
        codeLang = fence[1] || '';
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      const idBase = slugify(text);
      let id = idBase;
      let suffix = 2;
      while (headings.some((h) => h.id === id)) id = `${idBase}-${suffix++}`;
      headings.push({ level, text: text.replace(/`/g, ''), id });
      html.push(`<h${level} id="${id}">${inlineMarkdown(text)}<a class="anchor" href="#${id}" aria-label="section link">#</a></h${level}>`);
      continue;
    }

    if (/^\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      table.push(line);
      continue;
    } else {
      flushTable();
    }

    if (/^---+$/.test(line.trim())) {
      flushAll();
      html.push('<hr>');
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      flushTable();
      inBlockquote = true;
      blockquote.push(quote[1]);
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    paragraph.push(line.trim());
  }
  flushAll();
  return { body: html.join('\n'), headings };
}

function reportShell() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>3D Gaussian RI 다중 슬라이스 검증 보고서</title>
  <meta name="description" content="Waller-style multi-slice RI propagation과 3D Gaussian RI representation 검증 보고서.">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <style>
    :root { color-scheme: dark; --bg:#11130f; --panel:#181b15; --panel-strong:#20251c; --ink:#f1f4e8; --muted:#adb6a1; --line:rgba(241,244,232,.14); --accent:#5fd1bf; --accent-ink:#071917; --warm:#e0a15f; --danger:#ff8f8f; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    *{box-sizing:border-box} html,body{min-height:100%;margin:0;background:var(--bg);color:var(--ink)} body{display:grid;place-items:center;padding:32px 18px;background:radial-gradient(circle at 20% 10%,rgba(95,209,191,.16),transparent 28%),radial-gradient(circle at 80% 20%,rgba(224,161,95,.13),transparent 32%),var(--bg)}
    .unlock-shell{width:min(100%,520px);padding:30px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,rgba(32,37,28,.92),rgba(24,27,21,.96));box-shadow:0 20px 70px rgba(0,0,0,.32)}
    .project-kicker{margin:0 0 12px;color:var(--warm);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase} h1{margin:0 0 10px;font-size:29px;line-height:1.18}.subtitle{margin:0 0 22px;color:var(--muted);line-height:1.55}form{display:grid;gap:12px}label{color:var(--muted);font-size:14px;font-weight:700}input{width:100%;min-height:46px;border:1px solid var(--line);border-radius:10px;background:var(--panel-strong);color:var(--ink);font:inherit;padding:0 13px;outline:none}input:focus{border-color:rgba(95,209,191,.68);box-shadow:0 0 0 3px rgba(95,209,191,.12)}button{min-height:46px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-ink);cursor:pointer;font:inherit;font-weight:850}button:disabled{cursor:wait;opacity:.62}#unlock-status{min-height:20px;margin:2px 0 0;color:var(--danger);font-size:14px;line-height:1.45}.is-unlocked{display:block;padding:0}.is-unlocked .unlock-shell{display:none}.report-frame{position:fixed;inset:0;width:100%;height:100%;border:0;background:var(--bg)}
  </style>
  <script src="../../scripts/decrypt-report.js" defer></script>
</head>
<body data-payload="report.enc">
  <main class="unlock-shell" aria-labelledby="report-title">
    <p class="project-kicker">Private Report</p>
    <h1 id="report-title">3D Gaussian RI 다중 슬라이스 검증 보고서</h1>
    <p class="subtitle">Waller-style reference loop, Gaussian RI slicing, multi-view, splat-to-RI 결과를 묶은 HTML 리포트입니다.</p>
    <form id="unlock-form">
      <label for="report-password">Password</label>
      <input id="report-password" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Unlock report</button>
      <p id="unlock-status" role="status" aria-live="polite"></p>
    </form>
  </main>
</body>
</html>
`;
}

function buildReportHtml(markdown) {
  const { body, headings } = renderMarkdown(markdown);
  const nav = headings
    .filter((h) => h.level <= 3)
    .map((h) => `<a class="toc-level-${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`)
    .join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="./">
  <title>3D Gaussian RI 다중 슬라이스 검증 보고서</title>
  <style>
    :root{color-scheme:dark;--bg:#11130f;--panel:#181c16;--panel2:#20261d;--ink:#eef2ea;--muted:#a2ac9f;--line:rgba(238,242,234,.15);--accent:#5fd1bf;--accent2:#8fe5d7;--warm:#e0a15f;--code:#0b0d0a;--danger:#ff8f8f}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 15% -5%,rgba(95,209,191,.2),transparent 28%),linear-gradient(180deg,#11130f,#0d0f0c 55%,#11130f);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.68}.hero{min-height:76vh;display:grid;align-content:end;padding:64px max(24px,calc((100vw - 1180px)/2)) 54px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,rgba(95,209,191,.11),rgba(224,161,95,.08) 46%,transparent 72%)}.kicker{margin:0 0 14px;color:var(--warm);font-weight:850;letter-spacing:.07em;text-transform:uppercase}.hero h1{max-width:980px;margin:0;font-size:clamp(2.7rem,7vw,6.2rem);line-height:.98;letter-spacing:-.04em}.hero p{max-width:780px;margin:24px 0 0;color:#d2d9cf;font-size:1.14rem}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:34px;max-width:1240px;margin:0 auto;padding:42px 24px 90px}.toc{position:sticky;top:18px;align-self:start;max-height:calc(100vh - 36px);overflow:auto;border:1px solid var(--line);border-radius:14px;background:rgba(24,28,22,.72);padding:18px}.toc strong{display:block;margin-bottom:10px;color:var(--warm)}.toc a{display:block;padding:7px 0;color:var(--muted);text-decoration:none;border-bottom:1px solid rgba(238,242,234,.06);font-size:.94rem}.toc a:hover{color:var(--accent2)}.toc-level-3{padding-left:14px!important;font-size:.86rem!important}.content{min-width:0}.content h1,.content h2,.content h3,.content h4{line-height:1.18;letter-spacing:-.02em}.content h1{font-size:2.4rem}.content h2{margin:56px 0 18px;padding-top:8px;font-size:2rem;color:#f5f8ef}.content h3{margin:34px 0 14px;color:var(--accent2);font-size:1.35rem}.content h4{color:var(--warm)}.anchor{opacity:.25;margin-left:.4em;text-decoration:none}.content h2:hover .anchor,.content h3:hover .anchor{opacity:.8}.content p,.content li{color:#d7ded3}.content a{color:var(--accent2);text-underline-offset:.18em}.content code{border:1px solid rgba(95,209,191,.22);border-radius:6px;background:rgba(95,209,191,.08);padding:.08em .35em;color:#eafff9}pre{overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--code);padding:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}pre code{border:0;background:transparent;padding:0;color:#dce8d7;font-size:.9rem}.table-wrap{overflow:auto;margin:18px 0 26px;border:1px solid var(--line);border-radius:14px;background:rgba(24,28,22,.72)}table{width:100%;border-collapse:collapse;min-width:620px}th,td{padding:12px 14px;border-bottom:1px solid rgba(238,242,234,.11);vertical-align:top}th{color:var(--warm);text-align:left;background:rgba(255,255,255,.035)}td img,th img{max-width:360px;width:100%;border-radius:10px;border:1px solid var(--line);background:#0d0f0c}p>img{display:block;max-width:100%;margin:18px auto;border-radius:14px;border:1px solid var(--line);background:#0d0f0c}blockquote{margin:22px 0;padding:16px 18px;border-left:4px solid var(--accent);background:rgba(95,209,191,.08);border-radius:0 12px 12px 0}hr{border:0;border-top:1px solid var(--line);margin:42px 0}.callout{border:1px solid rgba(95,209,191,.35);background:rgba(95,209,191,.08);padding:14px 16px;border-radius:12px;color:#dffaf5}@media(max-width:900px){.layout{grid-template-columns:1fr}.toc{position:static;max-height:none}.hero{min-height:58vh}.hero h1{font-size:3rem}table{min-width:520px}}
  </style>
</head>
<body>
  <header class="hero">
    <p class="kicker">Lukael Research · Private HTML Report</p>
    <h1>3D Gaussian RI 다중 슬라이스 토모그래피 검증</h1>
    <p>Waller-style multi-slice reference loop와 3D Gaussian RI representation을 한 장의 탐색 가능한 HTML 리포트로 정리했습니다.</p>
  </header>
  <div class="layout">
    <nav class="toc" aria-label="Table of contents"><strong>Contents</strong>${nav}</nav>
    <main class="content">${body}</main>
  </div>
</body>
</html>`;
}

if (!fs.existsSync(reportMd)) fail(`Missing report source: ${reportMd}`);
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(tmpRoot, { recursive: true });
fs.rmSync(assetsRoot, { recursive: true, force: true });
fs.writeFileSync(path.join(projectRoot, 'index.html'), reportShell());
fs.writeFileSync(tmpHtml, buildReportHtml(fs.readFileSync(reportMd, 'utf8')));

if (process.env.REPORT_PASSWORD) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'encrypt-report.js'), tmpHtml, reportEnc], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
} else {
  console.warn(`REPORT_PASSWORD is not set; wrote transient plaintext HTML to ${tmpHtml} and skipped report.enc.`);
}
console.log(`Built ${path.relative(repoRoot, projectRoot)}`);
