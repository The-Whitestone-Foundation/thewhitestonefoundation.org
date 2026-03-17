#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";
import { split, SentenceSplitterSyntax } from "sentence-splitter";
import {
  CHUNK,
  DIMENSION,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_PRECISION,
  LITE_DIMENSION,
  LITE_MAX_CHUNKS_PER_DOC,
  MIN_TEXT_LENGTH,
  MODEL,
  OUTPUT_SEARCH,
  OUTPUT_VECTORS,
  OUTPUT_VECTORS_LITE,
  SNIPPET_LENGTH,
  VECTORS_VERSION,
} from "./metasearch.config.mjs";
import {
  normalizeWhitespace,
  roundEmbedding,
  stableSha1,
  truncateText,
} from "./lib/metasearch-utils.mjs";

const CACHE_DIR = path.join(process.cwd(), ".cache", "transformers");

env.cacheDir = CACHE_DIR;
env.allowRemoteModels = true;
env.allowLocalModels = true;

function sentenceNodeToText(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => sentenceNodeToText(child)).join("");
}

function splitIntoSentenceTexts(text) {
  const nodes = split(text);
  const sentences = nodes
    .filter((node) => node.type === SentenceSplitterSyntax.Sentence)
    .map((node) => normalizeWhitespace(sentenceNodeToText(node)))
    .filter(Boolean);

  if (sentences.length > 0) return sentences;

  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function chunkSentences(sentences) {
  const chunks = [];
  let startIndex = 0;

  while (startIndex < sentences.length && chunks.length < CHUNK.max_per_doc) {
    let endIndex = startIndex;
    let chunkText = "";

    while (endIndex < sentences.length) {
      const candidate = normalizeWhitespace(`${chunkText} ${sentences[endIndex]}`);
      chunkText = candidate;
      endIndex += 1;
      if (candidate.length >= CHUNK.target_chars) break;
    }

    if (!chunkText) break;
    chunks.push(chunkText);

    if (endIndex >= sentences.length) break;

    let overlapChars = 0;
    let overlapCount = 0;
    for (let cursor = endIndex - 1; cursor >= startIndex; cursor -= 1) {
      overlapChars += sentences[cursor].length;
      overlapCount += 1;
      if (overlapChars >= CHUNK.overlap_chars) break;
    }

    const nextStart = Math.max(startIndex + 1, endIndex - overlapCount);
    if (nextStart <= startIndex) {
      startIndex = endIndex;
    } else {
      startIndex = nextStart;
    }
  }

  return chunks;
}

function buildChunkPrefix(item, index) {
  const title = item.title || "Untitled";
  if (index > 0) {
    return `Title: ${title}`;
  }

  const parts = [
    `Title: ${title}`,
    `Site: ${item.site || "Unknown"}`,
    `Author: ${item.author || "Unknown"}`,
    `Date: ${item.date || "Unknown"}`,
    `Categories: ${(item.categories || []).join(", ") || "None"}`,
    `Tags: ${(item.tags || []).join(", ") || "None"}`,
  ];

  return parts.join("\n");
}

function chunkDocument(item) {
  const rawText = normalizeWhitespace(item.search_text || "");
  if (!rawText) return [];

  const rawChunks = rawText.length < MIN_TEXT_LENGTH
    ? [rawText]
    : chunkSentences(splitIntoSentenceTexts(rawText));

  return rawChunks.slice(0, CHUNK.max_per_doc).map((chunkText, index) => {
    const prefix = buildChunkPrefix(item, index);
    return {
      id: stableSha1(`${item.id}:${index}`),
      doc_id: item.id,
      chunk_index: index,
      site: item.site,
      source: item.source,
      url: item.url,
      title: item.title,
      author: item.author,
      date: item.date,
      categories: item.categories || [],
      tags: item.tags || [],
      boost: item.boost,
      snippet: truncateText(chunkText, SNIPPET_LENGTH),
      chunk_text: `${prefix}\n\n${chunkText}`,
    };
  });
}

function tensorToVectors(tensor, batchSize) {
  if (tensor && typeof tensor.tolist === "function") {
    const rows = tensor.tolist();
    return Array.isArray(rows[0]) ? rows : [rows];
  }

  const flat = Array.from(tensor?.data || []);
  if (!Array.isArray(tensor?.dims) || tensor.dims.length === 0) {
    return flat.length ? [flat] : [];
  }

  if (tensor.dims.length === 1) {
    return [flat];
  }

  const width = tensor.dims[tensor.dims.length - 1] || DIMENSION;
  const rows = [];
  for (let index = 0; index < flat.length; index += width) {
    rows.push(flat.slice(index, index + width));
  }
  return rows.slice(0, batchSize);
}

async function embedChunks(chunks) {
  const extractor = await pipeline("feature-extraction", MODEL);
  const embedded = [];

  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const tensor = await extractor(
      batch.map((chunk) => chunk.chunk_text),
      { pooling: "mean", normalize: true }
    );
    const vectors = tensorToVectors(tensor, batch.length);

    for (let rowIndex = 0; rowIndex < batch.length; rowIndex += 1) {
      const chunk = batch[rowIndex];
      const vector = vectors[rowIndex] || [];
      embedded.push({
        id: chunk.id,
        doc_id: chunk.doc_id,
        chunk_index: chunk.chunk_index,
        site: chunk.site,
        source: chunk.source,
        url: chunk.url,
        title: chunk.title,
        author: chunk.author,
        date: chunk.date,
        categories: chunk.categories,
        tags: chunk.tags,
        boost: chunk.boost,
        snippet: chunk.snippet,
        embedding: roundEmbedding(vector, EMBEDDING_PRECISION),
      });
    }

    console.log(`[semantic-vectors] embedded ${Math.min(index + batch.length, chunks.length)}/${chunks.length}`);
  }

  return embedded;
}

