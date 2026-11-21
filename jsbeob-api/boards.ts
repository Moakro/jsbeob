// 게시판(콘텐츠 묶음) 설정 — DB 표 boards 에서 읽는다 (2026-11-16 게시판 관리 1단계).
// 게시판마다 저장 형식·보기 형식·메뉴 위치, CRUD 권한(회원 등급), 블록별 권한을 둔다.
// 지금 동작(소식·오리알터·기타 자료·문의)은 migrations/2026-11-16-boards.sql 의 처음 값으로 그대로 옮겼다.
import { LEVEL } from "../src/data/levels";

/** 공식 콘텐츠(게시판 options.official) 글의 공개 글쓴이 이름 (2026-11-16 사용자 결정) */
export const OFFICIAL_AUTHOR = "JSBeob";

/** 비회원(로그인 안 함) — 읽기 권한에만 쓴다 */
export const GUEST_LEVEL = -1;

/** 게시판에서 쓸 수 있는 블록 종류(게시글 저장 형식) — 경전 '절'은 관리자 문서에서만 */
export const POST_BLOCK_TYPES = ["heading", "text", "quote", "image", "imageref", "video", "link", "map", "schedule"];

/** 글이 없는 기본 게시판 이름 — 표가 비었을 때(옛 DB)와 자료 링크 표시에 쓴다 */
export const BOARD_LABEL = {
  news: "소식",
  orialter: "오리알터",
  etc: "기타 자료",
  help: "문의"
};

/**
 * 바깥 집계(사이트 검색·자료 링크·역링크·최근 댓글)에서 빼는 게시판 — `board NOT IN (${PRIVATE_BOARDS_SQL})` 처럼 쓴다.
 * 비공개·회원 전용·숨김 게시판, 그리고 글마다 비공개를 고를 수 있는 게시판(options.private_posts, 문의)도 뺀다(2026-11-21).
 */
export const PRIVATE_BOARDS_SQL = `SELECT key FROM boards WHERE read_scope='own' OR read_level >= 0 OR status <> 'active' OR json_extract(options, '$.private_posts') = 1`;

