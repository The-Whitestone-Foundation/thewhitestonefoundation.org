#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  FETCH_TIMEOUT_MS,
  OUTPUT_SEARCH,
  SEARCH_VERSION,
  SOURCES,
} from "./metasearch.config.mjs";
import {
  canonicalizeUrl,
  ensureArrayPayload,
  normalizeWhitespace,
  parseDateSafe,
  rankBoostFromUrl,
  safeFetchJson,
  siteFromUrl,
  stableSha1,
  stripHtml,
  toArray,
  uniqueStrings,
} from "./lib/metasearch-utils.mjs";

function buildSearchText(parts) {
  return normalizeWhitespace(parts.filter(Boolean).join("\n"));
}

function normalizeItem(item, source) {
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
    source,
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
  const responses = await Promise.all(
    SOURCES.map(async (source) => ({
      source,
      result: await safeFetchJson(source, FETCH_TIMEOUT_MS),
    }))
  );

  const successful = responses.filter(({ result }) => result.ok && result.data);
  const failed = responses.filter(({ result }) => !result.ok || !result.data);
  if (successful.length === 0) {
    throw new Error("No metasearch sources were available");
  }

  if (failed.length > 0) {
    for (const row of failed) {
      console.error(`[metasearch-index] source failed: ${row.source} :: ${row.result.error || "unknown error"}`);
    }
    throw new Error(`Metasearch source fetch incomplete (${successful.length}/${SOURCES.length}). Refusing to publish partial index.`);
  }

  const rawItems = [];
  const source_item_counts = {};
  for (const { source, result } of successful) {
    const sourceItems = ensureArrayPayload(result.data);
    source_item_counts[source] = sourceItems.length;
    for (const item of sourceItems) {
      rawItems.push({ item, source });
    }
  }

  const deduped = new Map();
  for (const row of rawItems) {
    const normalized = normalizeItem(row.item, row.source);
    if (!normalized) continue;
    const existing = deduped.get(normalized.url);
    deduped.set(normalized.url, existing ? pickBetterItem(existing, normalized) : normalized);
  }

  const items = [...deduped.values()].sort(compareByDateDesc);
  const payload = {
    version: SEARCH_VERSION,
    updated_at: new Date().toISOString(),
    sources: SOURCES,
    source_item_counts,
    raw_total_items: rawItems.length,
    total_items: items.length,
    items,
    latest_items: items.slice(0, 50),
  };

  await writeOutput(payload);
  console.log(`[metasearch-index] sources=${successful.length}/${SOURCES.length} raw=${rawItems.length} total=${items.length}`);
}

main().catch((error) => {
  console.error("[metasearch-index] failed", error);
  process.exit(1);
});
