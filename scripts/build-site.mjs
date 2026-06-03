// Builds the docs/ site served at standard-tool.js.org (GitHub Pages).
// Renders README.md, OVERVIEW.md, and EXAMPLES.md to HTML via GitHub's GFM markdown API,
// then wraps them in a dark monospace theme. Re-run after editing the docs:
//   GH_TOKEN=$(gh auth token) node scripts/build-site.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

async function render(md) {
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text: md, mode: 'gfm', context: 'finom/standard-tool' }),
  });
  if (!res.ok) throw new Error(`GitHub markdown API ${res.status}: ${await res.text()}`);
  // Align heading ids with their in-page #anchor links (GitHub prefixes ids with user-content-).
  return rewriteDocLinks(addHeadingIds((await res.text()).replaceAll('user-content-', '')));
}

// The raw markdown API does not emit heading ids, so in-page #anchor links would be dead.
// Re-add them with the same slug algorithm GitHub uses (github-slugger).
const SLUG_STRIP = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g;
const slug = (s) => s.toLowerCase().trim().replace(SLUG_STRIP, '').replace(/ /g, '-');

function addHeadingIds(html) {
  const seen = new Map();
  return html.replace(/<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag, attrs, inner) => {
    if (/\sid=/.test(attrs)) return whole;
    let id = slug(inner.replace(/<[^>]+>/g, ''));
    if (!id) return whole;
    if (seen.has(id)) {
      const n = seen.get(id) + 1;
      seen.set(id, n);
      id = `${id}-${n}`;
    } else {
      seen.set(id, 0);
    }
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });
}

// Cross-doc links are written as .md (so they work on GitHub); map them onto the built site's page names.
function rewriteDocLinks(html) {
  return html
    .replace(/href="\.\/README\.md(#[^"]*)?"/g, 'href="./$1"')
    .replace(/href="\.\/OVERVIEW\.md(#[^"]*)?"/g, 'href="./overview.html$1"')
    .replace(/href="\.\/EXAMPLES\.md(#[^"]*)?"/g, 'href="./examples.html$1"');
}

const CSS = `:root{--bg:#09090b;--bg-deep:#030712;--fg:#fafafa;--muted:#a1a1aa;--border:#6b7280;--line:#27272a;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
*{box-sizing:border-box}
html{background:var(--bg-deep)}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--mono);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:768px;margin:0 auto;padding:28px 20px 80px}
a{color:var(--fg)}
header.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
.brand{font-size:15px;text-decoration:none;opacity:.9}
.brand:hover{opacity:1}
.nav-links{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;border:2px solid var(--border);border-radius:6px;padding:5px 11px;color:var(--fg);text-decoration:none;font-size:13px;line-height:1}
.btn:hover{background:rgba(255,255,255,.06)}
.card{display:flex;align-items:center;justify-content:space-between;gap:16px;border:2px solid var(--border);border-radius:4px;padding:16px 20px;color:var(--fg);text-decoration:none;margin:40px 0 0}
.card:hover{background:rgba(255,255,255,.045)}
.card h3{margin:0 0 4px;font-size:18px;font-weight:600}
.card p{margin:0;font-size:13px;color:var(--muted)}
.card .arrow{font-size:20px;opacity:.8}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:flex;gap:18px;flex-wrap:wrap;align-items:center}
footer a{color:var(--muted)}
footer a:hover{color:var(--fg)}
.md{margin-top:16px}
.md>*:first-child{margin-top:0}
.md h1,.md h2,.md h3,.md h4{font-weight:600;line-height:1.25}
.md h1{font-size:30px;margin:0 0 10px}
.md h2{font-size:21px;margin:40px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.md h3{font-size:17px;margin:28px 0 10px}
.md h4{font-size:15px;margin:24px 0 8px}
.md p,.md li{font-size:14px;line-height:1.7}
.md ul,.md ol{padding-left:22px}
.md li{margin:4px 0}
.md a{color:var(--fg);text-decoration:underline;text-underline-offset:2px}
.md strong{font-weight:600}
.md img{max-width:100%;vertical-align:middle}
.md hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.md code{font-family:var(--mono);font-size:13px}
.md :not(pre)>code{background:rgba(255,255,255,.08);padding:1.5px 5px;border-radius:4px}
.md h1 code,.md h2 code,.md h3 code,.md h4 code{font-size:1em}
.md pre{background:var(--bg);border:2px solid var(--border);border-radius:4px;padding:12px 16px;overflow-x:auto;font-size:13px;line-height:1.55;margin:16px 0}
.md pre code{background:none;padding:0;white-space:pre;color:#e6edf3}
.md blockquote{margin:16px 0;padding:2px 16px;border-left:3px solid var(--border);color:var(--muted)}
.md blockquote p{margin:8px 0}
.md table{border-collapse:collapse;font-size:13px;display:block;width:max-content;max-width:100%;overflow-x:auto;margin:16px 0}
.md th,.md td{border:1px solid var(--line);padding:6px 11px;text-align:left;vertical-align:top}
.md th{font-weight:600}
.md svg.octicon{display:none}
.md .anchor{text-decoration:none}
.md .pl-c{color:#8b949e}
.md .pl-c1{color:#79c0ff}
.md .pl-en{color:#d2a8ff}
.md .pl-smi{color:#c9d1d9}
.md .pl-ent{color:#7ee787}
.md .pl-k{color:#ff7b72}
.md .pl-s,.md .pl-pds{color:#a5d6ff}
.md .pl-v{color:#ffa657}`;

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%2309090b'/><text x='8' y='12' font-size='10' text-anchor='middle' fill='%23fafafa' font-family='monospace'>%7B%7D</text></svg>";

