const crypto = require("crypto");

// TaskType enum — kept for API compatibility with callers
const TaskType = {
  RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
  RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
};

// Local transformer model via @xenova/transformers
const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
let pipeline = null;
let modelReady = false;
let modelLoading = null;

async function loadModel() {
  if (modelReady) return;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    const { pipeline: createPipeline } = await import("@xenova/transformers");
    console.log(`[Embeddings] Loading local model: ${MODEL_NAME}...`);
    pipeline = await createPipeline("feature-extraction", MODEL_NAME, {
      quantized: true,
    });
    modelReady = true;
    console.log(`[Embeddings] Model loaded successfully (384-dim)`);
  })();

  return modelLoading;
}

// Start loading immediately on import
loadModel().catch((err) => {
  console.error(`[Embeddings] Failed to load model: ${err.message}`);
});

// In-memory dedup cache
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 5000;

/**
 * Preprocess text before embedding generation
 * @param {string} text - Raw input text
 * @returns {string} - Cleaned and normalized text
 */
function preprocessText(text) {
  if (!text || typeof text !== "string") return "";

  // Unicode NFC normalization
  let processed = text.normalize("NFC");

  // Collapse multiple whitespace/newlines into single spaces
  processed = processed.replace(/\s+/g, " ").trim();

  // Remove non-meaningful special chars (keep Vietnamese chars, digits, basic punctuation)
  processed = processed.replace(/[^\p{L}\p{N}\s.,;:!?()""''/-]/gu, "");

  // Truncate at 10000 chars
  if (processed.length > 10000) {
    processed = processed.substring(0, 10000);
  }

  return processed;
}

/**
 * Generate cache key from text
 * @param {string} text - Text to embed
 * @returns {string} - SHA-256 hash
 */
function getCacheKey(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate embedding for a single text using local transformer model
 * @param {string} text - Text to embed
 * @param {string} _taskType - Ignored (kept for API compatibility)
 * @returns {Promise<number[]|null>} 384-dim vector or null
 */
async function generateEmbedding(text, _taskType = TaskType.RETRIEVAL_QUERY) {
  // Preprocess text
  const processedText = preprocessText(text);
  if (!processedText) return null;

  // Check cache
  const cacheKey = getCacheKey(processedText);
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  // Clear cache if full
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    console.log(`Embedding cache full (${MAX_CACHE_SIZE} entries), clearing...`);
    embeddingCache.clear();
  }

  try {
    await loadModel();
    if (!pipeline) return null;

    const output = await pipeline(processedText, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = Array.from(output.data);

    // Cache the result
    embeddingCache.set(cacheKey, embedding);

    return embedding;
  } catch (err) {
    console.error(`Embedding error: ${err.message}`);
    return null;
  }
}

/**
 * Generate embeddings for a batch of items.
 * Processes sequentially (local model, no rate limits, but single-threaded).
 * @param {Array<{text: string}>} items - each item must have a .text property
 * @param {string} taskType
 * @returns {Promise<Array<number[]|null>>} array of embeddings matching input order
 */
async function generateEmbeddingsBatch(items, taskType = TaskType.RETRIEVAL_DOCUMENT) {
  await loadModel();
  if (!pipeline) return items.map(() => null);

  const results = [];

  for (let i = 0; i < items.length; i++) {
    const emb = await generateEmbedding(items[i].text, taskType);
    results.push(emb);

    if ((i + 1) % 50 === 0 || i === items.length - 1) {
      console.log(`  Embedded ${i + 1}/${items.length}`);
    }
  }

  return results;
}

module.exports = { generateEmbedding, generateEmbeddingsBatch, preprocessText, TaskType };
