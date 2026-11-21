-- 옛 글 보관함 순번·개수 미리 계산 (2026-11-21) — 글을 열 때마다 표 전체를 세던 질의(COUNT·GROUP BY)가
-- 하루 D1 읽기 한도를 넘겼다(jsbeob.com 이전 뒤 옛 주소로 크롤러 유입). 보관함은 바뀌지 않는 데이터라 한 번 계산해 둔다.
--   seq_board: 게시판 안 최신순 순번(1부터), seq_cat: 게시판·분류 안 최신순 순번
--   legacy_counts: 게시판·분류별 글 수
-- 옛 글을 다시 옮겨 넣으면 이 파일을 다시 실행해야 한다(아래 UPDATE·INSERT 는 몇 번 실행해도 같은 결과).
-- 되돌리기: DROP TABLE legacy_counts; (칸은 그대로 두어도 된다. 코드도 함께 되돌려야 한다)
ALTER TABLE legacy_posts ADD COLUMN seq_board INTEGER;
ALTER TABLE legacy_posts ADD COLUMN seq_cat INTEGER;

UPDATE legacy_posts
   SET seq_board = x.rb, seq_cat = x.rc
  FROM (SELECT board AS b, cid AS c,
               ROW_NUMBER() OVER (PARTITION BY board ORDER BY created_at DESC, cid DESC) AS rb,
               ROW_NUMBER() OVER (PARTITION BY board, category ORDER BY created_at DESC, cid DESC) AS rc
          FROM legacy_posts) AS x
 WHERE x.b = legacy_posts.board AND x.c = legacy_posts.cid;

CREATE INDEX IF NOT EXISTS idx_legacy_posts_seq_board ON legacy_posts (board, seq_board);
CREATE INDEX IF NOT EXISTS idx_legacy_posts_seq_cat ON legacy_posts (board, category, seq_cat);

CREATE TABLE IF NOT EXISTS legacy_counts (
  board    TEXT NOT NULL,
  category TEXT,
  n        INTEGER NOT NULL
);
DELETE FROM legacy_counts;
INSERT INTO legacy_counts (board, category, n) SELECT board, category, COUNT(*) FROM legacy_posts GROUP BY board, category;
