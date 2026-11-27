-- 소식 게시판: 글쓴이 본인 글 수정 허용 (2026-11-27 오너 지시 "본인 글 수정 열어줘")
-- 편집진(60)이 쓴 소식 글을 본인이 고칠 수 있게 한다. 글쓰기 등급(create_level=60)과 함께 쓰인다.
-- 남의 글 수정(edit_level)·삭제(delete_own/delete_level)는 그대로 둔다.
-- 2026-11-27-news-editor-level.sql 다음에 적용. 운영 DB 에는 오너 승인 뒤 --remote 로 적용한다.
-- 되돌리기: UPDATE boards SET edit_own=0, updated_at=datetime('now') WHERE key='news';
UPDATE boards
   SET edit_own = 1,
       updated_at = datetime('now')
 WHERE key = 'news';
