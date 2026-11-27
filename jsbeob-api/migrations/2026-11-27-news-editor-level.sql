-- 소식 게시판: 편집진(60)이 글쓰기·블록까지 (2026-11-27 결정 2, docs/design/ai-intake.md)
-- 공지 고정(notice)은 관리자 권한으로 남긴다(API 가 등급을 검사). 남의 글 수정·삭제 등급(edit/delete_level)은 그대로 100.
-- 운영 DB 에는 오너 승인 뒤 --remote 로 적용한다.
-- 되돌리기: UPDATE boards SET create_level=100, blocks='{"heading":100,"text":100,"quote":100,"image":100,"imageref":100,"video":100,"link":100,"map":100,"schedule":100}', updated_at=datetime('now') WHERE key='news';
UPDATE boards
   SET create_level = 60,
       blocks = (SELECT json_group_object(j.key, CASE WHEN j.value > 60 THEN 60 ELSE j.value END) FROM json_each(boards.blocks) AS j),
       updated_at = datetime('now')
 WHERE key = 'news';
