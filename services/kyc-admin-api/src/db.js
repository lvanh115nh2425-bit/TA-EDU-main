const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM, 10) || 768;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function query(sql, params) {
  return pool.query(sql, params);
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      uid VARCHAR(128) PRIMARY KEY,
      email VARCHAR(255),
      display_name VARCHAR(255),
      full_name VARCHAR(255),
      gender VARCHAR(16),
      photo_url TEXT,
      role VARCHAR(32),
      trust_points INTEGER NOT NULL DEFAULT 100,
      trust_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_trust_recovery_at TIMESTAMP WITH TIME ZONE,
      verify_status VARCHAR(32) DEFAULT 'unverified',
      verify_note TEXT,
      submitted_at TIMESTAMP WITH TIME ZONE,
      reviewed_at TIMESTAMP WITH TIME ZONE,
      student_grade VARCHAR(32),
      student_dob VARCHAR(32),
      student_phone VARCHAR(32),
      student_address TEXT,
      parent_name VARCHAR(255),
      parent_email VARCHAR(255),
      parent_phone VARCHAR(32),
      tutor_subjects TEXT[],
      tutor_levels TEXT[],
      tutor_bio TEXT,
      tutor_cccd VARCHAR(64),
      tutor_dob VARCHAR(32),
      kyc_cccd_front TEXT,
      kyc_cccd_back TEXT,
      kyc_selfie TEXT,
      kyc_certificates JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
  `);

  await query(`
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS gender VARCHAR(16);
  `);

  await query(`
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS trust_points INTEGER NOT NULL DEFAULT 100;
  `);

  await query(`
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS trust_history JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS last_trust_recovery_at TIMESTAMP WITH TIME ZONE;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS kyc_requests (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(128),
      full_name VARCHAR(255),
      email VARCHAR(255),
      role VARCHAR(64),
      status VARCHAR(32) DEFAULT 'submitted',
      note TEXT,
      payload JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_reports (
      id SERIAL PRIMARY KEY,
      reporter_id VARCHAR(128),
      reporter_name VARCHAR(255),
      reporter_email VARCHAR(255),
      reported_id VARCHAR(128),
      reported_name VARCHAR(255),
      reported_email VARCHAR(255),
      category VARCHAR(64),
      reason TEXT,
      content TEXT,
      evidence_urls TEXT[],
      status VARCHAR(32) DEFAULT 'submitted',
      note TEXT,
      payload JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'kyc_requests_user_id_key'
      ) THEN
        ALTER TABLE kyc_requests
        ADD CONSTRAINT kyc_requests_user_id_key UNIQUE (user_id);
      END IF;
    END$$;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS qa_posts (
      id SERIAL PRIMARY KEY,
      user_uid VARCHAR(128),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT[],
      author_name VARCHAR(255),
      author_avatar TEXT,
      author_role VARCHAR(128),
      image_url TEXT,
      image_urls TEXT[],
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`ALTER TABLE qa_posts ADD COLUMN IF NOT EXISTS image_url TEXT;`);
  await query(`ALTER TABLE qa_posts ADD COLUMN IF NOT EXISTS image_urls TEXT[];`);

  await query(`
    CREATE TABLE IF NOT EXISTS qa_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES qa_posts(id) ON DELETE CASCADE,
      parent_comment_id INTEGER REFERENCES qa_comments(id) ON DELETE CASCADE,
      user_uid VARCHAR(128),
      content TEXT NOT NULL,
      image_url TEXT,
      image_urls TEXT[],
      author_name VARCHAR(255),
      author_avatar TEXT,
      author_role VARCHAR(128),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE qa_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id INTEGER REFERENCES qa_comments(id) ON DELETE CASCADE;
  `);

  await query(`
    ALTER TABLE qa_comments
    ADD COLUMN IF NOT EXISTS image_url TEXT;
  `);

  await query(`
    ALTER TABLE qa_comments
    ADD COLUMN IF NOT EXISTS image_urls TEXT[];
  `);

  await query(`
    UPDATE qa_posts
    SET image_urls = ARRAY[image_url]
    WHERE image_url IS NOT NULL
      AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);
  `);

  await query(`
    UPDATE qa_comments
    SET image_urls = ARRAY[image_url]
    WHERE image_url IS NOT NULL
      AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS qa_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES qa_posts(id) ON DELETE CASCADE,
      user_uid VARCHAR(128) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (post_id, user_uid)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inbox_conversations (
      id SERIAL PRIMARY KEY,
      user_a_uid VARCHAR(128) NOT NULL,
      user_b_uid VARCHAR(128) NOT NULL,
      last_message_preview TEXT,
      pinned_by_a BOOLEAN NOT NULL DEFAULT FALSE,
      pinned_by_b BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CHECK (user_a_uid <> user_b_uid)
    );
  `);

  await query(`
    ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS last_message_preview TEXT;
  `);

  await query(`
    ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS pinned_by_a BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS pinned_by_b BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_conversations_pair
    ON inbox_conversations (
      LEAST(user_a_uid, user_b_uid),
      GREATEST(user_a_uid, user_b_uid)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_inbox_conversations_updated_at
    ON inbox_conversations(updated_at DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      sender_uid VARCHAR(128) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      read_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_inbox_messages_conversation_created
    ON inbox_messages(conversation_id, created_at ASC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_inbox_messages_unread
    ON inbox_messages(conversation_id, read_at)
    WHERE read_at IS NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS kyc_audit_logs (
      id SERIAL PRIMARY KEY,
      request_id INTEGER REFERENCES kyc_requests(id) ON DELETE CASCADE,
      admin_id INTEGER,
      admin_username VARCHAR(128),
      action VARCHAR(64),
      previous_status VARCHAR(32),
      next_status VARCHAR(32),
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_kyc_audit_request_id ON kyc_audit_logs(request_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS report_audit_logs (
      id SERIAL PRIMARY KEY,
      report_id INTEGER REFERENCES user_reports(id) ON DELETE CASCADE,
      admin_id INTEGER,
      admin_username VARCHAR(128),
      action VARCHAR(64),
      previous_status VARCHAR(32),
      next_status VARCHAR(32),
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_report_audit_report_id ON report_audit_logs(report_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS timetables (
      user_uid VARCHAR(128) PRIMARY KEY,
      week JSONB NOT NULL DEFAULT '{}'::jsonb,
      share_enabled BOOLEAN NOT NULL DEFAULT false,
      share_code VARCHAR(32),
      deadlines JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE timetables
    ADD COLUMN IF NOT EXISTS deadlines JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_timetables_share_code
    ON timetables(share_code)
    WHERE share_code IS NOT NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS legal_knowledge (
      id SERIAL PRIMARY KEY,
      law_name VARCHAR(255) NOT NULL,
      chapter TEXT,
      article_name VARCHAR(255),
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM});`);

  // Handle embedding dimension change (e.g. 768→384 when switching providers)
  try {
    const { rows: dimCheck } = await query(`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'legal_knowledge'::regclass AND attname = 'embedding'
    `);
    if (dimCheck.length > 0 && dimCheck[0].atttypmod !== EMBEDDING_DIM) {
      console.log(`[DB] Embedding dimension changed to ${EMBEDDING_DIM}, recreating column...`);
      await query(`DROP INDEX IF EXISTS idx_legal_embedding;`);
      await query(`ALTER TABLE legal_knowledge DROP COLUMN embedding;`);
      await query(`ALTER TABLE legal_knowledge ADD COLUMN embedding vector(${EMBEDDING_DIM});`);
      console.warn(`[DB] ⚠ All embeddings cleared — re-run ingestion to regenerate.`);
    }
  } catch (dimErr) {
    console.warn(`[DB] Could not check embedding dimension:`, dimErr.message);
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_legal_embedding ON legal_knowledge USING hnsw (embedding vector_cosine_ops);`);
  console.log(`[DB] Embedding dimension: ${EMBEDDING_DIM}`);

  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 1;`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS law_number VARCHAR(64);`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS law_year VARCHAR(4);`);
  await query(`ALTER TABLE legal_knowledge ADD COLUMN IF NOT EXISTS chunking_method VARCHAR(20) DEFAULT 'character';`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_upsert_key ON legal_knowledge(law_name, article_name, chunk_index);`);

  await query(`
    CREATE TABLE IF NOT EXISTS legal_consultations (
      id SERIAL PRIMARY KEY,
      user_uid VARCHAR(128),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      context_ids INTEGER[],
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_legal_consult_user ON legal_consultations(user_uid);`);
  await query(`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS confidence_score REAL;`);
  await query(`ALTER TABLE legal_consultations ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_legal_consult_session ON legal_consultations(session_id);`);

  // ── Exam Knowledge (KTPL RAG) ──────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS exam_knowledge (
      id SERIAL PRIMARY KEY,
      source_name VARCHAR(255) NOT NULL,
      grade VARCHAR(4) NOT NULL,
      textbook_set VARCHAR(64),
      chapter TEXT,
      section_title VARCHAR(512),
      content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIM}),
      chunk_index INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 1,
      content_hash VARCHAR(64),
      chunking_method VARCHAR(20) DEFAULT 'semantic',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Handle embedding dimension change for exam_knowledge
  try {
    const { rows: examDimCheck } = await query(`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'exam_knowledge'::regclass AND attname = 'embedding'
    `);
    if (examDimCheck.length > 0 && examDimCheck[0].atttypmod !== EMBEDDING_DIM) {
      console.log(`[DB] exam_knowledge embedding dimension changed to ${EMBEDDING_DIM}, recreating column...`);
      await query(`DROP INDEX IF EXISTS idx_exam_knowledge_embedding;`);
      await query(`ALTER TABLE exam_knowledge DROP COLUMN embedding;`);
      await query(`ALTER TABLE exam_knowledge ADD COLUMN embedding vector(${EMBEDDING_DIM});`);
      console.warn(`[DB] ⚠ All exam_knowledge embeddings cleared — re-run ingestion to regenerate.`);
    }
  } catch (dimErr) {
    console.warn(`[DB] Could not check exam_knowledge embedding dimension:`, dimErr.message);
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_embedding ON exam_knowledge USING hnsw (embedding vector_cosine_ops);`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_knowledge_upsert ON exam_knowledge(source_name, section_title, chunk_index);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_grade ON exam_knowledge(grade);`);

  // lesson_name + section_type for exercise builder
  await query(`ALTER TABLE exam_knowledge ADD COLUMN IF NOT EXISTS lesson_name VARCHAR(512);`);
  await query(`ALTER TABLE exam_knowledge ADD COLUMN IF NOT EXISTS section_type VARCHAR(32) DEFAULT 'content';`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_lesson ON exam_knowledge(grade, lesson_name);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_section_type ON exam_knowledge(section_type);`);

  // ── Exam Templates ─────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS exam_templates (
      id SERIAL PRIMARY KEY,
      grade VARCHAR(4) NOT NULL,
      exam_type VARCHAR(32) NOT NULL,
      raw_content TEXT NOT NULL,
      mc_example JSONB,
      tf_example JSONB,
      essay_example JSONB,
      answer_key JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(grade, exam_type)
    );
  `);

  // ── Exam Generations ───────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS exam_generations (
      id SERIAL PRIMARY KEY,
      user_uid VARCHAR(128),
      grade VARCHAR(4),
      topic TEXT,
      difficulty VARCHAR(32),
      generated_exam JSONB,
      context_ids INTEGER[],
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

async function ensureDefaultAdmin() {
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

  const existing = await query("SELECT id FROM admins WHERE username = $1", [username]);
  if (existing.rowCount > 0) return;

  const hash = await bcrypt.hash(password, 10);
  await query(
    "INSERT INTO admins (username, password_hash) VALUES ($1, $2)",
    [username, hash]
  );
  console.log(`Seeded default admin '${username}'`);
}

function mapKycRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    note: row.note,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reporterEmail: row.reporter_email,
    reportedId: row.reported_id,
    reportedName: row.reported_name,
    reportedEmail: row.reported_email,
    category: row.category,
    reason: row.reason,
    content: row.content,
    evidenceUrls: row.evidence_urls || [],
    status: row.status,
    note: row.note,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  pool,
  query,
  ensureSchema,
  ensureDefaultAdmin,
  mapKycRow,
  mapReportRow,
};
