#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CANONICAL_PATH = path.join(ROOT, "_data", "allsitesCanonical.json");
const FILES_SEARCH_SITEMAP_URL = "https://files.jcrt.org/metadata/search-sitemap.xml";
const LOCAL_FILES_SEARCH_SITEMAP_PATH = path.resolve(
  ROOT,
  "..",
  "jcrt-files",
  "metadata",
  "search-sitemap.xml"
);

function normalizeItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function extractJsonLocsFromSitemap(xmlText) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/gim;
  let match = re.exec(xmlText);
  while (match) {
    const candidate = String(match[1] || "").trim();
    if (candidate.toLowerCase().endsWith(".json")) {
      locs.push(candidate);
    }
    match = re.exec(xmlText);
  }
  return [...new Set(locs)];
}

async function fetchJson(url) {
  const localPath = localMirrorPathForFilesUrl(url);
  if (localPath) {
    const rawLocal = await fs.readFile(localPath, "utf8");
    return parseJsonLenient(rawLocal, localPath);
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const raw = await res.text();
  return parseJsonLenient(raw, url);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: "application/xml,text/xml,text/plain" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function resolveSourceUrls(source) {
  const src = String(source || "").trim();
  if (!src) return [];
  if (src.toLowerCase().endsWith(".xml")) {
    let xml = "";
    try {
      xml = await fetchText(src);
    } catch (error) {
      if (src === FILES_SEARCH_SITEMAP_URL) {
        xml = await fs.readFile(LOCAL_FILES_SEARCH_SITEMAP_PATH, "utf8");
      } else {
        throw error;
      }
    }
    return extractJsonLocsFromSitemap(xml);
  }
  if (src.toLowerCase().endsWith(".json")) return [src];
  return [];
}

function parseJsonLenient(raw, sourceUrl) {
  const text = String(raw || "");
  try {
    return JSON.parse(text);
  } catch (firstError) {
    const withoutTrailingCommas = text.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(withoutTrailingCommas);
    } catch (secondError) {
      throw new Error(`invalid JSON from ${sourceUrl}: ${secondError.message}`);
    }
  }
}

function localMirrorPathForFilesUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "files.jcrt.org") return "";
    const pathname = parsed.pathname.replace(/^\/+/, "");
    if (!pathname.startsWith("metadata/")) return "";
    return path.resolve(ROOT, "..", "jcrt-files", pathname);
  } catch {
    return "";
  }
}

function normalizeItem(item, sourceUrl) {
  const url = String(item?.url || "").trim();
  if (!url) return null;
  const sourceHost = (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return "";
    }
  })();
  return {
    title: String(item?.title || "Untitled").trim(),
    url,
    description: String(item?.description || item?.excerpt || "").trim(),
    author: String(item?.author || "").trim(),
    categories: Array.isArray(item?.categories) ? item.categories : [],
    tags: Array.isArray(item?.tags) ? item.tags : [],
    date: String(item?.date || "").trim(),
    site: String(item?.site || sourceHost || "Unknown").trim(),
  };
}

async function main() {
  const canonical = JSON.parse(await fs.readFile(CANONICAL_PATH, "utf8"));
  const sources = Array.isArray(canonical.sources) ? canonical.sources : [];

  const sourceToJsonUrls = new Map();
  for (const source of sources) {
    try {
      const jsonUrls = await resolveSourceUrls(source);
      sourceToJsonUrls.set(source, jsonUrls);
    } catch (error) {
      console.error(`[metasearch] failed to resolve source ${source}: ${error.message}`);
      sourceToJsonUrls.set(source, []);
    }
  }

  const rawItems = [];
  for (const [source, jsonUrls] of sourceToJsonUrls.entries()) {
    for (const jsonUrl of jsonUrls) {
      try {
        const payload = await fetchJson(jsonUrl);
        for (const item of normalizeItems(payload)) {
          rawItems.push({ item, source: jsonUrl });
        }
      } catch (error) {
        console.error(`[metasearch] failed to ingest ${jsonUrl}: ${error.message}`);
      }
    }
  }

  const deduped = new Map();
  for (const row of rawItems) {
    const normalized = normalizeItem(row.item, row.source);
    if (!normalized) continue;
    const key = `${normalized.url}|${normalized.title}`;
    if (!deduped.has(key)) deduped.set(key, normalized);
  }

  const items = [...deduped.values()];
  items.sort((a, b) => {
    const ad = Date.parse(a.date || "");
    const bd = Date.parse(b.date || "");
    const aValid = Number.isFinite(ad);
    const bValid = Number.isFinite(bd);
    if (aValid && bValid) return bd - ad;
    if (aValid) return -1;
    if (bValid) return 1;
    return a.title.localeCompare(b.title);
  });

  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    sources,
    raw_total_items: rawItems.length,
    total_items: items.length,
    items,
    latest_items: items,
  };

  await fs.writeFile(CANONICAL_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`[metasearch] sources=${sources.length} raw=${rawItems.length} total=${items.length}`);
}

main().catch((error) => {
  console.error("[metasearch] failed", error);
  process.exit(1);
});
