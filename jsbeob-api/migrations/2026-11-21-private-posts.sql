-- 글마다 비공개(문의 게시판 공개 전환) — 2026-11-21
-- 게시판 options.private_posts 가 켜진 게시판은 글쓴이가 글마다 비공개를 고를 수 있다(기본 공개).
-- 비공개 글은 글쓴이·관리자만 본문·제목·닉네임·답변을 본다. 다른 사람에게는 '비공개' 배지와 등록일시만.
-- private_posts 게시판은 사이트 검색·자료 링크·역링크·최근 댓글 등 바깥 집계에서는 계속 뺀다(PRIVATE_BOARDS_SQL).
-- 되돌리기: UPDATE boards SET read_level=0, read_scope='own', options=json_remove(options,'$.private_posts') WHERE key='help';
--          (is_private 칸은 그대로 두어도 된다)
ALTER TABLE posts ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;

-- 지금까지의 문의 글은 '글쓴이와 운영자만'으로 썼으므로 비공개로 남긴다
UPDATE posts SET is_private = 1 WHERE board = 'help';

-- 문의: 본인 글만 → 누구나(비회원도) 목록을 보고, 글마다 비공개
UPDATE boards
   SET read_level = -1,
       read_scope = 'all',
       description = '문의와 제안 — 비공개로 쓰면 글쓴이와 운영자만 봅니다',
       options = json_set(COALESCE(NULLIF(options, ''), '{}'), '$.private_posts', json('true')),
       updated_at = datetime('now')
 WHERE key = 'help';
