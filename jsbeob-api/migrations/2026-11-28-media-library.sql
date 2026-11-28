-- 공용 자료실(GenMedia assets-shared/library) → 사진 창고(media) 가져오기 (2026-11-28, 자료실 설계 6절)
-- library_id     : 자료실 id(L2611-7k3q 등). 이 값이 곧 '보낸 기록' 대응표다(자료실 사이드카는 고치지 않음).
-- library_sha256 : 자료실 색인의 원본 파일 해시 — 파일이 바뀌었는지 판정(media.sha256 은 보낸 웹용 파생본 해시)
-- license_code   : 자료실 license.code (PD·CC-BY-SA·KOGL-3 …) — 화면 배지·표기용. 사람이 읽는 표기는 credit 끝에.
-- 동기화 도구: scripts/library-sync.mjs, API: jsbeob-api/library-sync.ts (LIBRARY_SYNC_TOKEN 전용)
-- 되돌리기: DROP INDEX idx_media_library; ALTER TABLE media DROP COLUMN license_code;
--          ALTER TABLE media DROP COLUMN library_sha256; ALTER TABLE media DROP COLUMN library_id;
ALTER TABLE media ADD COLUMN library_id TEXT;
ALTER TABLE media ADD COLUMN library_sha256 TEXT;
ALTER TABLE media ADD COLUMN license_code TEXT;
CREATE INDEX IF NOT EXISTS idx_media_library ON media(library_id);