function page({ title, description, nav, bodyHtml, cta }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="nav">
<a class="brand" href="./">StandardTool</a>
<nav class="nav-links">${nav}</nav>
</header>
<main class="md">
${bodyHtml}
</main>
${cta}
<footer>
<a href="https://github.com/finom/standard-tool">GitHub</a>
<a href="https://www.npmjs.com/package/standard-tool">npm</a>
<a href="./overview.html">Overview</a>
<a href="./examples.html">Examples</a>
<span>hosted on js.org</span>
</footer>
</div>
</body>
</html>
`;
}

const gh = `<a class="btn" href="https://github.com/finom/standard-tool">GitHub</a>`;
const npm = `<a class="btn" href="https://www.npmjs.com/package/standard-tool">npm</a>`;
const overviewBtn = `<a class="btn" href="./overview.html">Overview</a>`;
const examplesBtn = `<a class="btn" href="./examples.html">Examples</a>`;
const homeBtn = `<a class="btn" href="./">README</a>`;
const overviewCard = `<a class="card" href="./overview.html"><div><h3>Overview</h3><p>Why StandardTool exists, and the landscape it fits into.</p></div><span class="arrow">&rarr;</span></a>`;
const examplesCard = `<a class="card" href="./examples.html"><div><h3>Examples</h3><p>Wire one tool into OpenAI, Anthropic, the AI SDK, and MCP.</p></div><span class="arrow">&rarr;</span></a>`;
const homeCard = `<a class="card" href="./"><div><h3>Get started</h3><p>Install, the type, and the reference implementation.</p></div><span class="arrow">&rarr;</span></a>`;

const readmeMd = readFileSync(join(root, 'README.md'), 'utf8');
const overviewMd = readFileSync(join(root, 'OVERVIEW.md'), 'utf8');
const examplesMd = readFileSync(join(root, 'EXAMPLES.md'), 'utf8');
const [readmeHtml, overviewHtml, examplesHtml] = await Promise.all([
  render(readmeMd),
  render(overviewMd),
  render(examplesMd),
]);

writeFileSync(
  join(docs, 'index.html'),
  page({
    title: 'StandardTool',
    description: 'A common type for defining LLM tools, built on Standard Schema and Standard JSON Schema.',
    nav: overviewBtn + examplesBtn + gh + npm,
    bodyHtml: readmeHtml,
    cta: overviewCard + examplesCard,
  })
);
writeFileSync(
  join(docs, 'overview.html'),
  page({
    title: 'Overview · StandardTool',
    description: 'Why StandardTool exists: the landscape, the diagnosis, and the case for a neutral tool type.',
    nav: homeBtn + examplesBtn + gh + npm,
    bodyHtml: overviewHtml,
    cta: examplesCard + homeCard,
  })
);
writeFileSync(
  join(docs, 'examples.html'),
  page({
    title: 'Examples · StandardTool',
    description: 'Wiring a StandardTool into OpenAI, Anthropic, the Vercel AI SDK, and MCP.',
    nav: homeBtn + overviewBtn + gh + npm,
    bodyHtml: examplesHtml,
    cta: overviewCard + homeCard,
  })
);
writeFileSync(join(docs, 'CNAME'), 'standard-tool.js.org\n');
writeFileSync(join(docs, '.nojekyll'), '');
console.log('Built: docs/index.html, docs/overview.html, docs/examples.html, docs/CNAME, docs/.nojekyll');
