-- 되돌리기: 2026-11-16-user-levels.sql 이전 값으로 (운영진 80 은 옛 체계에 없어 편집진 3 으로 내린다)
UPDATE users SET level = CASE level WHEN 20 THEN 1 WHEN 40 THEN 2 WHEN 60 THEN 3 WHEN 80 THEN 3 WHEN 100 THEN 4 ELSE level END,
  updated_at = datetime('now')
WHERE level IN (20, 40, 60, 80, 100);
