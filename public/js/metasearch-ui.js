(() => {
  const MODEL = "Xenova/all-MiniLM-L6-v2";
  const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
  const CACHE_NAME = "metasearch-cache-v1";
  const CACHE_META_KEY = "metasearch-cache-meta-v1";
  const CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000;
  const METADATA_PAGES = ["/metadata/", "/metadata/search/"];
  const SEARCH_URL = "/metadata/search.json";
  const VECTORS_LITE_URL = "/metadata/vectors-lite.json";
  const VECTORS_URL = "/metadata/vectors.json";
  const SIMILARITY_THRESHOLD = 0.15;
  const MAX_RESULTS = 15;

  const form = document.getElementById("metasearch-form");
  const input = document.getElementById("metasearch-input");
  const status = document.getElementById("metasearch-status");
  const results = document.getElementById("metasearch-results");
  const progressWrap = document.getElementById("metasearch-progress-wrap");
  const progressBar = document.getElementById("metasearch-progress");
  const progressLabel = document.getElementById("metasearch-progress-label");
  const progressPercent = document.getElementById("metasearch-progress-percent");

  if (!form || !input || !status || !results) {
    return;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const vectorMode = searchParams.get("mode") === "full" ? "full" : "lite";

  const state = {
    searchIndex: null,
    vectors: null,
    vectorDimension: 0,
    extractor: null,
    loadingPromise: null,
    vectorsMode: vectorMode,
    progressValue: 0,
    progressVisibleAt: 0,
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

  function showProgress() {
    if (!progressWrap) return;
    if (progressWrap.hidden) {
      state.progressVisibleAt = Date.now();
    }
    progressWrap.hidden = false;
  }

  function hideProgress() {
    if (progressWrap) progressWrap.hidden = true;
  }

  function resetProgress(label = "Preparing search...") {
    state.progressValue = 0;
    showProgress();
    if (progressBar) progressBar.value = 0;
    if (progressLabel) progressLabel.textContent = label;
    if (progressPercent) progressPercent.textContent = "0%";
  }

  function setProgress(value, label = "", force = false) {
    showProgress();
    const numeric = Math.max(0, Math.min(100, Number(value) || 0));
    const nextValue = force ? numeric : Math.max(state.progressValue, numeric);
    state.progressValue = nextValue;
    if (progressBar) {
      progressBar.value = nextValue;
    }
    if (progressLabel && label) {
      progressLabel.textContent = label;
    }
    if (progressPercent) {
      progressPercent.textContent = `${Math.round(nextValue)}%`;
    }
  }

  async function finishProgress(label = "Done") {
    setProgress(100, label, true);
    const elapsed = Date.now() - Number(state.progressVisibleAt || Date.now());
    const minVisible = 900;
    if (elapsed < minVisible) {
      await new Promise((resolve) => setTimeout(resolve, minVisible - elapsed));
    }
    hideProgress();
  }

  function readCacheMeta() {
    try {
      const raw = localStorage.getItem(CACHE_META_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCacheMeta(meta) {
    try {
      localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
    } catch {
      // Ignore quota failures.
    }
  }

  function isFresh(timestamp) {
    if (!timestamp) return false;
    return Date.now() - Number(timestamp) < CACHE_TTL_MS;
  }

  async function fetchWithEightDayCache(url, { preferFresh = false } = {}) {
    if (!("caches" in window)) {
      return fetch(url, {
        cache: preferFresh ? "no-store" : "default",
        headers: { accept: "application/json,text/html,*/*" },
      });
    }

    const cache = await caches.open(CACHE_NAME);
    const cacheMeta = readCacheMeta();
    const key = String(url);
    const cached = await cache.match(key);

    if (preferFresh) {
      try {
        const response = await fetch(key, {
          cache: "no-store",
          headers: { accept: "application/json,text/html,*/*" },
        });
        if (response.ok) {
          await cache.put(key, response.clone());
          cacheMeta[key] = Date.now();
          writeCacheMeta(cacheMeta);
          return response;
        }
        if (cached) {
          return cached.clone();
        }
        return response;
      } catch (error) {
        if (cached) {
          return cached.clone();
        }
        throw error;
      }
    }

    if (cached && isFresh(cacheMeta[key])) {
      return cached.clone();
    }

    const response = await fetch(key, { headers: { accept: "application/json,text/html,*/*" } });
    if (response.ok) {
      await cache.put(key, response.clone());
      cacheMeta[key] = Date.now();
      writeCacheMeta(cacheMeta);
    }

    return response;
  }

  async function primeMetadataPageCache() {
    await Promise.all(
      METADATA_PAGES.map(async (url) => {
        try {
          await fetchWithEightDayCache(url);
        } catch {
          // Keep search functional even if pre-cache fails.
        }
      })
    );
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

  function textMatchBonus(query, chunk) {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return 0;
    const words = q.split(/\s+/).filter(Boolean);
    const title = String(chunk.title || "").toLowerCase();
    const snippet = String(chunk.snippet || "").toLowerCase();
    const combined = title + " " + snippet;
    let bonus = 0;
    if (title.includes(q)) bonus += 0.12;
    else if (combined.includes(q)) bonus += 0.05;
    for (const w of words) {
      if (title.includes(w)) bonus += 0.04;
      else if (combined.includes(w)) bonus += 0.01;
    }
    return Math.min(bonus, 0.25);
  }

  async function loadJson(url) {
    setProgress(30, "Downloading search data...");
    const response = await fetchWithEightDayCache(url, { preferFresh: true });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    }
    const text = await response.text();
    setProgress(38, "Parsing search data...");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${url}`);
    }
  }

  async function ensureSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    state.searchIndex = await loadJson(SEARCH_URL);
    return state.searchIndex;
  }

  async function ensureVectors() {
    if (state.vectors) return state.vectors;
    const candidateUrls = state.vectorsMode === "full"
      ? [VECTORS_URL]
      : [VECTORS_LITE_URL, VECTORS_URL];

    let lastError = null;
    for (const url of candidateUrls) {
      try {
        setProgress(45, `Loading vectors (${url.includes("lite") ? "lite" : "full"})...`);
        const payload = await loadJson(url);
        const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
        if (!chunks.length) {
          throw new Error("Vector index is empty");
        }
        state.vectors = chunks;
        state.vectorDimension = Number(payload.dimension) || Number(chunks[0]?.embedding?.length) || 0;
        state.vectorsMode = payload.mode === "lite" ? "lite" : (url === VECTORS_LITE_URL ? "lite" : "full");
        setProgress(62, `Loaded ${chunks.length} chunks (${state.vectorsMode})`);
        return state.vectors;
      } catch (error) {
        lastError = error;
        setProgress(50, "Retrying with alternate vectors...");
      }
    }

    throw (lastError || new Error("Unable to load semantic vector index"));
  }

  function tensorToVector(tensor) {
    if (tensor && typeof tensor.tolist === "function") {
      const rows = tensor.tolist();
      return Array.isArray(rows[0]) ? rows[0] : rows;
    }
    return Array.from(tensor?.data || []);
  }

  function normalizeProgressValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 1) return Math.round(numeric * 100);
    return Math.round(numeric);
  }

  function modelProgressLabel(info) {
    const file = info?.file ? ` ${String(info.file).split("/").pop()}` : "";
    const stateText = info?.status ? String(info.status).replaceAll("_", " ") : "downloading";
    return `${stateText}${file}`.trim();
  }

  async function ensureExtractor() {
    if (state.extractor) return state.extractor;
    if (state.loadingPromise) return state.loadingPromise;

    setStatus("Loading search model...");
    setProgress(5, "Loading runtime...");
    state.loadingPromise = (async () => {
      const { pipeline, env } = await import(`${MODEL_CDN}/dist/transformers.min.js`);
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = `${MODEL_CDN}/dist/`;
      }
      setProgress(12, "Downloading semantic model...");
      state.extractor = await pipeline("feature-extraction", MODEL, {
        dtype: "q8",
        progress_callback: (info) => {
          const progress = normalizeProgressValue(info?.progress);
          const staged = 12 + Math.round(progress * 0.58);
          setProgress(staged, modelProgressLabel(info));
        },
      });
      setProgress(72, "Model ready");
      return state.extractor;
    })();

    try {
      return await state.loadingPromise;
    } finally {
      state.loadingPromise = null;
    }
  }

  async function embedQuery(query) {
    setProgress(76, "Encoding query...");
    const extractor = await ensureExtractor();
    const tensor = await extractor(query, { pooling: "mean", normalize: true });
    setProgress(84, "Query encoded");
    return tensorToVector(tensor);
  }

  function alignQueryVector(queryVector) {
    const targetDimension = Number(state.vectorDimension) || Number(queryVector?.length) || 0;
    const values = Array.isArray(queryVector) ? queryVector : [];
    if (!targetDimension || values.length === targetDimension) {
      return values;
    }
    if (values.length > targetDimension) {
      return values.slice(0, targetDimension);
    }
    return values.concat(new Array(targetDimension - values.length).fill(0));
  }

  function buildResultMarkup(result) {
    const meta = [];
    if (result.site) meta.push(`<span class="metasearch-site">${escapeHtml(result.site)}</span>`);
    if (result.author) meta.push(`<span>${escapeHtml(result.author)}</span>`);
    if (result.date) meta.push(`<time datetime="${escapeHtml(result.date)}">${escapeHtml(formatDate(result.date))}</time>`);

    const tags = [...(result.categories || []), ...(result.tags || [])]
      .filter(Boolean)
      .slice(0, 8)
      .map((tag) => `<li>${escapeHtml(tag)}</li>`)
      .join("");

    const url = result.url || "#";
    const title = result.title || "Untitled";

    return `
      <article class="metasearch-card">
        <h3><a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(title)}</a></h3>
        ${meta.length ? `<p class="metasearch-meta">${meta.join(' <span aria-hidden="true">&bull;</span> ')}</p>` : ""}
        ${result.snippet || result.description ? `<p class="metasearch-snippet">${escapeHtml(result.snippet || result.description)}</p>` : ""}
        ${url !== "#" ? `<p class="metasearch-url"><a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url)}</a></p>` : ""}
        ${tags ? `<ul class="metasearch-tags" aria-label="Tags">${tags}</ul>` : ""}
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
      setStatus(`Search across ${searchIndex.total_items || 0} documents (${state.vectorsMode} vectors)`);
      hideProgress();
      return;
    }

    setStatus("Searching...");
    resetProgress("Preparing semantic search...");
    setProgress(8, "Initializing...");
    const [rawQueryVector, vectorChunks, searchIndex] = await Promise.all([
      embedQuery(trimmed),
      ensureVectors(),
      ensureSearchIndex(),
    ]);
    const queryVector = alignQueryVector(rawQueryVector);

    const bestByUrl = new Map();
    for (let index = 0; index < vectorChunks.length; index += 1) {
      const chunk = vectorChunks[index];
      const similarity = cosineSimilarity(queryVector, chunk.embedding || []);
      if (similarity < SIMILARITY_THRESHOLD) continue;
      const boostScore = (Number(chunk.boost) || 0) / 5000;
      const textBonus = textMatchBonus(trimmed, chunk);
      const score = similarity + boostScore + recencyScore(chunk.date) + textBonus;
      const existing = bestByUrl.get(chunk.url);
      if (!existing || score > existing.score) {
        bestByUrl.set(chunk.url, {
          ...chunk,
          similarity,
          score,
        });
      }

      if (index % 250 === 0 || index === vectorChunks.length - 1) {
        const progress = 86 + Math.round(((index + 1) / Math.max(vectorChunks.length, 1)) * 12);
        setProgress(progress, "Scoring candidate chunks...");
      }
    }

    const ranked = [...bestByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RESULTS);

    setProgress(100, "Done");
    renderResults(ranked);
    setStatus(`${ranked.length} result${ranked.length === 1 ? "" : "s"} across ${searchIndex.total_items || 0} documents (${state.vectorsMode} vectors)`);
    await finishProgress("Done");
  }

  async function warmup() {
    try {
      resetProgress("Warming semantic search...");
      setProgress(4, "Starting warmup...");
      await Promise.all([primeMetadataPageCache(), ensureExtractor(), ensureVectors()]);
      setProgress(100, "Warm cache ready");
      await finishProgress("Warm cache ready");
    } catch (error) {
      hideProgress();
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
      hideProgress();
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
      await primeMetadataPageCache();
      const searchIndex = await ensureSearchIndex();
      setStatus(`Search across ${searchIndex.total_items || 0} documents (${state.vectorsMode} vectors)`);
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get("q") || "";
      if (initialQuery) {
        input.value = initialQuery;
        warmed = true;
        resetProgress("Initializing search...");
        setProgress(2, "Initializing search...");
        await runSearch(initialQuery);
      }
    } catch (error) {
      hideProgress();
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  })();
})();
