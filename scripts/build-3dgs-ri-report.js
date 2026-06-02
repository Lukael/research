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
const reportTemplate = fs.readFileSync(path.join(repoRoot, 'templates', 'report-template.html'), 'utf8');
const unlockTemplate = fs.readFileSync(path.join(repoRoot, 'templates', 'unlock-template.html'), 'utf8');
const reportStyle = reportTemplate.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
const blobScript = reportTemplate.match(/<script>\s*\(function \(\)[\s\S]*?<\/script>/i)?.[0];
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

function readImage(src) {
  const dataUri = src.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUri) {
    return { mime: dataUri[1], base64: dataUri[2] };
  }
  if (/^(https?:|#)/.test(src)) fail(`Refusing to embed non-local image: ${src}`);
  const withoutFragment = src.split('#')[0].split('?')[0];
  const ext = path.extname(withoutFragment).toLowerCase();
  const mime = imageMimes.get(ext);
  if (!mime) fail(`Unsupported report image type: ${src}`);

  const filePath = path.resolve(sourceRoot, withoutFragment);
  const sourceBoundary = `${path.resolve(sourceRoot)}${path.sep}`;
  if (!filePath.startsWith(sourceBoundary)) fail(`Refusing to embed image outside source root: ${src}`);
  if (!fs.existsSync(filePath)) fail(`Missing report image: ${filePath}`);
  if (!embeddedAssetCache.has(filePath)) {
    embeddedAssetCache.set(filePath, { mime, base64: fs.readFileSync(filePath).toString('base64') });
  }
  return embeddedAssetCache.get(filePath);
}

function renderImage(src) {
  const image = readImage(src);
  return `<img data-image-mime="${escapeHtml(image.mime)}" data-image-base64="${escapeHtml(image.base64)}" alt="" loading="lazy">`;
}

function renderTable(rows) {
  const parsed = rows.map((row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const header = parsed[0] || [];
  const body = parsed.slice(2);
  const renderCell = (cell, tag) => {
    const imageOnly = cell.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    const content = imageOnly
      ? renderImage(imageOnly[1])
      : inlineMarkdown(cell).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, src) => renderImage(src));
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
    html.push(`<p>${inlineMarkdown(paragraph.join(' ')).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, src) => renderImage(src))}</p>`);
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
  return unlockTemplate.replaceAll('{{PROJECT_TITLE}}', '3D Gaussian RI 다중 슬라이스 검증 보고서');
}

function buildReportHtml(markdown) {
  if (!reportStyle) fail('Missing report style in templates/report-template.html');
  if (!blobScript) fail('Missing Blob URL image script in templates/report-template.html');
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
${reportStyle}
  </style>
</head>
<body>
  <header class="hero">
    <p class="kicker">Lukael Research · Encrypted HTML Report</p>
    <h1>3D Gaussian RI 다중 슬라이스 토모그래피 검증</h1>
    <p class="hero-summary">Waller-style multi-slice reference loop와 3D Gaussian RI representation을 한 장의 탐색 가능한 HTML 리포트로 정리했습니다.</p>
    <div class="meta-grid" aria-label="Report metadata">
      <div class="meta-item"><strong>3DGS-RI</strong>Project</div>
      <div class="meta-item"><strong>Multi-slice RI</strong>Scope</div>
      <div class="meta-item"><strong>Dark encrypted HTML</strong>Format</div>
    </div>
  </header>
  <div class="layout">
    <nav class="toc" aria-label="Table of contents"><strong>Contents</strong>${nav}</nav>
    <main class="content">${body}</main>
  </div>
  ${blobScript}
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
