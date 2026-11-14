-- jsbeob-db 스키마 — 2026-11-01 운영 D1(jsbeob-db)에서 'wrangler d1 export --no-data'로 받은 그대로.
-- 새 DB: npx wrangler d1 execute jsbeob-db --local --file=schema.sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                 -- internal UUID
  provider      TEXT,                             -- 'kakao' | 'google' (마지막 로그인 수단)
  google_id     TEXT UNIQUE,                      -- google "sub" claim (nullable)
  kakao_id      TEXT UNIQUE,                      -- kakao user id (nullable)
  email         TEXT,                             -- 이메일 (프로바이더가 줄 때만, 비공개)
  google_name   TEXT,                             -- 프로바이더 제공 실명/닉네임 (NEVER expose)
  display_name  TEXT,                             -- nickname, NULL until set
  avatar_url    TEXT,
  affiliation   TEXT,                             -- 단체 자가 표시 (선택)
  level         INTEGER NOT NULL DEFAULT 0,       -- 0=대기, 1=일반, 2=검증, 3=큐레이터, 4=운영자
  is_seed       INTEGER NOT NULL DEFAULT 0,       -- 1=운영자 시드 계정 (콘텐츠 누적용 가짜 회원)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);
CREATE TABLE display_name_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  old_name    TEXT,
  new_name    TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE posts (
  id            TEXT PRIMARY KEY,                  -- UUID
  board         TEXT NOT NULL,
  category      TEXT,                              -- 보드 내 세부 분류 (선택)
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL,                     -- 마크다운 원본
  body_html     TEXT NOT NULL,                     -- 서버 sanitized HTML 캐시
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attachments   TEXT,                              -- JSON 첨부 (이미지/유튜브)
  cover_image   TEXT,                              -- 갤러리 썸네일 (attachments 첫 이미지 캐시)
  view_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  is_pinned     INTEGER NOT NULL DEFAULT 0,        -- 공지 상단 고정 (L≥4)
  status        TEXT NOT NULL DEFAULT 'published', -- published|hidden|deleted
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
, body_blocks TEXT, series_id TEXT REFERENCES series(id));
CREATE TABLE comments (
  id                  TEXT PRIMARY KEY,                  -- UUID
  target_type         TEXT NOT NULL,
  target_id           TEXT NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id),
  parent_id           TEXT REFERENCES comments(id),      -- 답글 (NULL 이면 루트)
  body                TEXT NOT NULL,                     -- 마크다운 원본
  body_html           TEXT NOT NULL,                     -- 서버 sanitized HTML
  type                TEXT NOT NULL,                     -- memo|question|cross|cite
  status              TEXT NOT NULL DEFAULT 'published', -- published|hidden|deleted
  attachments         TEXT,                              -- JSON: [{type:'image',url,width?,height?},{type:'map',lat,lng,zoom?,label?}]
  is_pinned           INTEGER NOT NULL DEFAULT 0,        -- 운영자 고정 (L≥4)
  promoted_to_note_id TEXT,                              -- footnote id (`uc-YYYY-MM-DD-N`) when 운영자가 자료 주석으로 승격함
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE user_uploaded_photos (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash         TEXT NOT NULL,
  url          TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, hash)
);
CREATE TABLE reactions (
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                     -- helpful (확장 여지)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id, type)
);
CREATE TABLE flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',      -- open|reviewing|resolved|rejected
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE nickname_review_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id),
  nickname       TEXT NOT NULL,
  ai_risk_score  INTEGER,                        -- 0..10 (Phase 2)
  ai_reason      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE user_visits (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scripture_slug TEXT NOT NULL,
  chapter_anchor TEXT NOT NULL,   -- "vol-chap" (예: "2-3") · 평면 경전은 "0"
  last_visited   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, scripture_slug, chapter_anchor)
);
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  start_date  TEXT NOT NULL,                        -- 'YYYY-MM-DD' (양력 or 음력, is_lunar 기준)
  end_date    TEXT,                                 -- NULL → 단일 일자
  all_day     INTEGER NOT NULL DEFAULT 1,           -- (deprecated, kept for compat)
  category    TEXT,                                 -- 기념일·일정·기타
  is_annual   INTEGER NOT NULL DEFAULT 0,           -- 매년 반복
  is_lunar    INTEGER NOT NULL DEFAULT 0,           -- 음력 기준
  is_public   INTEGER NOT NULL DEFAULT 0,           -- 사이트 전체 공개
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, source_post_id TEXT);
CREATE TABLE news (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,                              -- notice|update|release|roadmap
  body_md      TEXT NOT NULL,
  body_html    TEXT NOT NULL DEFAULT '',
  summary      TEXT,
  draft        INTEGER NOT NULL DEFAULT 0,                 -- 0=published, 1=draft
  pinned       INTEGER NOT NULL DEFAULT 0,                 -- 1=리스트 상단 고정
  published_at TEXT,                                       -- ISO 'YYYY-MM-DDTHH:MM:SSZ' (draft 면 NULL)
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE member_profiles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  branch      TEXT NOT NULL,                      -- 지부·분원 코드 (src/data/branches.ts)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, real_name TEXT);
CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  sha256       TEXT NOT NULL UNIQUE,           -- 같은 사진 중복 업로드 방지
  content_type TEXT NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL,
  alt          TEXT,                           -- 대체 텍스트
  caption      TEXT,                           -- 기본 설명
  credit       TEXT,                           -- 촬영자·출처
  taken_at     TEXT,                           -- 촬영 시기('1985', '1990년대' 등 자유 형식)
  source_url   TEXT,                           -- 구사이트·피카사 원본 주소(이관 추적)
  uploaded_by  TEXT REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'active', -- active|deleted
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE articles (
  id            TEXT PRIMARY KEY,
  section       TEXT NOT NULL,       -- about | library
  kind          TEXT NOT NULL,       -- about: person|doctrine|history|org|branches|anthem|directions|overview
                                     -- library: book|mantra|ritual|etc
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  title_hanja   TEXT,
  summary       TEXT,
  body_md       TEXT NOT NULL DEFAULT '',
  body_html     TEXT NOT NULL DEFAULT '',  -- 서버 렌더 캐시
  hero_media_id TEXT REFERENCES media(id),
  meta          TEXT,                -- JSON. 종류별 보조 필드(인물: birth, aliases)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|published|hidden
  published_at  TEXT,
  created_by    TEXT REFERENCES users(id),
  updated_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')), body_blocks TEXT, thumb_media_id TEXT REFERENCES media(id), thumb_crop TEXT, pinned INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, parent_id TEXT REFERENCES articles(id),
  UNIQUE (section, slug)
);
CREATE TABLE places (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,          -- jeongak | landmark | branch | etc
  name            TEXT NOT NULL,
  name_hanja      TEXT,
  summary         TEXT,
  body_md         TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  built           TEXT,                   -- 건립 시기
  lat             REAL,
  lng             REAL,
  location_hidden INTEGER NOT NULL DEFAULT 0,  -- 1 = 위치 비공개·미상
  geojson         TEXT,                   -- 선택: 구역·경로 등
  branch_code     TEXT,                   -- 선택: 지부 위치일 때 src/data/branches.ts 코드
  hero_media_id   TEXT REFERENCES media(id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft',
  created_by      TEXT REFERENCES users(id),
  updated_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, body_blocks TEXT, thumb_media_id TEXT REFERENCES media(id), thumb_crop TEXT);
CREATE TABLE media_links (
  owner_type TEXT NOT NULL,          -- article | place
  owner_id   TEXT NOT NULL,
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'gallery',
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption    TEXT,                   -- 이 자리에서만 쓰는 설명(없으면 media.caption)
  PRIMARY KEY (owner_type, owner_id, media_id)
);
CREATE TABLE content_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,          -- article | place
  owner_id   TEXT NOT NULL,
  action     TEXT NOT NULL DEFAULT 'update',  -- update | delete
  snapshot   TEXT NOT NULL,          -- JSON
  edited_by  TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE content_refs (
  from_type  TEXT NOT NULL,          -- article | place | post
  from_id    TEXT NOT NULL,
  block_id   TEXT NOT NULL,
  to_type    TEXT NOT NULL,          -- article | place | post
  to_id      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_type, from_id, block_id)
);
CREATE TABLE map_points (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- jeongak | branch | affiliated (법종교) / sacred | general (외부)
  name        TEXT NOT NULL,
  name_hanja  TEXT,
  summary     TEXT,                   -- 지도 카드 짧은 설명
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  place_id    TEXT UNIQUE REFERENCES places(id) ON DELETE SET NULL,  -- 연결된 전각 자료(선택)
  branch_code TEXT,                   -- 지부·분원이면 src/data/branches.ts 코드(선택)
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | published | hidden
  created_by  TEXT REFERENCES users(id),
  updated_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#7A8592',
  icon        TEXT NOT NULL DEFAULT 'pin',   -- src/lib/map-categories.ts TAG_ICONS 의 key
  description TEXT,
  on_map      INTEGER NOT NULL DEFAULT 0,    -- 1 = 지도 버튼으로 보임(지도용 태그)
  sort_order  INTEGER NOT NULL DEFAULT 0,    -- 지도 버튼 순서
  status      TEXT NOT NULL DEFAULT 'active', -- active | hidden
  created_by  TEXT REFERENCES users(id),
  updated_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tag_links (
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  owner_type  TEXT NOT NULL,                 -- point | article | place
  owner_id    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,    -- 태그 안 순서
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tag_id, owner_type, owner_id)
);
CREATE TABLE home_tiles (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  href         TEXT NOT NULL,
  media_id     TEXT REFERENCES media(id),
  glyph        TEXT,                        -- 사진이 없을 때 타일 글자(예: 甑山)
  count_source TEXT,
  count_unit   TEXT,                        -- 개수 뒤에 붙는 말(곳·분·편)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active', -- active | hidden
  updated_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE media_videos (
  video_id   TEXT PRIMARY KEY,          -- 유튜브 영상 id(11자)
  featured   INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE home_hero (
  slot       TEXT PRIMARY KEY,                     -- 'mobile'
  media_id   TEXT NOT NULL REFERENCES media(id),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE library_categories (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('article', 'post')),
  list_order  TEXT NOT NULL DEFAULT 'alpha' CHECK (list_order IN ('alpha', 'toc', 'recent')),
  as_book     INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, place TEXT NOT NULL DEFAULT 'main' CHECK (place IN ('main', 'side')), intro TEXT);
CREATE TABLE series (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_display_name ON users(display_name);
CREATE INDEX idx_dnh_user ON display_name_history(user_id);
CREATE INDEX idx_posts_board ON posts(board, status, is_pinned DESC, created_at DESC);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_cover ON posts(status, cover_image, created_at DESC);
CREATE INDEX idx_comments_target ON comments(target_type, target_id, status, created_at);
CREATE INDEX idx_comments_user ON comments(user_id, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_pinned ON comments(target_type, target_id, is_pinned, created_at);
CREATE INDEX idx_comments_promoted ON comments(promoted_to_note_id);
CREATE INDEX idx_reactions_comment ON reactions(comment_id, type);
CREATE INDEX idx_flags_comment ON flags(comment_id);
CREATE INDEX idx_flags_status ON flags(status);
CREATE INDEX idx_nickname_queue_status ON nickname_review_queue(status, created_at);
CREATE INDEX idx_user_visits_user
  ON user_visits(user_id, scripture_slug);
CREATE INDEX idx_events_user_month ON events(user_id, start_date);
CREATE INDEX idx_events_public_month ON events(is_public, start_date) WHERE is_public = 1;
CREATE INDEX idx_events_user_annual ON events(user_id, is_annual) WHERE is_annual = 1;
CREATE INDEX idx_news_published ON news(draft, published_at DESC);
CREATE INDEX idx_news_category ON news(category, published_at DESC);
CREATE INDEX idx_news_pinned ON news(pinned DESC, published_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_member_profiles_branch ON member_profiles(branch);
CREATE INDEX idx_media_status ON media(status, created_at DESC);
CREATE INDEX idx_articles_list ON articles(section, kind, status, sort_order);
CREATE INDEX idx_places_list ON places(kind, status, sort_order);
CREATE INDEX idx_media_links_media ON media_links(media_id);
CREATE INDEX idx_revisions_owner ON content_revisions(owner_type, owner_id, created_at DESC);
CREATE INDEX idx_content_refs_to ON content_refs(to_type, to_id);
CREATE INDEX idx_map_points_list ON map_points(status, kind, sort_order);
CREATE INDEX idx_tag_links_owner ON tag_links(owner_type, owner_id);
CREATE INDEX idx_posts_lib ON posts(board, category, status, created_at DESC);
CREATE INDEX idx_posts_series ON posts(series_id, status, created_at);
CREATE INDEX idx_events_source_post ON events(source_post_id);
CREATE INDEX idx_articles_parent ON articles(parent_id, sort_order);
-- 2026-11-06 지부·분원 (migrations/2026-11-06-branches.sql — 처음 18곳 시드는 그 파일에)
CREATE TABLE branches (
  code           TEXT PRIMARY KEY,               -- 영문 소문자·숫자·- (예: seoul)
  kind           TEXT NOT NULL,                  -- 지부 | 분원
  name           TEXT NOT NULL,                  -- 예: 서울 지부
  head_name      TEXT,                           -- 지부장·분원장
  phone          TEXT,                           -- 숫자만 (표시할 때 하이픈)
  postcode       TEXT,                           -- 우편번호(카카오 우편번호 서비스)
  address        TEXT,                           -- 도로명(또는 지번) 주소
  address_detail TEXT,                           -- 상세 주소(동·호 등)
  lat            REAL,
  lng            REAL,
  photo_media_id TEXT REFERENCES media(id),
  map_point_id   TEXT,                           -- 자동으로 맞추는 지도 장소(map_points.id)
  sort_order     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'published', -- published | draft | hidden
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 옛 홈페이지(jsbeob.com, 그누보드) 게시판 글 보관함 — 읽기 전용. (2026-11-12)
-- (board, cid) 는 옛 주소 /_<board>/?cId=<cid> 와 같다 — 옛 주소를 보관함 글로 그대로 이어 줄 때 쓴다.
-- 작성자는 옛 별명을 글자로만 둔다(새 사이트 회원 계정과 잇지 않는다).
CREATE TABLE IF NOT EXISTS legacy_posts (
  board       TEXT NOT NULL,              -- 옛 게시판 모듈(ort, notice, servant, study)
  cid         INTEGER NOT NULL,           -- 옛 글 번호
  category    TEXT,                       -- 옛 분류(법종교소식 등)
  title       TEXT NOT NULL,
  author      TEXT,                       -- 옛 별명
  created_at  TEXT,                       -- 옛 작성 시각 'YYYY-MM-DD HH:MM' (한국 시간)
  hits        INTEGER NOT NULL DEFAULT 0, -- 옮길 때의 옛 조회수
  body_html   TEXT NOT NULL,              -- 옮길 때 허용 태그만 남긴 HTML
  comment_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board, cid)
);
CREATE INDEX IF NOT EXISTS idx_legacy_posts_list ON legacy_posts (board, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_posts_date ON legacy_posts (created_at DESC);

CREATE TABLE IF NOT EXISTS legacy_comments (
  board       TEXT NOT NULL,
  id          INTEGER NOT NULL,           -- 옛 댓글 번호
  post_cid    INTEGER NOT NULL,
  parent_id   INTEGER,                    -- 답댓글이면 위 댓글 번호
  author      TEXT,
  created_at  TEXT,
  body_html   TEXT NOT NULL,
  PRIMARY KEY (board, id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_comments_post ON legacy_comments (board, post_cid, id);

-- 경전 문장 관련링크 (2026-11-14) — migrations/2026-11-14-verse-links.sql 과 같다
CREATE TABLE IF NOT EXISTS verse_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id      TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,  -- 경전 장 글
  anchor       TEXT NOT NULL,                       -- 그 장의 문장 위치 (예: 1-1-3)
  to_type      TEXT NOT NULL CHECK (to_type IN ('article','place','post')),
  to_id        TEXT NOT NULL,
  to_anchor    TEXT NOT NULL DEFAULT '',            -- 대상이 경전 장이면 문장 위치, 아니면 ''
  origin       TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai','manual','wikilink')),
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  score        REAL,
  reason       TEXT,
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  UNIQUE (from_id, anchor, to_type, to_id, to_anchor)
);
CREATE INDEX IF NOT EXISTS idx_verse_links_from ON verse_links (from_id, status);
CREATE INDEX IF NOT EXISTS idx_verse_links_to ON verse_links (to_type, to_id, status);
