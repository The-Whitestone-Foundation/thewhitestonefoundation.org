import { createHash } from "node:crypto";
import {
  BOOST_DEFAULT,
  BOOST_MAP,
  EMBEDDING_PRECISION,
  FETCH_TIMEOUT_MS,
} from "../metasearch.config.mjs";

export async function safeFetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        ok: false,
        data: null,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const raw = await response.text();
    try {
      return { ok: true, data: JSON.parse(raw), error: "" };
    } catch {
      const repaired = raw.replace(/,\s*([}\]])/g, "$1");
      return { ok: true, data: JSON.parse(repaired), error: "" };
    }
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function stripHtml(value) {
  const decoded = String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  return decoded;
}

export function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toArray(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((part) => part.trim()).filter(Boolean);
    }
    return [trimmed];
  }

  return [String(value).trim()].filter(Boolean);
}

export function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    url.hash = "";
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
      if (!url.pathname) {
        url.pathname = "/";
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function siteFromUrl(rawUrl) {
  try {
    const { hostname, pathname } = new URL(rawUrl);
    if (hostname === "journal.thenewpolis.com") return "The New Polis Journal";
    if (hostname === "thenewpolis.com") return "The New Polis";
    if (hostname === "esthesis.org") return "Esthesis";
    if (hostname === "thewhitestonefoundation.org") return "The Whitestone Foundation";
    if (hostname === "files.jcrt.org" && pathname.includes("religioustheory")) return "Religious Theory";
    if (hostname === "files.jcrt.org" || hostname === "jcrt.org") return "JCRT";
    return hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

export function rankBoostFromUrl(rawUrl) {
  const candidate = String(rawUrl || "").toLowerCase();
  const matched = BOOST_MAP.find(({ pattern }) => candidate.includes(pattern));
  return matched ? matched.boost : BOOST_DEFAULT;
}

export function stableSha1(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

export function parseDateSafe(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function roundEmbedding(values, precision = EMBEDDING_PRECISION) {
  const factor = 10 ** precision;
  return Array.from(values || [], (value) => Math.round(Number(value) * factor) / factor);
}

export function ensureArrayPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

export function uniqueStrings(values) {
  return [...new Set(toArray(values).map((value) => String(value).trim()).filter(Boolean))];
}

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function truncateText(value, limit) {
  const text = normalizeWhitespace(value);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}
