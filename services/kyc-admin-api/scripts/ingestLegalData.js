require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { query, ensureSchema } = require("../src/db");
const { generateEmbeddingsBatch, preprocessText, TaskType } = require("../src/lib/embeddings");
const { semanticChunkArticle } = require("../src/lib/semanticChunker");

const RULE_DIR = path.join(__dirname, "../../../rule/Luat");

// CLI flags
const args = process.argv.slice(2);
const FLAG_CLEAR = args.includes("--clear");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_LEGACY = args.includes("--legacy");

/**
 * Legacy character-based chunking.
 * Used when --legacy flag is passed.
 */
function chunkArticle(article) {
  const MAX_CHUNK_SIZE = 1800;
  const OVERLAP = 200;
  const content = article.content;

  if (content.length <= 2000) {
    return [{
      ...article,
      chunkIndex: 0,
      totalChunks: 1,
      chunkingMethod: "character",
    }];
  }

  const chunks = [];
  const paragraphs = content.split(/\n\n+/);
  let currentChunk = "";
  let currentParagraphs = [];

  function finalizeChunk() {
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
      currentParagraphs = [];
    }
  }

  function addParagraph(para) {
    const testChunk = currentChunk + (currentChunk ? "\n\n" : "") + para;
    if (testChunk.length <= MAX_CHUNK_SIZE) {
      currentChunk = testChunk;
      currentParagraphs.push(para);
    } else {
      if (currentChunk) {
        const lastPara = currentParagraphs.length > 0
          ? currentParagraphs[currentParagraphs.length - 1]
          : null;
        finalizeChunk();
        if (lastPara && lastPara.length <= OVERLAP) {
          currentChunk = lastPara;
          currentParagraphs = [lastPara];
        }
      }

      if (para.length > MAX_CHUNK_SIZE) {
        const sentences = para.split(/\.\s+/);
        let sentenceChunk = "";

        for (let sentence of sentences) {
          const testSentence = sentenceChunk + (sentenceChunk ? ". " : "") + sentence;
          if (testSentence.length <= MAX_CHUNK_SIZE) {
            sentenceChunk = testSentence;
          } else {
            if (sentenceChunk) {
              chunks.push(sentenceChunk.trim());
              sentenceChunk = sentenceChunk.slice(-OVERLAP) + ". " + sentence;
            } else {
              chunks.push(sentence.trim());
              sentenceChunk = "";
            }
          }
        }

        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk.trim();
          currentParagraphs = [sentenceChunk.trim()];
        }
      } else {
        currentChunk = (currentChunk ? currentChunk + "\n\n" : "") + para;
        currentParagraphs.push(para);
      }
    }
  }

  for (const para of paragraphs) {
    if (para.trim()) {
      addParagraph(para.trim());
    }
  }

  finalizeChunk();

  const totalChunks = chunks.length;
  return chunks.map((chunkContent, i) => ({
    lawName: article.lawName,
    chapter: article.chapter,
    articleName: i === 0 ? article.articleName : `${article.articleName} [phần ${i + 1}]`,
    content: chunkContent,
    chunkIndex: i,
    totalChunks: totalChunks,
    lawNumber: article.lawNumber,
    lawYear: article.lawYear,
    chunkingMethod: "character",
  }));
}

/**
 * Extract metadata from file content (law number and year).
 * Searches first 5 lines for patterns like "số 14/2008/QH12" or "năm 2008".
 */