const parseJson = (t, fallback) => {
  try {
    const v = JSON.parse(t ?? "");
    return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

export function shapeBoard(r) {
  const blocks = parseJson(r.blocks, {});
  // 블록 등급은 쓰기 등급보다 낮을 수 없다(낮게 저장돼 있어도 쓰기 등급으로 본다)
  for (const k of Object.keys(blocks)) {
    if (typeof blocks[k] !== "number") delete blocks[k];
    else if (blocks[k] < r.create_level) blocks[k] = r.create_level;
  }
  return {
    key: r.key,
    label: r.label,
    description: r.description ?? "",
    storage: r.storage,
    view: r.view,
    menu: r.menu,
    read_level: r.read_level,
    read_scope: r.read_scope,
    create_level: r.create_level,
    edit_own: r.edit_own === 1,
    edit_level: r.edit_level,
    delete_own: r.delete_own === 1,
    delete_level: r.delete_level,
    comment_level: r.comment_level ?? null,
    blocks,
    options: parseJson(r.options, {}),
    sort_order: r.sort_order,
    status: r.status,
    builtin: r.builtin === 1
  };
}

// isolate 안에서 잠깐(30초) 기억한다. 관리 화면에서 바꾸면 그 isolate 는 바로 비운다.
let cache = null;
let cacheAt = 0;
export async function loadBoards(db) {
  if (cache && Date.now() - cacheAt < 3e4) return cache;
  const rs = await db.prepare("SELECT * FROM boards ORDER BY sort_order, key").all();
  cache = new Map((rs.results ?? []).map((r) => [r.key, shapeBoard(r)]));
  cacheAt = Date.now();
  return cache;
}
export function invalidateBoards() {
  cache = null;
}
export async function getBoard(db, key) {
  return (await loadBoards(db)).get(key) ?? null;
}

const lv = (u) => (u ? u.level ?? 0 : GUEST_LEVEL);
const isAdmin = (u) => !!u && (u.level ?? 0) >= LEVEL.ADMIN;

/** 게시판 글 목록을 볼 수 있나(본인 글만 보는 게시판은 목록에서 따로 거른다) */
export function canReadBoard(b, u) {
  if (!b) return false;
  if (isAdmin(u)) return true;
  if (b.status !== "active") return false;
  return lv(u) >= b.read_level;
}
/** 이 글을 볼 수 있나 */
export function canSeePostIn(b, authorId, u) {
  if (!canReadBoard(b, u)) return false;
  if (b.read_scope !== "own" || isAdmin(u)) return true;
  return !!u && u.id === authorId;
}
/**
 * 글마다 비공개(2026-11-21) — 비공개 글의 제목·본문·닉네임·답변은 글쓴이와 관리자만 본다.
 */
export function canSeePrivatePost(authorId, u) {
  return isAdmin(u) || (!!u && u.id === authorId);
}
/**
 * 비공개 글 가리기(목록용) — 볼 수 없는 사람에게는 '비공개' 표시와 등록일시만 남긴다. shapePost 결과를 그 자리에서 고친다.
 */
export function maskPrivatePost(post, u) {
  if (!post?.is_private || canSeePrivatePost(post.author_id, u)) return post;
  post.title = "";
  post.locked = true;
  post.attachments = [];
  post.cover_image = null;
  post.view_count = 0;
  post.comment_count = 0;
  post.period = null;
  delete post.excerpt;
  delete post.last_comment;
  delete post.body_html;
  delete post.body_md;
  post.author = { display_name: null, avatar_url: null, affiliation: null, level: null, branch: null };
  post.author_id = null;
  return post;
}
/**
 * 비공개 전환 권한 — 글쓴이는 공개·비공개 모두, 관리자는 남의 글을 '비공개로'만(보호 목적).
 */
export function canSetPrivate(b, authorId, u, next) {
  if (!b?.options?.private_posts || !u) return false;
  if (u.id === authorId) return true;
  return isAdmin(u) && next === true;
}
export function canCreateIn(b, u) {
  if (!b || !u || b.storage !== "post") return false;
  if (isAdmin(u)) return true;
  return b.status === "active" && lv(u) >= b.create_level;
}
export function canEditIn(b, authorId, u) {
  if (!b || !u) return false;
  if (isAdmin(u)) return true;
  return (b.edit_own && u.id === authorId) || lv(u) >= b.edit_level;
}
export function canDeleteIn(b, authorId, u) {
  if (!b || !u) return false;
  if (isAdmin(u)) return true;
  return (b.delete_own && u.id === authorId) || lv(u) >= b.delete_level;
}
export function canCommentIn(b, u) {
  if (!b || !u) return false;
  if (b.comment_level === null || b.comment_level === undefined) return false;
  return isAdmin(u) || lv(u) >= b.comment_level;
}

/**
 * 공식 콘텐츠 게시판의 글쓴이 가리기 — 공개 글쓴이는 JSBeob.
 * 실제 등록자는 그 게시판의 남의 글 수정 권한이 있는 사람(관리자 포함)에게만 registered_by 로 준다.
 * shapePost 결과를 그 자리에서 고친다.
 */
export function maskOfficialAuthor(post, b, u) {
  if (!post || !b?.options?.official) return post;
  const privileged = isAdmin(u) || (!!u && lv(u) >= b.edit_level);
  const real = post.author?.display_name ?? null;
  post.author = { display_name: OFFICIAL_AUTHOR, avatar_url: null, affiliation: null, level: null, branch: null };
  if (privileged) post.registered_by = real ?? "회원";
  else if (!u || u.id !== post.author_id) post.author_id = null;
  return post;
}

/**
 * 블록 권한 검사. SNS(피드) 게시판은 블록 권한을 쓰지 않는다.
 * - 꺼진 블록은 누구도 새로 넣을 수 없다.
 * - 등급이 모자란 블록은 새로 넣거나 고치거나 지울 수 없다(이미 있던 블록은 그대로 남아야 한다).
 * 비교는 normalizeBlocks 결과끼리(같은 id 의 같은 내용) 한다.
 */
export function blockPermissionError(b, u, next, prev) {
  if (!b || b.view === "feed") return null;
  const level = isAdmin(u) ? Infinity : lv(u);
  const allowed = (type) => type in b.blocks && level >= b.blocks[type];
  const sig = (x) => JSON.stringify(x);
  const prevById = new Map<string, any>((prev ?? []).map((x) => [x.id, x]));
  const nextById = new Map(next.map((x) => [x.id, x]));
  for (const x of next) {
    if (allowed(x.type)) continue;
    const old = prevById.get(x.id);
    if (!old || old.type !== x.type || sig(old) !== sig(x)) {
      return x.type in b.blocks ? "이 게시판에서 그 블록을 쓸 권한이 없습니다" : "이 게시판에서 쓰지 않는 블록이 있습니다";
    }
  }
  for (const old of prev ?? []) {
    if (allowed(old.type) || !(old.type in b.blocks)) continue;
    if (!nextById.has(old.id)) return "권한이 없는 블록은 지울 수 없습니다";
  }
  return null;
}