function buildLiteChunks(embeddedChunks) {
  const byDoc = new Map();
  for (const chunk of embeddedChunks) {
    if (!byDoc.has(chunk.doc_id)) {
      byDoc.set(chunk.doc_id, []);
    }
    byDoc.get(chunk.doc_id).push(chunk);
  }

  const lite = [];
  for (const docChunks of byDoc.values()) {
    const selected = [...docChunks]
      .sort((left, right) => left.chunk_index - right.chunk_index)
      .slice(0, LITE_MAX_CHUNKS_PER_DOC);

    for (const chunk of selected) {
      lite.push({
        ...chunk,
        embedding: chunk.embedding.slice(0, LITE_DIMENSION),
      });
    }
  }

  return lite;
}

async function main() {
  const searchPath = path.join(process.cwd(), OUTPUT_SEARCH);
  const vectorsPath = path.join(process.cwd(), OUTPUT_VECTORS);
  const vectorsLitePath = path.join(process.cwd(), OUTPUT_VECTORS_LITE);
  const searchPayload = JSON.parse(await fs.readFile(searchPath, "utf8"));
  const items = Array.isArray(searchPayload.items) ? searchPayload.items : [];
  if (items.length === 0) {
    throw new Error("search.json did not contain any items");
  }

  const chunks = items.flatMap((item) => chunkDocument(item));
  const embeddedChunks = await embedChunks(chunks);
  const liteChunks = buildLiteChunks(embeddedChunks);

  const payload = {
    version: VECTORS_VERSION,
    updated_at: new Date().toISOString(),
    model: MODEL,
    dimension: DIMENSION,
    chunk_config: CHUNK,
    total_chunks: embeddedChunks.length,
    chunks: embeddedChunks,
  };

  const litePayload = {
    version: VECTORS_VERSION,
    mode: "lite",
    updated_at: new Date().toISOString(),
    model: MODEL,
    dimension: LITE_DIMENSION,
    chunk_config: CHUNK,
    lite_config: {
      max_chunks_per_doc: LITE_MAX_CHUNKS_PER_DOC,
      dimension: LITE_DIMENSION,
    },
    total_chunks: liteChunks.length,
    chunks: liteChunks,
  };

  await fs.mkdir(path.dirname(vectorsPath), { recursive: true });
  await Promise.all([
    fs.writeFile(vectorsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    fs.writeFile(vectorsLitePath, `${JSON.stringify(litePayload, null, 2)}\n`, "utf8"),
  ]);
  console.log(`[semantic-vectors] total_chunks=${embeddedChunks.length} lite_chunks=${liteChunks.length}`);
}

main().catch((error) => {
  console.error("[semantic-vectors] failed", error);
  process.exit(1);
});
