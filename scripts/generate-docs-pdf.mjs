#!/usr/bin/env node
/**
 * Build PDFs from README.md and COMPARISON.md using marked + Chrome headless.
 * Usage: node scripts/generate-docs-pdf.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const require = createRequire(import.meta.url);

function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Chrome/Chromium not found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.');
}

const CSS = `
  @page { margin: 18mm 16mm; size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }
  h1 {
    font-size: 22pt;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 0.35em;
    margin-top: 0;
    page-break-after: avoid;
  }
  h2 {
    font-size: 14pt;
    color: #1e40af;
    margin-top: 1.4em;
    border-bottom: 1px solid #dbeafe;
    padding-bottom: 0.2em;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt;
    color: #334155;
    margin-top: 1.1em;
    page-break-after: avoid;
  }
  p, li { orphans: 3; widows: 3; }
  a { color: #2563eb; text-decoration: none; }
  code {
    font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    background: #f1f5f9;
    padding: 0.12em 0.35em;
    border-radius: 3px;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 0.85em 1em;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.45;
    page-break-inside: avoid;
  }
  pre code {
    background: none;
    padding: 0;
    color: inherit;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0 1.2em;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 0.4em 0.55em;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #eff6ff;
    font-weight: 600;
    color: #1e3a8a;
  }
  tr:nth-child(even) td { background: #f8fafc; }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 1.5em 0;
  }
  ul, ol { padding-left: 1.4em; }
  li { margin: 0.25em 0; }
  .doc-section {
    page-break-before: always;
  }
  .doc-section:first-child {
    page-break-before: auto;
  }
  .cover {
    text-align: center;
    padding: 3em 1em 2em;
    page-break-after: always;
  }
  .cover h1 {
    border: none;
    font-size: 28pt;
    margin-bottom: 0.2em;
  }
  .cover p {
    color: #64748b;
    font-size: 12pt;
  }
  .toc {
    page-break-after: always;
    margin-bottom: 2em;
  }
  .toc h2 { border: none; }
  .toc ul { list-style: none; padding-left: 0; }
  .toc li { margin: 0.5em 0; font-size: 11pt; }
  .footer-note {
    margin-top: 2em;
    padding-top: 0.8em;
    border-top: 1px solid #e2e8f0;
    font-size: 8.5pt;
    color: #64748b;
    text-align: center;
  }
`;

function loadMarked() {
  try {
    return require('marked');
  } catch {
    execFileSync('npm', ['install', '--no-save', 'marked@12'], { cwd: root, stdio: 'inherit' });
    return require('marked');
  }
}

function mdToHtml(marked, md) {
  marked.setOptions({ gfm: true, breaks: false });
  return marked.parse(md);
}

function wrapHtml(title, bodyHtml, { sectionClass = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="${sectionClass}">${bodyHtml}</div>
</body>
</html>`;
}

function htmlToPdf(chrome, htmlPath, pdfPath) {
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
      `file://${htmlPath}`,
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`Chrome failed to generate ${pdfPath}`);
  }
}

function main() {
  fs.mkdirSync(docsDir, { recursive: true });

  const marked = loadMarked();
  const chrome = findChrome();
  const date = new Date().toISOString().slice(0, 10);

  const files = [
    { md: 'README.md', title: 'Warden — Internal Process Manager', pdf: 'Warden-README.pdf' },
    { md: 'COMPARISON.md', title: 'PM2 vs Warden — Comparison', pdf: 'PM2-vs-Warden-Comparison.pdf' },
  ];

  const sections = [];

  sections.push(`
    <div class="cover">
      <h1>Warden Documentation</h1>
      <p>Process Manager · README &amp; PM2 Comparison</p>
      <p>Generated ${date}</p>
    </div>
    <div class="toc">
      <h2>Contents</h2>
      <ul>
        <li>1. Warden — Internal Process Manager (README)</li>
        <li>2. PM2 vs Warden — Side-by-Side Comparison</li>
      </ul>
    </div>
  `);

  for (let i = 0; i < files.length; i++) {
    const { md, title } = files[i];
    const mdPath = path.join(root, md);
    const content = fs.readFileSync(mdPath, 'utf8');
    const html = mdToHtml(marked, content);
    sections.push(`<div class="doc-section">${html}</div>`);

    // Individual PDF
    const singleHtml = wrapHtml(title, html);
    const singleHtmlPath = path.join(docsDir, `${path.basename(md, '.md')}.html`);
    const singlePdfPath = path.join(docsDir, files[i].pdf);
    fs.writeFileSync(singleHtmlPath, singleHtml);
    htmlToPdf(chrome, singleHtmlPath, singlePdfPath);
    console.log(`Created ${singlePdfPath}`);
  }

  sections.push(`
    <div class="footer-note">
      Warden · MIT License · github.com/RoshanGamage01/warden
    </div>
  `);

  const combinedHtml = wrapHtml('Warden Documentation', sections.join('\n'));
  const combinedHtmlPath = path.join(docsDir, 'warden-docs.html');
  const combinedPdfPath = path.join(docsDir, 'Warden-Documentation.pdf');
  fs.writeFileSync(combinedHtmlPath, combinedHtml);
  htmlToPdf(chrome, combinedHtmlPath, combinedPdfPath);
  console.log(`Created ${combinedPdfPath}`);
}

main();
