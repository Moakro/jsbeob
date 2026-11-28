-- 법종교 간행·관련 도서 세 권 표시 + 처음 순서 (2026-11-28 오너 결정) — 2026-11-28-library-bjg.sql 다음에 적용.
-- 순서: 화은당실기 → 증산법종교 60년사 → 상제님 유서. 이후 순서는 관리 화면(자료실 → 도서)에서 바꾼다.
-- status·내용은 바꾸지 않는다. 다시 실행해도 같은 결과.
UPDATE articles SET bjg=1, sort_order=1 WHERE section='library' AND parent_id IS NULL AND slug='hwaeundang-silgi';
UPDATE articles SET bjg=1, sort_order=2 WHERE section='library' AND parent_id IS NULL AND slug='증산법종교-60년사';
UPDATE articles SET bjg=1, sort_order=3 WHERE section='library' AND parent_id IS NULL AND slug='상제님-유서';
