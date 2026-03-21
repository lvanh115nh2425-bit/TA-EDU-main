const { generateEmbedding, preprocessText } = require("./embeddings");

/**
 * Split Vietnamese legal text into sentences, respecting structural boundaries.
 *
 * Split order:
 *  1. Paragraph boundaries (\n\n)
 *  2. Numbered clauses (1. 2. 3. ...)
 *  3. Lettered sub-clauses (a) b) c) đ) ...)
 *  4. Dash items (- ...)
 *  5. Period/semicolon followed by uppercase Vietnamese char (long remnants)
 *
 * @param {string} text
 * @returns {string[]} array of sentence strings (trimmed, non-empty)
 */
function splitVietnameseSentences(text) {
  if (!text || typeof text !== "string") return [];

  // Step 1: split on double-newlines (paragraph boundaries)
  const paragraphs = text.split(/\n\n+/);
  const segments = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Step 2-4: split on numbered clauses, lettered sub-clauses, and dash items
    // Pattern: line starting with "1." or "a)" or "đ)" or "- "
    const subParts = trimmed.split(/\n(?=\d+\.\s|[a-zđ]\)\s|- )/);

    for (const part of subParts) {
      const p = part.trim();
      if (!p) continue;

      // Step 5: if segment is long (>500 chars), split on period/semicolon + uppercase Vietnamese
      if (p.length > 500) {
        // Split on ". " or "; " followed by an uppercase Vietnamese letter
        const subSentences = p.split(
          /(?<=[.;])\s+(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ])/
        );
        for (const s of subSentences) {
          const st = s.trim();
          if (st) segments.push(st);
        }
      } else {
        segments.push(p);
      }
    }
  }

  return segments;
}

/**
 * Compute cosine similarity between two vectors.
 * Assumes vectors are already L2-normalized (MiniLM outputs are), so dot product = cosine sim.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} similarity in [-1, 1]
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Semantic chunking for a raw text string.
 *
 * Algorithm:
 *  1. Split text into sentences using Vietnamese-aware splitter
 *  2. If <= 3 sentences, return as single chunk
 *  3. Embed all sentences
 *  4. Compute cosine similarity between consecutive sentence embeddings
 *  5. Detect breakpoints where similarity < threshold
 *  6. Force break if accumulated text exceeds maxChunkSize
 *  7. Merge chunks smaller than minChunkSize with neighbors
 *  8. Add 1 overlap sentence between consecutive chunks
 *
 * @param {string} text - raw article text
 * @param {object} [options]
 * @param {number} [options.similarityThreshold=0.5] - break when consecutive similarity is below this
 * @param {number} [options.maxChunkSize=1500] - force break above this char count
 * @param {number} [options.minChunkSize=200] - merge chunks below this char count
 * @returns {Promise<string[]>} array of chunk text strings
 */
async function semanticChunkText(text, options = {}) {
  const {
    similarityThreshold = 0.5,
    maxChunkSize = 1500,
    minChunkSize = 200,
  } = options;

  const sentences = splitVietnameseSentences(text);

  // Trivial cases: no sentences or very few
  if (sentences.length === 0) return [];
  if (sentences.length <= 3) return [sentences.join("\n")];

  // Also check: if the full text is short enough, return as-is
  const fullText = sentences.join("\n");
  if (fullText.length <= maxChunkSize) return [fullText];

  // Step 3: embed all sentences
  const embeddings = [];
  for (const sentence of sentences) {
    const emb = await generateEmbedding(preprocessText(sentence));
    embeddings.push(emb);
  }

  // Step 4: compute similarities between consecutive sentences
  const similarities = [];
  for (let i = 0; i < sentences.length - 1; i++) {
    if (embeddings[i] && embeddings[i + 1]) {
      similarities.push(cosineSimilarity(embeddings[i], embeddings[i + 1]));
    } else {
      similarities.push(0); // treat missing embeddings as a break
    }
  }

  // Step 5-6: detect breakpoints
  const breakpoints = new Set();
  let accumulatedLength = 0;

  for (let i = 0; i < sentences.length; i++) {
    accumulatedLength += sentences[i].length;

    if (i < sentences.length - 1) {
      const isSemBreak = similarities[i] < similarityThreshold;
      const isSizeBreak = accumulatedLength > maxChunkSize;

      if (isSemBreak || isSizeBreak) {
        breakpoints.add(i); // break AFTER sentence i
        accumulatedLength = 0;
      }
    }
  }

  // Build raw chunks from breakpoints
  const rawChunks = [];
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (breakpoints.has(i)) {
      rawChunks.push(sentences.slice(start, i + 1));
      start = i + 1;
    }
  }
  // Remaining sentences
  if (start < sentences.length) {
    rawChunks.push(sentences.slice(start));
  }

  // Step 7: merge small chunks with neighbors
  const merged = [];
  for (const chunk of rawChunks) {
    const chunkText = chunk.join("\n");
    if (merged.length > 0 && chunkText.length < minChunkSize) {
      // Merge with previous chunk
      merged[merged.length - 1] = merged[merged.length - 1].concat(chunk);
    } else {
      merged.push([...chunk]);
    }
  }

  // Step 8: add 1 overlap sentence between chunks
  const result = [];
  for (let i = 0; i < merged.length; i++) {
    const chunk = [...merged[i]];

    // Prepend last sentence of previous chunk (overlap)
    if (i > 0) {
      const prevChunk = merged[i - 1];
      const overlapSentence = prevChunk[prevChunk.length - 1];
      chunk.unshift(overlapSentence);
    }

    result.push(chunk.join("\n"));
  }

  return result;
}

/**
 * Semantically chunk an article object, returning chunk objects ready for DB insertion.
 *
 * @param {object} article - { lawName, chapter, articleName, content, lawNumber, lawYear }
 * @param {object} [options] - passed to semanticChunkText
 * @returns {Promise<Array<{lawName, chapter, articleName, content, chunkIndex, totalChunks, lawNumber, lawYear, chunkingMethod}>>}
 */
async function semanticChunkArticle(article, options = {}) {
  const content = article.content;

  // Short articles: no chunking needed
  if (content.length <= 2000) {
    return [{
      lawName: article.lawName,
      chapter: article.chapter,
      articleName: article.articleName,
      content: content,
      chunkIndex: 0,
      totalChunks: 1,
      lawNumber: article.lawNumber,
      lawYear: article.lawYear,
      chunkingMethod: "semantic",
    }];
  }

  const chunks = await semanticChunkText(content, options);
  const totalChunks = chunks.length;

  return chunks.map((chunkContent, i) => ({
    lawName: article.lawName,
    chapter: article.chapter,
    articleName: i === 0 ? article.articleName : `${article.articleName} [phần ${i + 1}]`,
    content: chunkContent,
    chunkIndex: i,
    totalChunks,
    lawNumber: article.lawNumber,
    lawYear: article.lawYear,
    chunkingMethod: "semantic",
  }));
}

module.exports = {
  semanticChunkText,
  semanticChunkArticle,
  splitVietnameseSentences,
};
