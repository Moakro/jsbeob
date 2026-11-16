-- 회원 등급 값을 20 간격으로 바꾼다 (2026-11-16 사용자 결정 — src/data/levels.ts).
--   0 대기 → 0, 1 일반 → 20, 2 교인 → 40, 3 편집진 → 60, 4 운영자 → 100(관리자). 80 운영진은 새 등급.
-- 옛 값(1~4)인 행만 바꾸므로 두 번 실행해도 결과가 같다. 코드(levels.ts 사용)와 함께 반영해야 한다.
UPDATE users SET level = CASE level WHEN 1 THEN 20 WHEN 2 THEN 40 WHEN 3 THEN 60 WHEN 4 THEN 100 ELSE level END,
  updated_at = datetime('now')
WHERE level IN (1, 2, 3, 4);
