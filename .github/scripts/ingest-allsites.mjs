import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
const rootDir = process.cwd();
const canonicalPath = path.join(rootDir, "_data", "allsitesCanonical.json");
const chunksMetaPath = path.join(rootDir, "_data", "allsitesChunks.json");
const chunkDir = path.join(rootDir, "public", "metadata", "allsites-chunks");

const sources = [
  {
    site: "JCRT",
    endpoint: "https://jcrt.org/metadata/search.json",
  },
  {
    site: "The New Polis Journal",
    endpoint: "https://journal.thenewpolis.com/metadata/search.json",
  },
  {
    site: "The New Polis",
    endpoint: "https://thenewpolis.com/metadata/search.json",
  },
  {
    site: "Esthesis",
    endpoint: "https://esthesis.org/metadata/search.json",
  },
  {
    site: "The Whitestone Foundation",
    endpoint: "https://thewhitestonefoundation.org/metadata/search.json",
  },
];

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

function sha1(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function toStringSafe(value) {
  if (value == null) return "";
  return String(value).trim();
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => toStringSafe(v)).filter(Boolean);
  return [toStringSafe(value)].filter(Boolean);
}

function normalizeUrl(candidate) {
  const value = toStringSafe(candidate);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeRecord(item, source, fetchedAt) {
  const date = toStringSafe(item.date || item.published || item.published_at || item.created || item.created_at);
  const url = normalizeUrl(item.url || item.link || item.permalink || "");
  const title = toStringSafe(item.title || item.name || item.page || "");
  const id = toStringSafe(item.id || item.uuid || item.slug || "");
  const author = Array.isArray(item.author)
    ? item.author.map((v) => toStringSafe(v)).filter(Boolean).join(", ")
    : toStringSafe(item.author || item.creator || "");
  const description = toStringSafe(
    item.description || item.excerpt || item.low_priority_excerpt || item.summary || item.content || ""
  );
  const categories = toArray(item.categories);
  const tags = toArray(item.tags);
  const site = toStringSafe(item.site || source.site);

  const keyParts = [date.toLowerCase(), url.toLowerCase(), id.toLowerCase(), title.toLowerCase()];
  const baseKey = keyParts.join("||");
  const dedupeKey = baseKey.replace(/\|/g, "").trim() ? baseKey : `${url.toLowerCase()}||${title.toLowerCase()}||${sha1(JSON.stringify(item))}`;

  return {
    dedupe_key: dedupeKey,
    id: id || sha1(`${url}|${title}|${date}`),
    site,
    source_endpoint: source.endpoint,
    title,
    url,
    date,
    author,
    description,
    categories,
    tags,
    boost: rankBoostFromUrl(url),
    fetched_at: fetchedAt,
  };
}

function parseItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(source.endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    return parseItems(json);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCanonical() {
  try {
    const contents = await fs.readFile(canonicalPath, "utf8");
    const parsed = JSON.parse(contents);
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("Invalid canonical file format");
    }
    return parsed;
  } catch {
    return {
      version: 1,
      updated_at: null,
      sources: sources.map((source) => source.endpoint),
      items: [],
      latest_items: [],
    };
  }
}

function getDateValue(record) {
  const value = toStringSafe(record?.date);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildLatestItems(records) {
  const byUrl = new Map();
  for (const record of records) {
    const key = toStringSafe(record.url).toLowerCase() || toStringSafe(record.dedupe_key).toLowerCase();
    if (!key) continue;
    if (!byUrl.has(key)) {
      byUrl.set(key, record);
      continue;
    }
    const current = byUrl.get(key);
    const currentBoost = Number(current.boost || 0);
    const nextBoost = Number(record.boost || 0);
    if (nextBoost > currentBoost) {
      byUrl.set(key, record);
      continue;
    }
    if (nextBoost === currentBoost && getDateValue(record) > getDateValue(current)) {
      byUrl.set(key, record);
    }
  }

  return Array.from(byUrl.values()).sort((a, b) => {
    const boostDelta = Number(b.boost || 0) - Number(a.boost || 0);
    if (boostDelta !== 0) return boostDelta;
    return getDateValue(b) - getDateValue(a);
  });
}

function toPrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, toPrettyJson(value), "utf8");
}

async function writeChunkFiles(items) {
  const payloadBytes = Buffer.byteLength(JSON.stringify({ items }), "utf8");
  if (payloadBytes <= MAX_CHUNK_BYTES) {
    await writeJson(chunksMetaPath, {
      enabled: false,
      maxChunkBytes: MAX_CHUNK_BYTES,
      count: 0,
      total_items: items.length,
      files: [],
    });
    return;
  }

  await fs.rm(chunkDir, { recursive: true, force: true });
  await fs.mkdir(chunkDir, { recursive: true });

  const files = [];
  let chunk = [];
  let chunkBytes = 0;
  let chunkIndex = 1;

  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (chunk.length > 0 && chunkBytes + itemBytes > MAX_CHUNK_BYTES) {
      const fileName = `allsites-${String(chunkIndex).padStart(4, "0")}.json`;
      await writeJson(path.join(chunkDir, fileName), { items: chunk });
      files.push(`/metadata/allsites-chunks/${fileName}`);
      chunkIndex += 1;
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(item);
    chunkBytes += itemBytes;
  }

  if (chunk.length > 0) {
    const fileName = `allsites-${String(chunkIndex).padStart(4, "0")}.json`;
    await writeJson(path.join(chunkDir, fileName), { items: chunk });
    files.push(`/metadata/allsites-chunks/${fileName}`);
  }

  await writeJson(chunksMetaPath, {
    enabled: true,
    maxChunkBytes: MAX_CHUNK_BYTES,
    count: files.length,
    total_items: items.length,
    files,
  });
}

async function run() {
  const fetchedAt = new Date().toISOString();
  const canonical = await loadCanonical();
  const existing = Array.isArray(canonical.items) ? canonical.items : [];
  const existingKeys = new Set(existing.map((record) => toStringSafe(record.dedupe_key)).filter(Boolean));

  let addedCount = 0;
  for (const source of sources) {
    try {
      const rawItems = await fetchSource(source);
      for (const item of rawItems) {
        const normalized = normalizeRecord(item, source, fetchedAt);
        if (!normalized.url || !normalized.title) continue;
        if (existingKeys.has(normalized.dedupe_key)) continue;
        existing.push(normalized);
        existingKeys.add(normalized.dedupe_key);
        addedCount += 1;
      }
      console.log(`[ingest] ${source.site}: fetched ${rawItems.length} items`);
    } catch (error) {
      console.warn(`[ingest] ${source.site}: ${error?.message || "fetch failed"}`);
    }
  }

  if (addedCount === 0) {
    console.log("[ingest] no new records; canonical files unchanged");
    return;
  }

  const latestItems = buildLatestItems(existing);

  const nextCanonical = {
    version: 1,
    updated_at: fetchedAt,
    sources: sources.map((source) => source.endpoint),
    raw_total_items: existing.length,
    total_items: latestItems.length,
    items: existing,
    latest_items: latestItems,
  };

  await writeJson(canonicalPath, nextCanonical);
  await writeChunkFiles(latestItems);

  console.log(`[ingest] appended ${addedCount} new records`);
  console.log(`[ingest] total raw records: ${existing.length}`);
  console.log(`[ingest] total deduplicated records: ${latestItems.length}`);
}

run().catch((error) => {
  console.error("[ingest] failed", error);
  process.exit(1);
});
