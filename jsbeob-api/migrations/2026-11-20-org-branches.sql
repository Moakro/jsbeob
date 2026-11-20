-- 기관(청장년회·여성회)을 소개 > 지부·분원 글 본문에서 branches 표(kind='기관')로 옮긴다 (2026-11-20).
-- 지부·분원과 같은 카드로 보이고 관리 화면 '지부·분원' 탭에서 고친다. 회원 소속·지도에는 쓰지 않는다(API 가 kind='기관' 을 거른다).
-- 스키마 변경 없음(kind 는 CHECK 없는 TEXT) — 데이터만.
-- 되돌리기: DELETE FROM branches WHERE code IN ('youth','women'); 본문은 content_revisions 또는 관리 화면에서 복원.
INSERT OR IGNORE INTO branches (code, kind, name, head_name, phone, sort_order, status)
VALUES
  ('youth', '기관', '청장년회', '김서동', '01073996979', (SELECT COALESCE(MAX(sort_order),0)+1 FROM branches), 'published'),
  ('women', '기관', '여성회',   '안영기', '01071296080', (SELECT COALESCE(MAX(sort_order),0)+2 FROM branches), 'published');

-- 본문이 기관 안내뿐일 때만 비운다(다른 내용이 더해졌으면 손대지 않음 — 관리 화면에서 직접 정리)
UPDATE articles
   SET body_html = '', body_md = '', body_blocks = '[]', updated_at = datetime('now')
 WHERE kind = 'branches'
   AND body_html LIKE '%청장년회장 : 김서동%'
   AND body_html LIKE '%여성회장 : 안영기%'
   AND length(body_html) < 600;
