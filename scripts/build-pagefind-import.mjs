import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const siteDir = path.join(process.cwd(), "_site");
const allsitesPath = path.join(siteDir, "allsites.json");
const importDir = path.join(siteDir, "pagefind-import");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rankBoostFromUrl(rawUrl) {
  const url = String(rawUrl || "").toLowerCase();
  if (url.includes("jcrt.org/archives/")) return 700;
  if (url.includes("journal.thenewpolis.com")) return 600;
  if (url.includes("jcrt.org/religioustheory")) return 500;
  if (url.includes("jcrt.org")) return 400;
  if (url.includes("thenewpolis.com")) return 300;
  if (url.includes("esthesis.org")) return 200;
  if (url.includes("thewhitestonefoundation.org")) return 100;
  return 50;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
  return [String(value)];
}

function buildHtml(item) {
  const title = String(item.title || "Untitled");
  const url = String(item.url || "");
  const site = String(item.site || "Unknown");
  const description = String(item.description || item.excerpt || "").trim();
  const categories = toArray(item.categories).join(", ");
  const tags = toArray(item.tags).join(", ");
  const author = String(item.author || "");
  const date = String(item.date || "");
  const boost = Number(item.boost || rankBoostFromUrl(url));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow">
  <meta data-pagefind-meta="title" content="${escapeHtml(title)}">
  <meta data-pagefind-meta="site" content="${escapeHtml(site)}">
  <meta data-pagefind-meta="source_url" content="${escapeHtml(url)}">
  <meta data-pagefind-meta="description" content="${escapeHtml(description)}">
  <meta data-pagefind-meta="author" content="${escapeHtml(author)}">
  <meta data-pagefind-meta="date" content="${escapeHtml(date)}">
  <meta data-pagefind-meta="categories" content="${escapeHtml(categories)}">
  <meta data-pagefind-meta="tags" content="${escapeHtml(tags)}">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main data-pagefind-body data-pagefind-weight="${boost}">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>${escapeHtml(author)}</p>
    <p>${escapeHtml(site)}</p>
    <p>${escapeHtml(categories)}</p>
    <p>${escapeHtml(tags)}</p>
    <p>${escapeHtml(date)}</p>
  </main>
</body>
</html>`;
}

function normalizeItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

async function loadItemsFromChunks(chunks) {
  if (!chunks || chunks.enabled !== true || !Array.isArray(chunks.files)) return [];
  const items = [];
  for (const file of chunks.files) {
    const relative = String(file || "").replace(/^\//, "");
    const filePath = path.join(siteDir, relative);
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    const chunkItems = normalizeItems(json);
    items.push(...chunkItems);
  }
  return items;
}

async function run() {
  const allsitesRaw = await fs.readFile(allsitesPath, "utf8");
  const allsitesJson = JSON.parse(allsitesRaw);
  let items = normalizeItems(allsitesJson);
  if (items.length === 0) {
    items = await loadItemsFromChunks(allsitesJson.chunks);
  }

  items = items.filter((item) => {
    try {
      return Boolean(new URL(String(item.url || "")));
    } catch {
      return false;
    }
  });

  await fs.rm(importDir, { recursive: true, force: true });
  await fs.mkdir(importDir, { recursive: true });

  let written = 0;
  for (const item of items) {
    const token = createHash("sha1").update(`${item.url}|${item.title}|${item.date || ""}`).digest("hex");
    const filePath = path.join(importDir, `${token}.html`);
    const html = buildHtml(item);
    await fs.writeFile(filePath, html, "utf8");
    written += 1;
  }

  console.log(`[pagefind-import] wrote ${written} records`);
}

run().catch((error) => {
  console.error("[pagefind-import] failed", error);
  process.exit(1);
});
