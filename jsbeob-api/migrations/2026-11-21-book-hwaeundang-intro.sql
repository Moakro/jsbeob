-- 화은당실기 표지 정보 (2026-11-21) — 소개 문구는 jsbooks.wiki 서재(WikiHome 카드)에서 가져옴(사용자 지시).
--   summary: 책 소개, meta.byline: 표지 한 줄(편술·간행), 본문의 '편자:' 줄은 byline 과 겹쳐 비운다.
-- 되돌리기: 관리 화면에서 소개·본문을 다시 쓰거나 summary=NULL, meta 에서 byline 제거.
UPDATE articles
   SET summary = '정사 김병철이 1960년에 편술한 증산법종교 연혁사. 강증산의 따님 화은당(華恩堂) 강순임의 일대기와 6기초공사 과정을 8장으로 정리. 1989년 법종사 김대수가 재간행.',
       meta = json_set(COALESCE(NULLIF(meta, ''), '{}'), '$.byline', '정사 김병철(金炳徹) 편술 · 1960년 초간 / 1989년 재간'),
       body_html = '', body_md = '', body_blocks = '[]',
       updated_at = datetime('now')
 WHERE section = 'library' AND slug = 'hwaeundang-silgi' AND parent_id IS NULL;
