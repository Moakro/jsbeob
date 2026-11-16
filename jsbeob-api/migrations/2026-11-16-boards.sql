-- 게시판(콘텐츠 묶음) 설정 표 — 게시판 관리 1단계 (2026-11-16)
-- 등급 값은 src/data/levels.ts (대기 0 · 일반 20 · 교인 40 · 편집진 60 · 운영진 80 · 관리자 100), 비회원 = -1.
-- 처음 값은 바꾸기 전 코드의 동작 그대로다:
--   소식: 누구나 읽기, 관리자만 쓰기·수정·삭제, 공지 고정, 일정 블록
--   오리알터: 누구나 읽기, 교인 이상 쓰기, 본인 수정·삭제, SNS 피드(블록 권한 없음), 제목 생략 가능
--   기타 자료: 누구나 읽기, 관리자만 쓰기·수정·삭제 (자료실 아래)
--   문의: 본인 글만 읽기, 일반 이상 쓰기, 본인 수정·삭제
--   댓글: 모두 닉네임만 있으면(등급 0 이상) 쓸 수 있었다
--   공식 콘텐츠(options.official): 소식·기타 자료 — 공개 글쓴이 'JSBeob', 실제 등록자는 권한자에게만 (2026-11-16)
-- 되돌리기: DROP TABLE boards; (코드도 함께 되돌려야 한다)
CREATE TABLE IF NOT EXISTS boards (
  key           TEXT PRIMARY KEY,                -- 주소 이름(/community/<key>/) — 만든 뒤 바꾸지 않는다
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  storage       TEXT NOT NULL DEFAULT 'post' CHECK (storage IN ('post', 'article', 'place')),  -- 저장 형식
  view          TEXT NOT NULL DEFAULT 'list' CHECK (view IN ('list', 'feed', 'doc', 'book')),   -- 보기 형식
  menu          TEXT NOT NULL DEFAULT 'community' CHECK (menu IN ('community', 'archive', 'about', 'jeongak')),
  read_level    INTEGER NOT NULL DEFAULT -1,     -- -1 = 비회원도
  read_scope    TEXT NOT NULL DEFAULT 'all' CHECK (read_scope IN ('all', 'own')),  -- own = 본인 글만(관리자는 전부)
  create_level  INTEGER NOT NULL DEFAULT 20,
  edit_own      INTEGER NOT NULL DEFAULT 1,      -- 1 = 본인 글 수정 가능
  edit_level    INTEGER NOT NULL DEFAULT 100,    -- 남의 글 수정 등급
  delete_own    INTEGER NOT NULL DEFAULT 1,
  delete_level  INTEGER NOT NULL DEFAULT 100,
  comment_level INTEGER,                         -- NULL = 댓글 안 씀
  blocks        TEXT NOT NULL DEFAULT '{}',      -- JSON {블록 종류: 최소 등급} — 없는 종류는 사용 안 함
  options       TEXT NOT NULL DEFAULT '{}',      -- JSON {notice: 공지 고정, title_optional: 제목 생략}
  sort_order    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  builtin       INTEGER NOT NULL DEFAULT 0,      -- 1 = 처음부터 있던 게시판(삭제·형식 변경 불가)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO boards (key, label, description, storage, view, menu, read_level, read_scope, create_level,
  edit_own, edit_level, delete_own, delete_level, comment_level, blocks, options, sort_order, builtin) VALUES
('orialter', '오리알터', '도생들이 나누는 사진과 이야기', 'post', 'feed', 'community', -1, 'all', 40,
  1, 100, 1, 100, 0, '{}', '{"title_optional":true,"photo":true}', 10, 1),
('news', '소식', '법종교 공지와 소식', 'post', 'list', 'community', -1, 'all', 100,
  0, 100, 0, 100, 0,
  '{"heading":100,"text":100,"quote":100,"image":100,"imageref":100,"video":100,"link":100,"map":100,"schedule":100}',
  '{"notice":true,"official":true}', 20, 1),
('etc', '기타 자료', '그 밖의 자료', 'post', 'list', 'archive', -1, 'all', 100,
  0, 100, 0, 100, 0,
  '{"heading":100,"text":100,"quote":100,"image":100,"imageref":100,"video":100,"link":100,"map":100}',
  '{"official":true}', 30, 1),
('help', '문의', '문의와 제안 — 글쓴이와 운영자만 봅니다', 'post', 'list', 'community', 0, 'own', 20,
  1, 100, 1, 100, 0,
  '{"heading":20,"text":20,"quote":20,"image":20,"imageref":20,"video":20,"link":20,"map":20}',
  '{}', 40, 1);
