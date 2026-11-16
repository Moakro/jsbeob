-- 달력 일정 ↔ 글의 일정 블록 번호 (2026-11-16) — 달력·다가오는 날에서 누른 일정 카드로 바로 이동하려고.
-- 한 글에 일정 블록이 여러 개일 수 있어 글 id 만으로는 어느 일정인지 모른다.
-- 되돌리기: ALTER TABLE events DROP COLUMN source_block_id;
ALTER TABLE events ADD COLUMN source_block_id TEXT;
-- 이미 있는 일정: 글의 일정 블록이 하나뿐이면 그 블록 번호를 채운다(여러 개면 다음 저장 때 채워진다)
UPDATE events SET source_block_id = (
  SELECT json_extract(j.value, '$.id') FROM posts p, json_each(p.body_blocks) j
   WHERE p.id = events.source_post_id AND json_extract(j.value, '$.type') = 'schedule')
WHERE source_post_id IS NOT NULL AND source_block_id IS NULL
  AND (SELECT COUNT(*) FROM posts p, json_each(p.body_blocks) j
        WHERE p.id = events.source_post_id AND json_extract(j.value, '$.type') = 'schedule') = 1;
