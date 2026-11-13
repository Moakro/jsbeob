-- 옛 홈페이지(jsbeob.com, 그누보드) 게시판 글 보관함 — 읽기 전용. (2026-11-12)
-- (board, cid) 는 옛 주소 /_<board>/?cId=<cid> 와 같다 — 옛 주소를 보관함 글로 그대로 이어 줄 때 쓴다.
-- 작성자는 옛 별명을 글자로만 둔다(새 사이트 회원 계정과 잇지 않는다).
CREATE TABLE IF NOT EXISTS legacy_posts (
  board       TEXT NOT NULL,              -- 옛 게시판 모듈(ort, notice, servant, study)
  cid         INTEGER NOT NULL,           -- 옛 글 번호
  category    TEXT,                       -- 옛 분류(법종교소식 등)
  title       TEXT NOT NULL,
  author      TEXT,                       -- 옛 별명
  created_at  TEXT,                       -- 옛 작성 시각 'YYYY-MM-DD HH:MM' (한국 시간)
  hits        INTEGER NOT NULL DEFAULT 0, -- 옮길 때의 옛 조회수
  body_html   TEXT NOT NULL,              -- 옮길 때 허용 태그만 남긴 HTML
  comment_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board, cid)
);
CREATE INDEX IF NOT EXISTS idx_legacy_posts_list ON legacy_posts (board, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_posts_date ON legacy_posts (created_at DESC);

CREATE TABLE IF NOT EXISTS legacy_comments (
  board       TEXT NOT NULL,
  id          INTEGER NOT NULL,           -- 옛 댓글 번호
  post_cid    INTEGER NOT NULL,
  parent_id   INTEGER,                    -- 답댓글이면 위 댓글 번호
  author      TEXT,
  created_at  TEXT,
  body_html   TEXT NOT NULL,
  PRIMARY KEY (board, id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_comments_post ON legacy_comments (board, post_cid, id);
