-- 자료실 책 '법종교 간행·관련' 표시 (2026-11-28 오너 결정)
-- 도서 목록에서 이 표시가 켜진 책을 위에 묶어 먼저 보이고(순서 = sort_order, 관리 화면에서 끌어서 정함),
-- 나머지 책은 가나다순. '고정(pinned)'과는 별개 칸이다.
-- 관리 화면 저장(PUT /api/admin/content/books/order)은 bjg·sort_order 만 바꾸고 status 는 건드리지 않는다.
-- 글 편집기 저장(adminSave)은 이 칸을 건드리지 않는다(UPDATE 목록에 없음).
-- 되돌리기: ALTER TABLE articles DROP COLUMN bjg;
ALTER TABLE articles ADD COLUMN bjg INTEGER NOT NULL DEFAULT 0;
