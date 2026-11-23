-- 조회수: 같은 사람은 하루 한 번만 (2026-11-23)
-- viewer = 'u:<회원 id>' 또는 'b:<브라우저 쿠키 jb_vid>', day = 한국 날짜(YYYY-MM-DD). 지난 날짜 기록은 API 가 가끔 지운다.
-- 되돌리기: DROP TABLE post_views;
CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (post_id, viewer, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_post_views_day ON post_views(day);
