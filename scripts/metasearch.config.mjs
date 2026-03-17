export const SOURCES = [
  "https://files.jcrt.org/metadata/search/archives.search.json",
  "https://files.jcrt.org/metadata/search/authors.search.json",
  "https://files.jcrt.org/metadata/search/blog.search.json",
  "https://files.jcrt.org/metadata/search/json/archives-01.search.json",
  "https://files.jcrt.org/metadata/search/json/authors-01.search.json",
  "https://files.jcrt.org/metadata/search/json/blog-01.search.json",
  "https://files.jcrt.org/metadata/search/json/religioustheory-01.search.json",
  "https://files.jcrt.org/metadata/search/religioustheory.search.json",
  "https://journal.thenewpolis.com/metadata/search.json",
  "https://thenewpolis.com/metadata/search.json",
  "https://esthesis.org/metadata/search.json",
  "https://thewhitestonefoundation.org/metadata/search.json"
];

export const CHUNK = {
  target_chars: 1100,
  overlap_chars: 200,
  max_per_doc: 12,
};

export const MODEL = "Xenova/all-MiniLM-L6-v2";
export const DIMENSION = 384;
export const LITE_DIMENSION = 192;
export const LITE_MAX_CHUNKS_PER_DOC = 3;
export const MIN_TEXT_LENGTH = 180;
export const SNIPPET_LENGTH = 200;
export const SIMILARITY_THRESHOLD = 0.2;
export const MAX_RESULTS = 10;
export const FETCH_TIMEOUT_MS = 30000;
export const EMBEDDING_PRECISION = 4;
export const EMBEDDING_BATCH_SIZE = 8;
export const SEARCH_VERSION = 1;
export const VECTORS_VERSION = 1;

export const BOOST_MAP = [
  { pattern: "jcrt.org/archives/", boost: 1000 },
  { pattern: "journal.thenewpolis.com", boost: 800 },
  { pattern: "jcrt.org/religioustheory", boost: 700 },
  { pattern: "jcrt.org", boost: 600 },
  { pattern: "thenewpolis.com", boost: 400 },
  { pattern: "esthesis.org", boost: 300 },
  { pattern: "thewhitestonefoundation.org", boost: 150 },
];

export const BOOST_DEFAULT = 50;

export const OUTPUT_SEARCH = "_site/metadata/search.json";
export const OUTPUT_VECTORS = "_site/metadata/vectors.json";
export const OUTPUT_VECTORS_LITE = "_site/metadata/vectors-lite.json";