function extractMetadata(fileContent) {
  const lines = fileContent.split("\n").slice(0, 5);
  const firstLines = lines.join("\n");

  let lawNumber = null;
  let lawYear = null;

  // Pattern: "số 14/2008/QH12" or similar
  const lawNumberMatch = firstLines.match(/số\s+(\d+\/\d{4}\/[A-Z]+\d*)/i);
  if (lawNumberMatch) {
    lawNumber = lawNumberMatch[1];
  }

  // Extract year from law number (e.g., "14/2008/QH12" -> "2008")
  if (lawNumber) {
    const yearMatch = lawNumber.match(/\/(\d{4})\//);
    if (yearMatch) {
      lawYear = yearMatch[1];
    }
  }

  // Fallback: search for "năm YYYY"
  if (!lawYear) {
    const yearMatch = firstLines.match(/năm\s+(\d{4})/i);
    if (yearMatch) {
      lawYear = yearMatch[1];
    }
  }

  return { lawNumber, lawYear };
}

/**
 * Compute SHA-256 hash of content.
 */
function computeHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function ingestFile(filePath) {
  const fileName = path.basename(filePath, ".txt");
  const content = fs.readFileSync(filePath, "utf-8");

  // Extract metadata
  const metadata = extractMetadata(content);

  const lines = content.split("\n");
  let currentChapter = "";
  let currentArticle = "";
  let currentContent = [];

  const articles = [];

  function pushArticle() {
    if (currentArticle) {
      const articleContent = currentContent.join("\n").trim();

      // Validation: skip articles with content < 10 chars
      if (articleContent.length < 10) {
        if (articleContent.length === 0) {
          console.warn(`  Warning: Empty article "${currentArticle}" in ${fileName}`);
        } else {
          console.warn(`  Warning: Skipping short article "${currentArticle}" in ${fileName} (${articleContent.length} chars)`);
        }
      } else {
        articles.push({
          lawName: fileName,
          chapter: currentChapter,
          articleName: currentArticle,
          content: articleContent,
          lawNumber: metadata.lawNumber,
          lawYear: metadata.lawYear
        });
      }
    }
    currentContent = [];
  }

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith("Chương ")) {
      pushArticle();
      currentChapter = line;
      currentArticle = "";
    } else if (line.startsWith("Điều ")) {
      pushArticle();
      currentArticle = line;
    } else {
      currentContent.push(line);
    }
  }
  pushArticle(); // last one

  const chunkingMode = FLAG_LEGACY ? "character" : "semantic";
  console.log(`- Ingesting ${fileName}: found ${articles.length} articles (${chunkingMode} chunking)`);

  // Apply chunking
  const allChunks = [];
  for (const article of articles) {
    let chunks;
    if (FLAG_LEGACY) {
      chunks = chunkArticle(article);
    } else {
      chunks = await semanticChunkArticle(article);
    }
    allChunks.push(...chunks);
  }

  console.log(`  Created ${allChunks.length} chunks from ${articles.length} articles`);

  // Dry run: print stats and return without DB writes
  if (FLAG_DRY_RUN) {
    const avgLen = allChunks.length > 0
      ? Math.round(allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length)
      : 0;
    const maxLen = allChunks.length > 0
      ? Math.max(...allChunks.map(c => c.content.length))
      : 0;
    const minLen = allChunks.length > 0
      ? Math.min(...allChunks.map(c => c.content.length))
      : 0;
    console.log(`  [dry-run] avg chunk: ${avgLen} chars, min: ${minLen}, max: ${maxLen}`);
    return {
      articles: articles.length,
      chunks: allChunks.length,
      inserted: 0,
      updated: 0,
      skipped: 0
    };
  }

  // Generate embeddings for all chunks
  const embeddingInputs = allChunks.map((chunk) => ({
    text: preprocessText(`${chunk.lawName} ${chunk.chapter} ${chunk.articleName}\n${chunk.content}`),
  }));
  const embeddings = await generateEmbeddingsBatch(embeddingInputs, TaskType.RETRIEVAL_DOCUMENT);

  // Upsert chunks
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const emb = embeddings[i];
    const contentHash = computeHash(chunk.content);
    const chunkingMethod = chunk.chunkingMethod || chunkingMode;

    if (emb) {
      // Upsert with embedding
      const result = await query(
        `INSERT INTO legal_knowledge
          (law_name, chapter, article_name, content, embedding, chunk_index, total_chunks, content_hash, law_number, law_year, chunking_method)
         VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (law_name, article_name, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           chapter = EXCLUDED.chapter,
           total_chunks = EXCLUDED.total_chunks,
           content_hash = EXCLUDED.content_hash,
           law_number = EXCLUDED.law_number,
           law_year = EXCLUDED.law_year,
           chunking_method = EXCLUDED.chunking_method
         WHERE legal_knowledge.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING (xmax = 0) AS inserted`,
        [
          chunk.lawName,
          chunk.chapter,
          chunk.articleName,
          chunk.content,
          JSON.stringify(emb),
          chunk.chunkIndex,
          chunk.totalChunks,
          contentHash,
          chunk.lawNumber,
          chunk.lawYear,
          chunkingMethod
        ]
      );

      if (result.rows.length > 0) {
        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }
      } else {
        skipped++;
      }
    } else {
      // Upsert without embedding
      const result = await query(
        `INSERT INTO legal_knowledge
          (law_name, chapter, article_name, content, chunk_index, total_chunks, content_hash, law_number, law_year, chunking_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (law_name, article_name, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           chapter = EXCLUDED.chapter,
           total_chunks = EXCLUDED.total_chunks,
           content_hash = EXCLUDED.content_hash,
           law_number = EXCLUDED.law_number,
           law_year = EXCLUDED.law_year,
           chunking_method = EXCLUDED.chunking_method
         WHERE legal_knowledge.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING (xmax = 0) AS inserted`,
        [
          chunk.lawName,
          chunk.chapter,
          chunk.articleName,
          chunk.content,
          chunk.chunkIndex,
          chunk.totalChunks,
          contentHash,
          chunk.lawNumber,
          chunk.lawYear,
          chunkingMethod
        ]
      );

      if (result.rows.length > 0) {
        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }
      } else {
        skipped++;
      }
    }
  }

  return {
    articles: articles.length,
    chunks: allChunks.length,
    inserted,
    updated,
    skipped
  };
}

