-- 지부·분원 표 — 관리 화면(지부·분원 탭)에서 편집하고, 소개 > 지부·분원 페이지와 지도(지부·분원 버튼)에 쓴다.
-- code 는 회원 소속(member_profiles.branch)이 참조하므로 한번 정하면 바꾸지 않는다.
-- 처음 18곳은 src/data/branches.ts 와 같은 코드·이름·순서로 넣는다(주소·연락처는 관리 화면에서 채움).
CREATE TABLE IF NOT EXISTS branches (
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

INSERT OR IGNORE INTO branches (code, kind, name, sort_order) VALUES
  ('jungbu', '지부', '중부 지부', 1),
  ('seoul', '지부', '서울 지부', 2),
  ('daegu', '지부', '대구 지부', 3),
  ('andong', '지부', '안동 지부', 4),
  ('miryang', '지부', '밀양 지부', 5),
  ('taebaek', '지부', '태백 지부', 6),
  ('pohang', '지부', '포항 지부', 7),
  ('uiseong', '지부', '의성 지부', 8),
  ('danyang', '지부', '단양 지부', 9),
  ('hwacheon', '지부', '화천 지부', 10),
  ('yeongju', '지부', '영주 지부', 11),
  ('seosan', '지부', '서산 지부', 12),
  ('changnyeong', '지부', '창녕 지부', 13),
  ('daejeon', '분원', '대전 분원', 14),
  ('busan', '분원', '부산 분원', 15),
  ('chuncheon', '분원', '춘천 분원', 16),
  ('jinju', '분원', '진주 분원', 17),
  ('ulsan', '분원', '울산 분원', 18);
