PRAGMA foreign_keys = ON;

CREATE TABLE reference_sources (
  id TEXT PRIMARY KEY,
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  source_version TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  corpus_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE reference_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  heading TEXT NOT NULL,
  section_path_json TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,
  corpus_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES reference_sources(id) ON DELETE CASCADE
);

CREATE INDEX reference_chunks_source_index ON reference_chunks(source_id, chunk_index);
CREATE INDEX reference_chunks_corpus_index ON reference_chunks(corpus_version);

CREATE TABLE diagnosis_reference_runs (
  id TEXT PRIMARY KEY,
  diagnosis_id TEXT NOT NULL UNIQUE,
  question_hash TEXT NOT NULL,
  retrieval_query TEXT NOT NULL,
  retrieval_version TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  index_version TEXT NOT NULL,
  corpus_version TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  selected_count INTEGER NOT NULL,
  retrieval_status TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (diagnosis_id) REFERENCES ai_diagnoses(id) ON DELETE CASCADE
);

CREATE TABLE diagnosis_reference_citations (
  id TEXT PRIMARY KEY,
  retrieval_run_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  similarity_score REAL NOT NULL,
  rerank_score REAL NOT NULL,
  citation_status TEXT NOT NULL,
  citation_reason TEXT NOT NULL,
  frozen_publisher TEXT NOT NULL,
  frozen_category TEXT NOT NULL,
  frozen_title TEXT NOT NULL,
  frozen_url TEXT NOT NULL,
  frozen_heading TEXT NOT NULL,
  frozen_excerpt TEXT NOT NULL,
  frozen_content_hash TEXT NOT NULL,
  frozen_source_version TEXT,
  frozen_source_retrieved_at TEXT NOT NULL,
  frozen_corpus_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (retrieval_run_id) REFERENCES diagnosis_reference_runs(id) ON DELETE CASCADE
);

CREATE INDEX diagnosis_reference_citations_run_rank ON diagnosis_reference_citations(retrieval_run_id, rank);