async function main() {
  const startTime = Date.now();
  const chunkingMode = FLAG_LEGACY ? "character" : "semantic";

  console.log(`Chunking mode: ${chunkingMode}`);
  if (FLAG_CLEAR) console.log(`--clear: will wipe all legal_knowledge rows first`);
  if (FLAG_DRY_RUN) console.log(`--dry-run: will print stats without DB writes`);
  console.log();

  try {
    // Ensure full schema (pgvector, columns, indexes)
    await ensureSchema();

    // Clear existing data if requested
    if (FLAG_CLEAR && !FLAG_DRY_RUN) {
      const { rowCount } = await query(`DELETE FROM legal_knowledge`);
      console.log(`Cleared ${rowCount} existing rows from legal_knowledge.\n`);
    }

    const files = fs.readdirSync(RULE_DIR).filter(f => f.endsWith(".txt"));
    console.log(`Found ${files.length} legal files to ingest.\n`);

    let totalArticles = 0;
    let totalChunks = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const file of files) {
      const stats = await ingestFile(path.join(RULE_DIR, file));
      totalArticles += stats.articles;
      totalChunks += stats.chunks;
      totalInserted += stats.inserted;
      totalUpdated += stats.updated;
      totalSkipped += stats.skipped;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Ingestion complete!`);
    console.log(`${"=".repeat(50)}`);
    console.log(`Chunking mode:       ${chunkingMode}`);
    console.log(`Files processed:     ${files.length}`);
    console.log(`Total articles:      ${totalArticles}`);
    console.log(`Total chunks:        ${totalChunks}`);
    if (!FLAG_DRY_RUN) {
      console.log(`Inserted (new):      ${totalInserted}`);
      console.log(`Updated (changed):   ${totalUpdated}`);
      console.log(`Skipped (unchanged): ${totalSkipped}`);
    }
    console.log(`Duration:            ${duration}s`);
    console.log(`${"=".repeat(50)}`);

    process.exit(0);
  } catch (err) {
    console.error("Ingestion failed:", err);
    process.exit(1);
  }
}

main();
