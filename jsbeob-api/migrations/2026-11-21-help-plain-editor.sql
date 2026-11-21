-- 문의 게시판은 블록 편집기 대신 일반 글쓰기 폼(글 상자 하나) — 2026-11-21
-- 게시판 옵션 options.plain_editor. 관리 화면 '게시판 관리 > 기타'에서 켜고 끌 수 있다.
-- 되돌리기: UPDATE boards SET options=json_remove(options,'$.plain_editor') WHERE key='help';
UPDATE boards
   SET options = json_set(COALESCE(NULLIF(options, ''), '{}'), '$.plain_editor', json('true')),
       updated_at = datetime('now')
 WHERE key = 'help';
