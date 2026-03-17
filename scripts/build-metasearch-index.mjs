#!/usr/bin/env node
/**
 * Build the metasearch index from pre-ingested _data/allsitesCanonical.json.
 *
 * The GitHub Action (ingest-allsites.yml) fetches all source endpoints on a
 * weekly schedule and commits the canonical JSON to the repo. This script
 * reads that file at build time so the Eleventy/Netlify build never needs to
 * make live HTTP requests to external sources (which are blocked by WAFs).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  OUTPUT_SEARCH,
  SEARCH_VERSION,
  SOURCES,
} from "./metasearch.config.mjs";
import {
  canonicalizeUrl,
  normalizeWhitespace,
  parseDateSafe,
  rankBoostFromUrl,
  siteFromUrl,
  stableSha1,
  stripHtml,
  uniqueStrings,
} from "./lib/metasearch-utils.mjs";

const CANONICAL_PATH = path.join(process.cwd(), "_data", "allsitesCanonical.json");

function buildSearchText(parts) {
  return normalizeWhitespace(parts.filter(Boolean).join("\n"));
}

function normalizeItem(item) {
  const url = canonicalizeUrl(item?.url || item?.source_url || item?.canonical_url);
  if (!url) return null;

  const title = normalizeWhitespace(item?.title || item?.name || "Untitled");
  const author = uniqueStrings(item?.author || item?.authors).join(", ");
  const categories = uniqueStrings(item?.categories || item?.category);
  const tags = uniqueStrings(item?.tags || item?.tag);
  const description = stripHtml(item?.description || item?.excerpt || item?.low_priority_excerpt || "");
  const excerpt = stripHtml(item?.excerpt || item?.low_priority_excerpt || item?.description || "");
  const site = normalizeWhitespace(item?.site || siteFromUrl(url));
  const date = parseDateSafe(item?.date || item?.published || item?.published_at || item?.updated_at);
  const boost = rankBoostFromUrl(url);
  const search_text = buildSearchText([
    title,
    site,
    author,
    categories.join(" "),
    tags.join(" "),
    description,
    excerpt,
  ]);

  return {
    id: stableSha1(url),
    site,
    source: url,
    url,
    title,
    author,
    date,
    description,
    excerpt,
    categories,
    tags,
    boost,
    search_text,
  };
}

function compareByDateDesc(left, right) {
  const leftTime = left.date ? Date.parse(left.date) : Number.NaN;
  const rightTime = right.date ? Date.parse(right.date) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }
  return String(left.title || "").localeCompare(String(right.title || ""));
}

function pickBetterItem(currentItem, nextItem) {
  const currentLength = currentItem.search_text.length;
  const nextLength = nextItem.search_text.length;
  if (nextLength !== currentLength) {
    return nextLength > currentLength ? nextItem : currentItem;
  }

  const currentDate = currentItem.date ? Date.parse(currentItem.date) : Number.NaN;
  const nextDate = nextItem.date ? Date.parse(nextItem.date) : Number.NaN;
  const currentValid = Number.isFinite(currentDate);
  const nextValid = Number.isFinite(nextDate);

  if (currentValid !== nextValid) {
    return nextValid ? nextItem : currentItem;
  }
  if (currentValid && nextValid && nextDate !== currentDate) {
    return nextDate > currentDate ? nextItem : currentItem;
  }

  return nextItem.boost > currentItem.boost ? nextItem : currentItem;
}

async function writeOutput(payload) {
  const outputPath = path.join(process.cwd(), OUTPUT_SEARCH);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const raw = await fs.readFile(CANONICAL_PATH, "utf8");
  const canonical = JSON.parse(raw);
  const rawItems = canonical.items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error(`No items found in ${CANONICAL_PATH}`);
  }

  console.log(`[metasearch-index] read ${rawItems.length} items from allsitesCanonical.json (ingested ${canonical.updated_at || "unknown"})`);

  const deduped = new Map();
  for (const item of rawItems) {
    const normalized = normalizeItem(item);
    if (!normalized) continue;
    const existing = deduped.get(normalized.url);
    deduped.set(normalized.url, existing ? pickBetterItem(existing, normalized) : normalized);
  }

  const items = [...deduped.values()].sort(compareByDateDesc);
  const payload = {
    version: SEARCH_VERSION,
    updated_at: new Date().toISOString(),
    sources: SOURCES,
    source_item_counts: canonical.sources
      ? Object.fromEntries(canonical.sources.map((s) => [s, "pre-ingested"]))
      : {},
    raw_total_items: rawItems.length,
    total_items: items.length,
    items,
    latest_items: items.slice(0, 50),
  };

  await writeOutput(payload);
  console.log(`[metasearch-index] raw=${rawItems.length} deduped=${items.length}`);
}

main().catch((error) => {
  console.error("[metasearch-index] failed", error);
  process.exit(1);
});
