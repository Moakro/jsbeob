-- 오리알터 신고·숨김 (2026-11-28 오너 결정: 교인이 ＋ 버튼으로 바로 게시 + 신고·숨김)
-- 글·댓글 신고 — 로그인 회원만, 이유는 선택, 한 사람이 같은 대상에 한 번(UNIQUE).
-- 숨김은 따로 칸을 두지 않고 posts.status / comments.status 의 'hidden' 을 쓴다(원래 있던 값).
--   숨김 글은 글쓴이·관리자에게만 보인다(피드·글 주소·공유 미리보기·검색·지도에서 빠짐).
-- 관리자가 처리하면 그 대상의 열린 신고를 모두 닫는다(resolution: hidden|restored|kept).
-- 예전 댓글 신고 표(flags)는 그대로 둔다(화면에서 쓰지 않음).
-- 되돌리기: DROP TABLE reports; DROP INDEX idx_posts_author_board_created;
--          (숨긴 글은 UPDATE posts SET status='published' WHERE status='hidden'; 로 되살린다)
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,                       -- post|comment
  target_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL DEFAULT '',            -- 선택(빈 값 가능), 500자까지
  status      TEXT NOT NULL DEFAULT 'open',        -- open|resolved
  resolution  TEXT,                                -- hidden|restored|kept
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_type, target_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports(status, target_type, target_id);

-- 하루 게시 수 상한(오리알터 20개) 검사용
CREATE INDEX IF NOT EXISTS idx_posts_author_board_created ON posts(author_id, board, created_at);
