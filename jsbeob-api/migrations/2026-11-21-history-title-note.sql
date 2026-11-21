-- 소개 > 법종교 연혁 제목 줄 오른쪽 표기 (2026-11-21 사용자 지시) — meta.title_note
UPDATE articles
   SET meta = json_set(COALESCE(NULLIF(meta, ''), '{}'), '$.title_note', '(1937~1997)'), updated_at = datetime('now')
 WHERE section = 'about' AND slug = 'history';
