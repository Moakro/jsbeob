-- 2026-11-28 지도 태그: 앞에 구분선과 테마 자료 글
-- sep_before: 1 = 지도 칩 줄에서 이 칩 앞에 구분선 (칩 순서는 sort_order 그대로)
-- theme_post_id: 칩을 누르면 서랍에 장소 카드 대신 이 자료 글(posts.id) 하나를 띄운다(비우면 지금처럼 장소 카드)
ALTER TABLE tags ADD COLUMN sep_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN theme_post_id TEXT;
