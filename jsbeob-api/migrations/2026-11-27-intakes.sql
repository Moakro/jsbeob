-- 편집진 '＋ 올리기' 0단계 — 올림함 기록 표 (2026-11-27, docs/design/ai-intake.md 4.2)
-- 원본은 R2 jsbeob-uploads 의 비공개 접두어 intake/<연>/<월>/<id>/<순번>.<확장자> (/api/files 로는 나가지 않음).
-- AI 칸(kind~output_tokens)은 1단계에서 채운다. 0단계에서는 비어 있다.
-- 되돌리기: DROP TABLE intakes;
CREATE TABLE IF NOT EXISTS intakes (
  id            TEXT PRIMARY KEY,                    -- uuid
  user_id       TEXT NOT NULL REFERENCES users(id),  -- 올린 사람
  status        TEXT NOT NULL DEFAULT 'uploaded',    -- uploaded | extracting | ready | failed | published | discarded
  source        TEXT NOT NULL DEFAULT 'web',         -- web | app | share (어디서 올렸나)
  hint          TEXT,                                -- 올릴 때 고른 종류(event_notice | photos | document, 없으면 자동)
  note          TEXT,                                -- 메모·붙여 넣은 글
  url           TEXT,                                -- 함께 적은 인터넷 주소(열어 보지 않음)
  files         TEXT NOT NULL DEFAULT '[]',          -- JSON [{key, name, content_type, size, sha256}]
  file_hash     TEXT,                                -- 파일 전체의 해시(같은 것 다시 올림 감지)
  idem_key      TEXT,                                -- Idempotency-Key 머리말(재전송 안전)
  -- 아래는 1단계(AI)부터 채움
  kind          TEXT,                                -- event_notice | photos | document | unknown
  title         TEXT,
  model         TEXT,
  extracted     TEXT,
  draft_blocks  TEXT,
  warnings      TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  -- 결과
  post_id       TEXT,                                -- 만든 글
  event_ids     TEXT,                                -- '달력만'으로 만든 일정 id JSON (1단계)
  handled_by    TEXT,                                -- 게시·버림 처리한 사람
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  purge_after   TEXT,                                -- 원본 삭제 예정(올린 날 + 1년)
  purged_at     TEXT                                 -- 원본을 지운 때(버림·1년 만료)
);
CREATE INDEX IF NOT EXISTS idx_intakes_status ON intakes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_intakes_hash ON intakes(file_hash);
CREATE INDEX IF NOT EXISTS idx_intakes_user ON intakes(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intakes_idem ON intakes(user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intakes_purge ON intakes(purge_after) WHERE purged_at IS NULL;
