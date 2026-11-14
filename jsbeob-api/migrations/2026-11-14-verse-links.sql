-- 경전 문장 관련링크 (2026-11-14) — 경전 장 글의 '절' 블록 문장(위치 표시 ^1-1-3)에서
-- 다른 사이트 자료(소개·전각·자료실 글·다른 경전 문장)로 가는 연결.
-- AI 가 정기적으로 '제안(proposed)'을 만들고, 운영자가 승인(approved)·거절(rejected)한다.
-- jsbooks 의 위키링크·correspondences 를 DB 로 옮길 때도 같은 표를 쓴다(origin 으로 구분).
-- 지금은 표만 만든다 — 생성 작업·검토 화면·본문 표시는 다음 단계.
CREATE TABLE IF NOT EXISTS verse_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id      TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,  -- 경전 장 글
  anchor       TEXT NOT NULL,                       -- 그 장의 문장 위치 (예: 1-1-3)
  to_type      TEXT NOT NULL CHECK (to_type IN ('article','place','post')),
  to_id        TEXT NOT NULL,
  to_anchor    TEXT NOT NULL DEFAULT '',            -- 대상이 경전 장이면 문장 위치, 아니면 ''
  origin       TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai','manual','wikilink')),
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  score        REAL,                                -- AI 확신도(0~1)
  reason       TEXT,                                -- 제안 근거(짧게)
  model        TEXT,                                -- 제안한 모델·작업 이름
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  UNIQUE (from_id, anchor, to_type, to_id, to_anchor)
);
CREATE INDEX IF NOT EXISTS idx_verse_links_from ON verse_links (from_id, status);
CREATE INDEX IF NOT EXISTS idx_verse_links_to ON verse_links (to_type, to_id, status);
