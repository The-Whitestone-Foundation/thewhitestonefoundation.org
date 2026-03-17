(() => {
  const MODEL = "Xenova/all-MiniLM-L6-v2";
  const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
  const SEARCH_URL = "/metadata/search.json";
  const VECTORS_URL = "/metadata/vectors.json";
  const SIMILARITY_THRESHOLD = 0.2;
  const MAX_RESULTS = 10;

  const form = document.getElementById("metasearch-form");
  const input = document.getElementById("metasearch-input");
  const status = document.getElementById("metasearch-status");
  const results = document.getElementById("metasearch-results");

  if (!form || !input || !status || !results) {
    return;
  }

  const state = {
    searchIndex: null,
    vectors: null,
    extractor: null,
    loadingPromise: null,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ready";
  }

  function normalizeDate(dateString) {
    const value = Date.parse(dateString || "");
    if (!Number.isFinite(value)) return 0;
    return value;
  }

  function formatDate(dateString) {
    const value = normalizeDate(dateString);
    if (!value) return "";
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(value);
  }

  function cosineSimilarity(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return 0;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = Number(left[index]) || 0;
      const rightValue = Number(right[index]) || 0;
      dot += leftValue * rightValue;
      leftNorm += leftValue * leftValue;
      rightNorm += rightValue * rightValue;
    }

    if (!leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  function recencyScore(dateString) {
    const value = normalizeDate(dateString);
    if (!value) return 0;
    const ageDays = (Date.now() - value) / 86400000;
    if (ageDays < 30) return 0.03;
    if (ageDays < 90) return 0.02;
    if (ageDays < 365) return 0.01;
    return 0;
  }

  async function loadJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    }
    return response.json();
  }

  async function ensureSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    state.searchIndex = await loadJson(SEARCH_URL);
    return state.searchIndex;
  }

  async function ensureVectors() {
    if (state.vectors) return state.vectors;
    const payload = await loadJson(VECTORS_URL);
    state.vectors = Array.isArray(payload.chunks) ? payload.chunks : [];
    return state.vectors;
  }

  function tensorToVector(tensor) {
    if (tensor && typeof tensor.tolist === "function") {
      const rows = tensor.tolist();
      return Array.isArray(rows[0]) ? rows[0] : rows;
    }
    return Array.from(tensor?.data || []);
  }

  async function ensureExtractor() {
    if (state.extractor) return state.extractor;
    if (state.loadingPromise) return state.loadingPromise;

    setStatus("Loading search model...");
    state.loadingPromise = (async () => {
      const { pipeline, env } = await import(`${MODEL_CDN}/dist/transformers.min.js`);
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = `${MODEL_CDN}/dist/`;
      }
      state.extractor = await pipeline("feature-extraction", MODEL, {
        dtype: "q8",
      });
      return state.extractor;
    })();

    try {
      return await state.loadingPromise;
    } finally {
      state.loadingPromise = null;
    }
  }

  async function embedQuery(query) {
    const extractor = await ensureExtractor();
    const tensor = await extractor(query, { pooling: "mean", normalize: true });
    return tensorToVector(tensor);
  }

  function buildResultMarkup(result) {
    const meta = [];
    if (result.site) meta.push(`<span class="metasearch-site">${escapeHtml(result.site)}</span>`);
    if (result.author) meta.push(`<span>${escapeHtml(result.author)}</span>`);
    if (result.date) meta.push(`<span>${escapeHtml(formatDate(result.date))}</span>`);

    const tags = [...(result.categories || []), ...(result.tags || [])]
      .filter(Boolean)
      .slice(0, 8)
      .map((tag) => `<li>${escapeHtml(tag)}</li>`)
      .join("");

    return `
      <article class="metasearch-card">
        <h3><a href="${escapeHtml(result.url)}">${escapeHtml(result.title || "Untitled")}</a></h3>
        <p class="metasearch-meta">${meta.join(" <span aria-hidden=\"true\">•</span> ")}</p>
        <p class="metasearch-snippet">${escapeHtml(result.snippet || result.description || "")}</p>
        ${tags ? `<ul class="metasearch-tags">${tags}</ul>` : ""}
      </article>
    `;
  }

  function renderResults(items) {
    if (!items.length) {
      results.innerHTML = '<p class="metasearch-empty">No semantic matches found.</p>';
      return;
    }

    results.innerHTML = items.map((item) => buildResultMarkup(item)).join("\n");
  }

  async function runSearch(query) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      results.innerHTML = "";
      const searchIndex = await ensureSearchIndex();
      setStatus(`Search across ${searchIndex.total_items || 0} documents`);
      return;
    }

    setStatus("Searching...");
    const [queryVector, vectorChunks, searchIndex] = await Promise.all([
      embedQuery(trimmed),
      ensureVectors(),
      ensureSearchIndex(),
    ]);

    const bestByUrl = new Map();
    for (const chunk of vectorChunks) {
      const similarity = cosineSimilarity(queryVector, chunk.embedding || []);
      if (similarity < SIMILARITY_THRESHOLD) continue;
      const score = similarity + ((Number(chunk.boost) || 0) / 10000) + recencyScore(chunk.date);
      const existing = bestByUrl.get(chunk.url);
      if (!existing || score > existing.score) {
        bestByUrl.set(chunk.url, {
          ...chunk,
          similarity,
          score,
        });
      }
    }

    const ranked = [...bestByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RESULTS);

    renderResults(ranked);
    setStatus(`${ranked.length} result${ranked.length === 1 ? "" : "s"} across ${searchIndex.total_items || 0} documents`);
  }

  async function warmup() {
    try {
      await Promise.all([ensureExtractor(), ensureVectors()]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value;
    const url = new URL(window.location.href);
    if (query.trim()) {
      url.searchParams.set("q", query.trim());
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState({}, "", url);

    try {
      await runSearch(query);
    } catch (error) {
      results.innerHTML = "";
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  let warmed = false;
  function warmOnce() {
    if (warmed) return;
    warmed = true;
    warmup();
  }

  input.addEventListener("input", warmOnce, { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") warmOnce();
  }, { once: true });
  form.addEventListener("submit", warmOnce, { once: true });

  (async () => {
    try {
      const searchIndex = await ensureSearchIndex();
      setStatus(`Search across ${searchIndex.total_items || 0} documents`);
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get("q") || "";
      if (initialQuery) {
        input.value = initialQuery;
        await runSearch(initialQuery);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  })();
})();
