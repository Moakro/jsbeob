/**
 * jsbeob API worker — 인증·게시판·댓글·달력·소식·업로드 + 자료실/자료/미디어 하위 라우터.
 *
 * 사이트 Worker(jsbeob)가 service binding(env.API)으로 호출한다.
 * 라우트 전체 목록은 아래 fetch 핸들러를 본다. 하위 라우터:
 *   /api/library/*            — library.ts (handleLibrary)
 *   /api/content/*, /api/admin/content/* 등 — content.ts (handleContent)
 *   /api/media/*              — media.ts (handleMedia)
 *
 * Session: signed JWT in HttpOnly cookie (`jb_session`).
 * SameSite=Lax, Secure, ~30 day expiry. JWT signing uses HS256 with AUTH_SECRET.
 */

export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // 카카오 OAuth — REST API 키(= client_id). 보안 강화(client secret) 사용 시 KAKAO_CLIENT_SECRET 설정.
  KAKAO_REST_API_KEY: string;
  KAKAO_CLIENT_SECRET?: string;
  AUTH_SECRET: string; // any 32+ char random string
  SITE_ORIGIN: string;
  UPLOADS_PUBLIC_BASE: string;
  MEDIA_PUBLIC_BASE?: string;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_CHANNEL_ID?: string;
}

// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
import { ALLOWED_BOARDS, BOARD_MIN_LEVEL, OPERATOR_BOARDS, PRIVATE_BOARDS, PRIVATE_BOARDS_SQL, TITLE_OPTIONAL_BOARDS } from "./boards";
import { LIBRARY_BOARD, handleLibrary, normLibraryPostFields } from "./library";
import { BlockError, allKeys, allPointIds, blocksForEditor, imageItems, normalizeBlocks, parseStoredBlocks, plainFromBlocks, resolveBlocks, s } from "./blocks";
import { handleContent, mediaUrl, refIndexStmts, renderRowBlocks, siteHosts } from "./content";
import { handleMedia } from "./media";
import { branchCodeSet, handleBranches } from "./branch";
import { handleLegacy } from "./legacy";

const COOKIE_NAME = "jb_session";
const SESSION_TTL = 60 * 60 * 24 * 30;
const NICKNAME_RESERVED = [
  // 운영자
  "관리자",
  "admin",
  "운영자",
  "moakro",
  "system",
  "support",
  // 단체명 부분 매치
  "본부",
  "공식",
  "총무",
  "총회",
  "회장",
  "교주",
  // 교리적 권위
  "상제",
  "강증산",
  "미륵",
  "미륵존불",
  "옥황",
  "옥황상제",
  "대선생",
  "진인",
  "성인",
  "도주"
];
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      const libRes = await handleLibrary(req, env, path, {
        adminUser: async (r) => {
          const uid = await currentUserId(r, env);
          if (!uid) return null;
          const u = await loadUser(env, uid);
          return u && u.level >= 4 ? { id: u.id, level: u.level } : null;
        }
      });
      if (libRes) return libRes;
      const branchRes = await handleBranches(req, env, path, {
        adminUser: async (r) => {
          const uid = await currentUserId(r, env);
          if (!uid) return null;
          const u = await loadUser(env, uid);
          return u && u.level >= 4 ? { id: u.id, level: u.level } : null;
        }
      });
      if (branchRes) return branchRes;
      // 옛 홈페이지 보관함 (읽기 전용, 2026-11-12)
      const legacyRes = await handleLegacy(req, env, path);
      if (legacyRes) return legacyRes;
      const contentRes = await handleContent(req, env, path, {
        adminUser: async (r) => {
          const uid = await currentUserId(r, env);
          if (!uid) return null;
          const u = await loadUser(env, uid);
          return u && u.level >= 4 ? { id: u.id, level: u.level } : null;
        },
        // 지부 코드는 branches 표에서(관리 화면에서 추가한 지부 포함) — 필요할 때만 읽는다
        branchCodes: () => branchCodeSet(env)
      });
      if (contentRes) return contentRes;
      const mediaRes = await handleMedia(req, env, path, {
        adminUser: async (r) => {
          const uid = await currentUserId(r, env);
          if (!uid) return null;
          const u = await loadUser(env, uid);
          return u && u.level >= 4 ? { id: u.id, level: u.level } : null;
        }
      });
      if (mediaRes) return mediaRes;
      if (path === "/api/auth/login") return loginStart(req, env);
      if (path === "/api/auth/callback/google") return loginCallback(req, env);
      if (path === "/api/auth/callback/kakao") return loginCallbackKakao(req, env);
      if (path === "/api/auth/logout") return logout();
      if (path === "/api/posts" && req.method === "GET") return listPosts(req, env);
      if (path === "/api/posts" && req.method === "POST") return createPost(req, env);
      if (path === "/api/posts/authors" && req.method === "GET") return listPostAuthors(req, env);
      const pm = path.match(/^\/api\/posts\/([^/]+)(?:\/(pin))?$/);
      if (pm) {
        const id = pm[1];
        const sub = pm[2];
        if (sub === "pin" && req.method === "POST") return pinPost(req, env, id);
        if (req.method === "GET") return getPost(req, env, id);
        if (req.method === "PATCH") return updatePost(req, env, id);
        if (req.method === "DELETE") return deletePost(req, env, id);
      }
      if (path === "/api/me") return getMe(req, env);
      if (path === "/api/me/nickname") return setNickname(req, env);
      if (path === "/api/admin/users" && req.method === "GET") return adminListUsers(req, env);
      const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userMatch && req.method === "PATCH") return adminUpdateUser(req, env, decodeURIComponent(userMatch[1]));
      if (path === "/api/admin/comments" && req.method === "GET") return adminListComments(req, env);
      const promoteMatch = path.match(/^\/api\/admin\/comments\/([^/]+)\/promote$/);
      if (promoteMatch && req.method === "POST") return adminPromoteComment(req, env, promoteMatch[1]);
      if (path === "/api/upload/image" && req.method === "POST") return uploadImage(req, env);
      if (path === "/api/comments" && req.method === "GET") return listComments(req, env);
      if (path === "/api/comments" && req.method === "POST") return createComment(req, env);
      if (path === "/api/comments/counts" && req.method === "GET") return countComments(req, env);
      if (path === "/api/comments/verse-feed" && req.method === "GET") return verseFeed(req, env);
      if (path === "/api/comments/recent" && req.method === "GET") return recentFeed(req, env);
      if (path === "/api/comments/mine" && req.method === "GET") return mineFeed(req, env);
      const m = path.match(/^\/api\/comments\/([^/]+)(?:\/(react|flag|pin))?$/);
      if (m) {
        const id = m[1];
        const sub = m[2];
        if (sub === "react" && req.method === "POST") return toggleReaction(req, env, id);
        if (sub === "flag" && req.method === "POST") return flagComment(req, env, id);
        if (sub === "pin" && req.method === "POST") return pinComment(req, env, id);
        if (req.method === "PATCH") return editComment(req, env, id);
        if (req.method === "DELETE") return deleteComment(req, env, id);
      }
      if (path === "/api/upload/check" && req.method === "POST") return checkUpload(req, env);
      if (path === "/api/visits/touch" && req.method === "POST") return touchVisit(req, env);
      if (path === "/api/visits/badges" && req.method === "GET") return visitsBadges(req, env);
      if (path === "/api/events" && req.method === "GET") return listEvents(req, env);
      if (path === "/api/events" && req.method === "POST") return createEvent(req, env);
      const evMatch = path.match(/^\/api\/events\/([^/]+)$/);
      if (evMatch) {
        const id = evMatch[1];
        if (req.method === "PUT") return updateEvent(req, env, id);
        if (req.method === "DELETE") return deleteEvent(req, env, id);
      }
      if (path === "/api/news" && req.method === "GET") return listNews(req, env);
      if (path === "/api/news" && req.method === "POST") return createNews(req, env);
      const newsMatch = path.match(/^\/api\/news\/([^/]+)$/);
      if (newsMatch) {
        let idOrSlug;
        try {
          idOrSlug = decodeURIComponent(newsMatch[1]);
        } catch {
          idOrSlug = newsMatch[1];
        }
        if (req.method === "GET") return getNews(req, env, idOrSlug);
        if (req.method === "PUT") return updateNews(req, env, idOrSlug);
        if (req.method === "DELETE") return deleteNews(req, env, idOrSlug);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "server error", detail: msg }, 500);
    }
  }
};
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...headers
    }
  });
}
function uuid() {
  return crypto.randomUUID();
}
function getCookie(req, name) {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name) return v ?? null;
  }
  return null;
}
function setCookieHeader(name, value, ttlSeconds) {
  const attrs = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`
  ];
  return attrs.join("; ");
}
function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function hmacVerify(secret, data, expected) {
  const sig = await hmacSign(secret, data);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(t) {
  return btoa(unescape(encodeURIComponent(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeText(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - s.length % 4);
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}
async function signSession(secret, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const head = b64urlText(JSON.stringify(header));
  const body = b64urlText(JSON.stringify(payload));
  const data = `${head}.${body}`;
  const sig = await hmacSign(secret, data);
  return `${data}.${sig}`;
}
async function verifySession(secret, token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  if (!await hmacVerify(secret, data, s)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeText(p));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1e3)) return null;
  return payload;
}
async function currentUserId(req, env) {
  const sess = await verifySession(env.AUTH_SECRET, getCookie(req, COOKIE_NAME));
  return sess?.sub ?? null;
}
async function loadUser(env, userId) {
  await env.DB.prepare(
    "UPDATE users SET last_seen_at=datetime('now') WHERE id=?"
  ).bind(userId).run();
  return env.DB.prepare(
    "SELECT id, google_id, email, display_name, avatar_url, affiliation, level FROM users WHERE id=?"
  ).bind(userId).first();
}
async function loginStart(req, env) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/";
  const provider = url.searchParams.get("provider") === "google" ? "google" : "kakao";
  const state = `${uuid()}.${b64urlText(next)}`;
  let auth;
  if (provider === "kakao") {
    auth = new URL("https://kauth.kakao.com/oauth/authorize");
    auth.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
    auth.searchParams.set("redirect_uri", `${env.SITE_ORIGIN}/api/auth/callback/kakao`);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("state", state);
    auth.searchParams.set("scope", "profile_nickname profile_image");
  } else {
    auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    auth.searchParams.set("redirect_uri", `${env.SITE_ORIGIN}/api/auth/callback/google`);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "openid email profile");
    auth.searchParams.set("state", state);
    auth.searchParams.set("access_type", "online");
    auth.searchParams.set("prompt", "select_account");
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      "Set-Cookie": setCookieHeader("jb_oauth_state", state, 600)
    }
  });
}
function resolveNext(state, needsNickname) {
  let nextPath = "/";
  const dot = state.indexOf(".");
  if (dot > 0) {
    try {
      nextPath = b64urlDecodeText(state.slice(dot + 1)) || "/";
    } catch {
    }
    if (!nextPath.startsWith("/")) nextPath = "/";
  }
  if (needsNickname) {
    nextPath = `/account/nickname?next=${encodeURIComponent(nextPath)}`;
  }
  return nextPath;
}
async function loginCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = getCookie(req, "jb_oauth_state");
  if (!code || !state || state !== stored) {
    return json({ error: "invalid state" }, 400);
  }
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.SITE_ORIGIN}/api/auth/callback/google`,
      grant_type: "authorization_code"
    })
  });
  if (!tokRes.ok) {
    const t = await tokRes.text();
    return json({ error: "token exchange failed", detail: t }, 400);
  }
  const tok = await tokRes.json();
  if (!tok.id_token) return json({ error: "no id_token" }, 400);
  const idParts = tok.id_token.split(".");
  if (idParts.length !== 3) return json({ error: "bad id_token" }, 400);
  let claims;
  try {
    claims = JSON.parse(b64urlDecodeText(idParts[1]));
  } catch {
    return json({ error: "bad id_token claims" }, 400);
  }
  const existing = await env.DB.prepare(
    "SELECT id, display_name FROM users WHERE google_id=?"
  ).bind(claims.sub).first();
  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET provider='google', email=?, google_name=?, avatar_url=?, last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?"
    ).bind(claims.email, claims.name, claims.picture ?? null, userId).run();
  } else {
    userId = uuid();
    await env.DB.prepare(
      `INSERT INTO users (id, provider, google_id, email, google_name, avatar_url, last_seen_at)
       VALUES (?, 'google', ?, ?, ?, ?, datetime('now'))`
    ).bind(userId, claims.sub, claims.email, claims.name, claims.picture ?? null).run();
  }
  return issueSessionRedirect(env, userId, false, state);
}
async function loginCallbackKakao(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = getCookie(req, "jb_oauth_state");
  if (!code || !state || state !== stored) {
    return json({ error: "invalid state" }, 400);
  }
  const body = {
    grant_type: "authorization_code",
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: `${env.SITE_ORIGIN}/api/auth/callback/kakao`,
    code
  };
  if (env.KAKAO_CLIENT_SECRET) body.client_secret = env.KAKAO_CLIENT_SECRET;
  const tokRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(body)
  });
  if (!tokRes.ok) {
    const t = await tokRes.text();
    return json({ error: "token exchange failed", detail: t }, 400);
  }
  const tok = await tokRes.json();
  if (!tok.access_token) return json({ error: "no access_token" }, 400);
  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${tok.access_token}` }
  });
  if (!meRes.ok) {
    const t = await meRes.text();
    return json({ error: "profile fetch failed", detail: t }, 400);
  }
  const me = await meRes.json();
  const kakaoId = String(me.id);
  const acct = me.kakao_account ?? {};
  const nickname = acct.profile?.nickname ?? null;
  const avatar = acct.profile?.profile_image_url ?? null;
  const email = acct.email ?? null;
  const existing = await env.DB.prepare(
    "SELECT id, display_name FROM users WHERE kakao_id=?"
  ).bind(kakaoId).first();
  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET provider='kakao', email=?, google_name=?, avatar_url=?, last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?"
    ).bind(email, nickname, avatar, userId).run();
  } else {
    userId = uuid();
    await env.DB.prepare(
      `INSERT INTO users (id, provider, kakao_id, email, google_name, avatar_url, last_seen_at)
       VALUES (?, 'kakao', ?, ?, ?, ?, datetime('now'))`
    ).bind(userId, kakaoId, email, nickname, avatar).run();
  }
  return issueSessionRedirect(env, userId, false, state);
}
async function issueSessionRedirect(env, userId, needsNickname, state) {
  const now = Math.floor(Date.now() / 1e3);
  const session = await signSession(env.AUTH_SECRET, {
    sub: userId,
    iat: now,
    exp: now + SESSION_TTL
  });
  const nextPath = resolveNext(state, needsNickname);
  const headers = new Headers({ Location: `${env.SITE_ORIGIN}${nextPath}` });
  headers.append("Set-Cookie", setCookieHeader(COOKIE_NAME, session, SESSION_TTL));
  headers.append("Set-Cookie", clearCookieHeader("jb_oauth_state"));
  return new Response(null, { status: 302, headers });
}
function logout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookieHeader(COOKIE_NAME)
    }
  });
}
async function getMe(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ user: null });
  const u = await loadUser(env, uid);
  if (!u) return json({ user: null });
  const mp = await env.DB.prepare("SELECT branch, real_name FROM member_profiles WHERE user_id=?").bind(uid).first();
  return json({
    user: {
      id: u.id,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      affiliation: u.affiliation,
      level: u.level,
      needs_nickname: !u.display_name,
      member: mp ? { branch: mp.branch, real_name: mp.real_name ?? "" } : null
    }
  });
}
async function setNickname(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({}));
  const hasMember = Object.prototype.hasOwnProperty.call(body, "member");
  const memberBranch = body.member ? String(body.member.branch ?? "") : null;
  const memberRealName = body.member ? String(body.member.real_name ?? "").trim().replace(/\s+/g, " ") : null;
  if (hasMember && body.member) {
    if (!memberRealName || memberRealName.length < 2 || memberRealName.length > 20 || !/^[\p{L} ]+$/u.test(memberRealName)) {
      return json({ error: "실명을 확인해 주세요 (2~20자, 문자만)" }, 400);
    }
    if (!(await branchCodeSet(env)).has(memberBranch)) {
      return json({ error: "지부/분원을 선택해 주세요" }, 400);
    }
  }
  const nickname = (body.nickname ?? "").trim();
  if (nickname.length < 2 || nickname.length > 24) {
    return json({ error: "닉네임은 2~24자여야 합니다" }, 400);
  }
  if (!/^[\p{L}\p{N}_\- .]+$/u.test(nickname)) {
    return json({ error: "허용되지 않는 문자가 포함되어 있습니다" }, 400);
  }
  const lower = nickname.toLowerCase();
  if (NICKNAME_RESERVED.some((r) => lower.includes(r.toLowerCase()))) {
    return json({ error: "운영자·단체명·교리적 권위를 유추할 수 있는 닉네임입니다" }, 400);
  }
  const old = await env.DB.prepare("SELECT display_name FROM users WHERE id=?").bind(uid).first();
  const oldName = old?.display_name ?? null;
  await env.DB.prepare(
    "UPDATE users SET display_name=?, affiliation=?, level=MAX(level, 1), updated_at=datetime('now') WHERE id=?"
  ).bind(nickname, body.affiliation ?? null, uid).run();
  if (oldName !== nickname) {
    await env.DB.prepare(
      "INSERT INTO display_name_history (user_id, old_name, new_name) VALUES (?, ?, ?)"
    ).bind(uid, oldName, nickname).run();
  }
  if (hasMember) {
    if (memberBranch) {
      await env.DB.prepare(
        `INSERT INTO member_profiles (user_id, branch, real_name) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET branch=excluded.branch, real_name=excluded.real_name, updated_at=datetime('now')`
      ).bind(uid, memberBranch, memberRealName).run();
    } else {
      await env.DB.prepare("DELETE FROM member_profiles WHERE user_id=?").bind(uid).run();
    }
  }
  return json({ ok: true });
}
const USER_LEVEL_MIN = 0;
const USER_LEVEL_MAX = 4;
async function adminListUsers(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const rs = await env.DB.prepare(
    `
    SELECT
      u.id,
      u.created_at,
      u.provider,
      u.avatar_url,
      u.display_name,
      u.email,
      u.level,
      u.is_seed,
      u.last_seen_at,
      (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published') AS posts_count,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.status = 'published') AS comments_count,
      (SELECT COUNT(*) FROM flags f
         JOIN comments c ON c.id = f.comment_id
        WHERE c.user_id = u.id AND f.status = 'open') AS flags_received,
      mp.branch AS member_branch,
      mp.real_name AS member_real_name
    FROM users u
    LEFT JOIN member_profiles mp ON mp.user_id = u.id
    ORDER BY u.created_at DESC, u.id DESC
    `
  ).all();
  return json({ users: rs.results ?? [] });
}
async function adminUpdateUser(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const level = body.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < USER_LEVEL_MIN || level > USER_LEVEL_MAX) {
    return json({ error: "등급 값이 올바르지 않습니다" }, 400);
  }
  if (id === uid) return json({ error: "자기 등급은 바꿀 수 없습니다" }, 400);
  const found = await env.DB.prepare("SELECT id, level FROM users WHERE id=?").bind(id).first();
  if (!found) return json({ error: "회원을 찾을 수 없습니다" }, 404);
  if (found.level !== level) {
    await env.DB.prepare("UPDATE users SET level=?, updated_at=datetime('now') WHERE id=?").bind(level, id).run();
  }
  return json({ ok: true, id, level });
}
async function adminListComments(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const url = new URL(req.url);
  const unpromoted = (url.searchParams.get("unpromoted") ?? "1") === "1";
  const typeFilter = url.searchParams.get("type");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const where = ["c.status = 'published'"];
  const binds = [];
  if (unpromoted) where.push("c.promoted_to_note_id IS NULL");
  if (typeFilter && ALLOWED_TYPES.has(typeFilter)) {
    where.push("c.type = ?");
    binds.push(typeFilter);
  }
  const sql = `
    SELECT c.id, c.target_type, c.target_id, c.body, c.type, c.status,
           c.promoted_to_note_id, c.created_at,
           u.id AS user_id, u.display_name,
           (SELECT COUNT(*) FROM reactions r WHERE r.comment_id=c.id AND r.type='helpful') AS helpful_count
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY c.created_at DESC
    LIMIT ?`;
  const rs = await env.DB.prepare(sql).bind(...binds, limit).all();
  return json({ comments: rs.results ?? [] });
}
async function adminPromoteComment(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const noteId = body.note_id;
  if (noteId !== null && (typeof noteId !== "string" || !/^uc-\d{4}-\d{2}-\d{2}-\d+$/.test(noteId))) {
    return json({ error: "note_id 형식이 잘못되었습니다 (uc-YYYY-MM-DD-N)" }, 400);
  }
  const found = await env.DB.prepare("SELECT id FROM comments WHERE id=?").bind(id).first();
  if (!found) return json({ error: "not found" }, 404);
  await env.DB.prepare(
    `UPDATE comments SET promoted_to_note_id=?, updated_at=datetime('now') WHERE id=?`
  ).bind(noteId, id).run();
  return json({ ok: true, id, promoted_to_note_id: noteId });
}
const ALLOWED_TYPES = new Set(["memo", "question", "cross", "cite"]);
const ALLOWED_TARGET_TYPES = new Set(["post", "article", "place"]);
const MEMBER_LEVEL = 2;
const FEED_TARGETS = new Set(["article", "place"]);
const MAX_ATTACHMENTS = 6;
function parseYouTubeId(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const mShorts = u.pathname.match(/^\/(shorts|embed)\/([\w-]{11})/);
      if (mShorts) return mShorts[2];
    }
  } catch {
  }
  return null;
}
function sanitizeAttachments(input, env) {
  if (!Array.isArray(input)) return [];
  const allowedHosts = new Set();
  try {
    const u = new URL(env.UPLOADS_PUBLIC_BASE);
    allowedHosts.add(u.host);
  } catch {
  }
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw.type;
    if (t === "video") {
      const id = parseYouTubeId(String(raw.url ?? raw.videoId ?? ""));
      if (!id) continue;
      out.push({ type: "video", provider: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}` });
    } else if (t === "image") {
      const url = String(raw.url ?? "");
      try {
        const u = new URL(url);
        if (!allowedHosts.has(u.host)) continue;
      } catch {
        continue;
      }
      const width = Number(raw.width);
      const height = Number(raw.height);
      out.push({
        type: "image",
        url,
        ...Number.isFinite(width) ? { width } : {},
        ...Number.isFinite(height) ? { height } : {}
      });
    } else if (t === "map") {
      const lat = Number(raw.lat);
      const lng = Number(raw.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const zoomNum = Number(raw.zoom);
      const labelRaw = raw.label;
      const label = typeof labelRaw === "string" ? labelRaw.slice(0, 80) : void 0;
      out.push({
        type: "map",
        lat,
        lng,
        ...Number.isFinite(zoomNum) ? { zoom: Math.min(20, Math.max(1, zoomNum)) } : {},
        ...label ? { label } : {}
      });
    }
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}
async function countComments(req, env) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("targets");
  if (!raw) return json({ counts: {} });
  const targets = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (targets.length === 0) return json({ counts: {} });
  const byType = new Map();
  for (const t of targets) {
    if (!t.includes(":")) continue;
    const [type, ...rest] = t.split(":");
    if (!ALLOWED_TARGET_TYPES.has(type)) continue;
    const id = rest.join(":");
    if (!id) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(id);
  }
  const counts = {};
  for (const [type, ids] of byType) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT target_id, COUNT(*) AS n
         FROM comments
        WHERE target_type=? AND status='published' AND target_id IN (${placeholders})
        GROUP BY target_id`
    ).bind(type, ...ids).all();
    for (const r of rows.results ?? []) {
      counts[`${type}:${r.target_id}`] = r.n;
    }
  }
  return json({ counts });
}
async function verseFeed(req, env) {
  const url = new URL(req.url);
  const scripture = url.searchParams.get("scripture")?.trim();
  const chapter = url.searchParams.get("chapter")?.trim();
  if (!scripture || !chapter) return json({ verses: [] });
  const versePrefix = `${scripture}:`;
  const anchorPattern = chapterKeyPattern(scripture, chapter);
  const likePattern = `${versePrefix.replace(/[%_]/g, "\\$&")}${anchorPattern}`;
  const rows = await env.DB.prepare(
    `WITH cnt AS (
       SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest_at
         FROM comments
        WHERE target_type='verse' AND status='published'
          AND target_id LIKE ? ESCAPE '\\'
        GROUP BY target_id
     )
     SELECT cnt.target_id, cnt.n, cnt.latest_at,
            c.body_html, c.attachments,
            u.display_name AS user_nickname, u.level AS user_level
       FROM cnt
       JOIN comments c ON c.target_type='verse'
                     AND c.target_id=cnt.target_id
                     AND c.status='published'
                     AND c.created_at=cnt.latest_at
       JOIN users u ON u.id=c.user_id
      ORDER BY cnt.latest_at DESC`
  ).bind(likePattern).all();
  const verses = (rows.results ?? []).map((r) => {
    const anchor = r.target_id.slice(versePrefix.length);
    let photos = 0;
    if (r.attachments) {
      try {
        const arr = JSON.parse(r.attachments);
        if (Array.isArray(arr)) photos = arr.filter((a) => a?.type === "image").length;
      } catch {
      }
    }
    const plain = stripHtmlToPlain(r.body_html ?? "");
    let preview = plain;
    if (!preview && photos > 0) preview = `\u{1F4F7} 사진 ${photos}장`;
    return {
      anchor,
      count: r.n,
      latest: {
        body: preview,
        user_nickname: r.user_nickname ?? "",
        is_admin: (r.user_level ?? 0) >= 4,
        created_at: toIsoUtc(r.latest_at),
        has_photos: photos > 0
      }
    };
  });
  return json({ verses }, 200, { "Cache-Control": "private, max-age=15" });
}
const ADMIN_ONLY_SCRIPTURE_SLUGS = ["cheonjigaebyeokgyeong-hangeul"];
async function recentFeed(req, env) {
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(limitRaw || 30, 1), 100);
  const before = url.searchParams.get("before");
  const where = ["c.status='published'", "c.parent_id IS NULL"];
  const args = [];
  where.push(`NOT (c.target_type='post' AND c.target_id IN (SELECT id FROM posts WHERE board IN (${PRIVATE_BOARDS_SQL})))`);
  if (before) {
    where.push("c.created_at < ?");
    args.push(before);
  }
  for (const slug of ADMIN_ONLY_SCRIPTURE_SLUGS) {
    where.push("NOT (c.target_type='verse' AND c.target_id LIKE ? ESCAPE '\\')");
    args.push(slug.replace(/[%_]/g, "\\$&") + ":%");
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.body_html, c.attachments, c.created_at,
            u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.level AS author_level
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ?`
  ).bind(...args, limit).all();
  const items = (rows.results ?? []).map((r) => buildFeedItem(r));
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;
  return json({ items, nextCursor }, 200, { "Cache-Control": "public, max-age=15" });
}
async function mineFeed(req, env) {
  const me = await currentUserId(req, env);
  if (!me) return json({ items: [], nextCursor: null }, 200);
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(limitRaw || 30, 1), 100);
  const before = url.searchParams.get("before");
  const where = ["c.status='published'", "c.user_id=?"];
  const args = [me];
  if (before) {
    where.push("c.created_at < ?");
    args.push(before);
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.body_html, c.attachments, c.created_at,
            u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.level AS author_level
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ?`
  ).bind(...args, limit).all();
  const items = (rows.results ?? []).map((r) => buildFeedItem(r));
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;
  return json({ items, nextCursor }, 200, { "Cache-Control": "private, max-age=5" });
}
function buildFeedItem(r) {
  let photos = 0;
  if (r.attachments) {
    try {
      const arr = JSON.parse(r.attachments);
      if (Array.isArray(arr)) photos = arr.filter((a) => a?.type === "image").length;
    } catch {
    }
  }
  const plain = stripHtmlToPlain(r.body_html ?? "");
  const preview = plain || (photos > 0 ? `\u{1F4F7} 사진 ${photos}장` : "");
  let scripture = null;
  let anchor = null;
  if (r.target_type === "verse" && r.target_id.includes(":")) {
    const i = r.target_id.indexOf(":");
    scripture = r.target_id.slice(0, i);
    anchor = r.target_id.slice(i + 1);
  }
  return {
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    scripture,
    anchor,
    preview,
    photos,
    created_at: toIsoUtc(r.created_at),
    author: {
      display_name: r.author_name ?? "",
      avatar_url: r.author_avatar ?? null,
      is_admin: (r.author_level ?? 0) >= 4
    }
  };
}
function toIsoUtc(s) {
  if (!s) return "";
  if (s.includes("T") || /[Zz]$|[+-]\d\d:?\d\d$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}
function stripHtmlToPlain(html) {
  const noTags = html.replace(/<[^>]*>/g, "");
  return noTags.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
async function listComments(req, env) {
  const url = new URL(req.url);
  const target = url.searchParams.get("target");
  if (!target || !target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);
  const priv = await privatePostOf(env, targetType, targetId);
  if (priv && !canSeePost(priv.board, priv.author_id, await viewerOf(req, env))) return json({ error: "not found" }, 404);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.parent_id, c.body, c.body_html, c.type,
            c.status, c.attachments, c.is_pinned, c.promoted_to_note_id, c.created_at, c.updated_at,
            u.id AS user_id, u.display_name AS author_name,
            u.avatar_url AS author_avatar, u.affiliation AS author_affiliation,
            u.level AS author_level,
            (SELECT COUNT(*) FROM reactions r WHERE r.comment_id=c.id AND r.type='helpful') AS helpful_count,
            (SELECT COUNT(*) FROM comments cc WHERE cc.parent_id=c.id AND cc.status IN ('published','deleted')) AS reply_count
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.target_type=? AND c.target_id=? AND c.status IN ('published','deleted')
     ORDER BY c.is_pinned DESC, c.created_at ASC`
  ).bind(targetType, targetId).all();
  const me = await currentUserId(req, env);
  let myReactions = new Set();
  if (me) {
    const r = await env.DB.prepare(
      `SELECT comment_id FROM reactions
       WHERE user_id=? AND comment_id IN (SELECT id FROM comments WHERE target_type=? AND target_id=?)
       AND type='helpful'`
    ).bind(me, targetType, targetId).all();
    myReactions = new Set((r.results ?? []).map((x) => x.comment_id));
  }
  const comments = (rows.results ?? []).map((r) => {
    const isDeleted = r.status === "deleted";
    let attachments = [];
    if (!isDeleted && r.attachments) {
      try {
        const parsed = JSON.parse(r.attachments);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch {
      }
    }
    return {
      id: r.id,
      parent_id: r.parent_id,
      body: isDeleted ? "" : r.body ?? "",
      body_html: isDeleted ? "" : r.body_html,
      type: r.type,
      status: r.status,
      is_pinned: r.is_pinned === 1,
      reply_count: r.reply_count ?? 0,
      created_at: toIsoUtc(r.created_at),
      updated_at: toIsoUtc(r.updated_at),
      attachments,
      promoted_to_note_id: r.promoted_to_note_id ?? null,
      author: isDeleted ? { display_name: "", avatar_url: null, affiliation: null, level: 0 } : {
        display_name: r.author_name,
        avatar_url: r.author_avatar,
        affiliation: r.author_affiliation,
        level: r.author_level
      },
      helpful_count: isDeleted ? 0 : r.helpful_count,
      you_helpful: !isDeleted && myReactions.has(r.id),
      author_id: isDeleted ? null : r.user_id
    };
  });
  return json({ target, count: comments.length, comments });
}
async function createComment(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || !u.display_name) {
    return json({ error: "닉네임 설정 필요" }, 403);
  }
  const body = await req.json().catch(() => ({}));
  const target = body.target ?? "";
  if (!target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);
  const attachments = sanitizeAttachments(body.attachments, env);
  const text = (body.body ?? "").trim();
  if (attachments.length === 0 && (text.length === 0 || text.length > 4e3)) {
    return json({ error: "댓글은 1~4000자여야 합니다 (또는 첨부 1개 이상)" }, 400);
  }
  if (text.length > 4e3) {
    return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  }
  const type = body.type ?? "memo";
  if (!ALLOWED_TYPES.has(type)) return json({ error: "invalid type" }, 400);
  const privTarget = await privatePostOf(env, targetType, targetId);
  if (privTarget && !canSeePost(privTarget.board, privTarget.author_id, { id: uid, level: u.level ?? 0 })) {
    return json({ error: "not found" }, 404);
  }
  if (FEED_TARGETS.has(targetType)) {
    if ((u.level ?? 0) < MEMBER_LEVEL) return json({ error: "교인 인증 회원만 피드를 쓸 수 있습니다" }, 403);
    const table = targetType === "article" ? "articles" : "places";
    const ok = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id=? AND status='published'`).bind(targetId).first();
    if (!ok) return json({ error: "not found" }, 404);
  }
  if (body.parent_id) {
    const parent = await env.DB.prepare("SELECT target_type, target_id FROM comments WHERE id=?").bind(body.parent_id).first();
    if (!parent || parent.target_type !== targetType || parent.target_id !== targetId) {
      return json({ error: "invalid parent" }, 400);
    }
  }
  const id = uuid();
  const attJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
  await env.DB.prepare(
    `INSERT INTO comments (id, target_type, target_id, user_id, parent_id, body, body_html, type, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, targetType, targetId, uid, body.parent_id ?? null, text, sanitizeHTML(text), type, attJson).run();
  return json({ ok: true, id });
}
async function editComment(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id=?").bind(id).first();
  if (!owner) return json({ error: "not found" }, 404);
  if (owner.user_id !== uid) return json({ error: "forbidden" }, 403);
  const replyCount = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status IN ('published','deleted')"
  ).bind(id).first();
  if ((replyCount?.n ?? 0) > 0) {
    return json({ error: "답글이 있어 수정할 수 없습니다" }, 403);
  }
  const body = await req.json().catch(() => ({}));
  const text = (body.body ?? "").trim();
  const hasAttachmentField = body.attachments !== void 0;
  const attachments = hasAttachmentField ? sanitizeAttachments(body.attachments, env) : null;
  if (text.length === 0 && (!hasAttachmentField || (attachments?.length ?? 0) === 0)) {
    return json({ error: "댓글은 1~4000자여야 합니다 (또는 첨부 1개 이상)" }, 400);
  }
  if (text.length > 4e3) return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  if (body.type && !ALLOWED_TYPES.has(body.type)) return json({ error: "invalid type" }, 400);
  if (hasAttachmentField) {
    const attJson = (attachments?.length ?? 0) > 0 ? JSON.stringify(attachments) : null;
    await env.DB.prepare(
      `UPDATE comments SET body=?, body_html=?, type=COALESCE(?, type), attachments=?, updated_at=datetime('now') WHERE id=?`
    ).bind(text, sanitizeHTML(text), body.type ?? null, attJson, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE comments SET body=?, body_html=?, type=COALESCE(?, type), updated_at=datetime('now') WHERE id=?`
    ).bind(text, sanitizeHTML(text), body.type ?? null, id).run();
  }
  return json({ ok: true });
}
async function deleteComment(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id=?").bind(id).first();
  if (!owner) return json({ error: "not found" }, 404);
  const isOwner = owner.user_id === uid;
  const isCurator = (u?.level ?? 0) >= 3;
  if (!isOwner && !isCurator) return json({ error: "forbidden" }, 403);
  if (isOwner) {
    const replyCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status IN ('published','deleted')"
    ).bind(id).first();
    if ((replyCount?.n ?? 0) === 0) {
      await env.DB.prepare("DELETE FROM comments WHERE id=?").bind(id).run();
      return json({ ok: true, status: "removed" });
    }
    await env.DB.prepare(
      `UPDATE comments SET status='deleted', body='', body_html='', attachments=NULL, updated_at=datetime('now') WHERE id=?`
    ).bind(id).run();
    return json({ ok: true, status: "deleted" });
  }
  await env.DB.prepare(
    `UPDATE comments SET status='hidden', updated_at=datetime('now') WHERE id=?`
  ).bind(id).run();
  return json({ ok: true, status: "hidden" });
}
async function pinComment(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || (u.level ?? 0) < 4) return json({ error: "forbidden" }, 403);
  const row = await env.DB.prepare("SELECT is_pinned FROM comments WHERE id=?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  const next = row.is_pinned === 1 ? 0 : 1;
  await env.DB.prepare(
    `UPDATE comments SET is_pinned=?, updated_at=datetime('now') WHERE id=?`
  ).bind(next, id).run();
  return json({ ok: true, is_pinned: next === 1 });
}
async function toggleReaction(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({}));
  const type = body.type ?? "helpful";
  const exists = await env.DB.prepare(
    "SELECT 1 FROM reactions WHERE comment_id=? AND user_id=? AND type=?"
  ).bind(id, uid, type).first();
  if (exists) {
    await env.DB.prepare(
      "DELETE FROM reactions WHERE comment_id=? AND user_id=? AND type=?"
    ).bind(id, uid, type).run();
    return json({ ok: true, on: false });
  }
  await env.DB.prepare(
    "INSERT INTO reactions (comment_id, user_id, type) VALUES (?, ?, ?)"
  ).bind(id, uid, type).run();
  return json({ ok: true, on: true });
}
async function flagComment(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({}));
  const reason = (body.reason ?? "").trim();
  if (!reason || reason.length > 500) return json({ error: "신고 사유 필요 (1~500자)" }, 400);
  await env.DB.prepare(
    "INSERT INTO flags (comment_id, user_id, reason) VALUES (?, ?, ?)"
  ).bind(id, uid, reason).run();
  return json({ ok: true });
}
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const INTERNAL_HOSTS = new Set(["jsbooks.wiki", "www.jsbooks.wiki"]);
const SCRIPTURE_NAME = {
  cheonjigaebyeokgyeong: "천지개벽경",
  "cheonjigaebyeokgyeong-hangeul": "천지개벽경 한글본",
  donggokbiseo: "동곡비서",
  "hwaeundang-silgi": "화은당실기"
};
const ARCHIVE_KIND = {
  people: "인물",
  places: "장소",
  dosu: "도수",
  terms: "용어",
  dates: "시기"
};
function readableInternalLabel(rawUrl) {
  const hostMatch = rawUrl.match(/^https?:\/\/[^/?#]+/i);
  const tail = hostMatch ? rawUrl.slice(hostMatch[0].length) : rawUrl;
  const hashIdx = tail.indexOf("#");
  const pathRaw = hashIdx >= 0 ? tail.slice(0, hashIdx) : tail;
  const hashRaw = hashIdx >= 0 ? tail.slice(hashIdx + 1) : "";
  let hash = "";
  try {
    hash = decodeURIComponent(hashRaw);
  } catch {
    hash = hashRaw;
  }
  const segments = pathRaw.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const fallback = `.${pathRaw}${hashRaw ? "#" + hashRaw : ""}`;
  if (segments[0] === "library" && segments[1]) {
    const slug = segments[1];
    const name = SCRIPTURE_NAME[slug] ?? slug;
    if (slug === "cheonjigaebyeokgyeong" || slug === "cheonjigaebyeokgyeong-hangeul") {
      if (hash.startsWith("preface-")) {
        const n = hash.slice("preface-".length);
        return n ? `${name} 서 ${n}문장` : `${name} 서`;
      }
      const parts = hash.split("-");
      if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
        return `${name} ${parts[0]}편 ${parts[1]}장 ${parts[2]}절`;
      }
      if (segments[2] === "preface") return `${name} 서`;
      if (segments[2] && segments[3]) return `${name} ${segments[2]}편 ${segments[3]}장`;
      return name;
    }
    if (slug === "hwaeundang-silgi") {
      const parts = hash.split("-");
      if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
        return `${name} ${parts[0]}장 ${parts[1]}절`;
      }
      if (segments[2]) return `${name} ${segments[2]}장`;
      return name;
    }
    if (slug === "donggokbiseo") {
      if (segments[2] === "afterword") {
        return hash ? `${name} 부록 ${hash}` : `${name} 부록`;
      }
      if (/^\d+$/.test(hash)) return `${name} ${hash}절`;
      if (hash) return `${name} ${hash}`;
      return name;
    }
    return hash ? `${name} ^${hash}` : name;
  }
  if (segments[0] === "archive" && segments[1] && segments[2]) {
    const kind = ARCHIVE_KIND[segments[1]] ?? segments[1];
    return `${kind}: ${segments[2]}`;
  }
  if (segments.length === 0) return "홈";
  const SECTION = {
    calendar: "달력",
    news: "뉴스",
    feed: "피드",
    history: "변경 내역",
    admin: "관리자"
  };
  if (segments[0] in SECTION) {
    const label = SECTION[segments[0]];
    return segments[1] ? `${label} · ${segments.slice(1).join(" / ")}` : label;
  }
  return fallback;
}
function linkifyEscaped(esc2) {
  return esc2.replace(URL_RE, (raw) => {
    let trailing = "";
    const m = raw.match(/[.,!?;:)\]}]+$/);
    if (m) {
      trailing = m[0];
      raw = raw.slice(0, raw.length - trailing.length);
    }
    const hostMatch = raw.match(/^https?:\/\/([^/?#]+)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : "";
    const isInternal = INTERNAL_HOSTS.has(host);
    if (isInternal) {
      const display = readableInternalLabel(raw);
      return `<a class="comment-link internal" href="${raw}">${display}</a>${trailing}`;
    }
    return `<a class="comment-link external" href="${raw}" target="_blank" rel="noopener noreferrer nofollow ugc">${raw} <span aria-hidden="true">↗</span></a>${trailing}`;
  });
}
function sanitizeHTML(text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paras2 = escaped.split(/\n\s*\n/).map((p) => `<p>${linkifyEscaped(p.replace(/\n/g, "<br>"))}</p>`);
  return paras2.join("");
}
function isValidChapterAnchor(s) {
  if (s === "0" || s === "preface" || s === "appendix") return true;
  return /^\d+-\d+$/.test(s) || /^\d+$/.test(s);
}
async function touchVisit(req, env) {
  const body = await req.json().catch(() => ({}));
  const scripture = (body.scripture ?? "").trim();
  const chapter = (body.chapter ?? "").trim();
  if (!scripture || !/^[a-z0-9-]+$/.test(scripture)) return json({ error: "invalid scripture" }, 400);
  if (!chapter || !isValidChapterAnchor(chapter)) return json({ error: "invalid chapter" }, 400);
  const uid = await currentUserId(req, env);
  if (!uid) return json({ ok: true, anonymous: true });
  await env.DB.prepare(
    `INSERT INTO user_visits (user_id, scripture_slug, chapter_anchor, last_visited)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, scripture_slug, chapter_anchor)
     DO UPDATE SET last_visited = datetime('now')`
  ).bind(uid, scripture, chapter).run();
  return json({ ok: true });
}
async function visitsBadges(req, env) {
  const url = new URL(req.url);
  const scripture = url.searchParams.get("scripture")?.trim();
  const uid = await currentUserId(req, env);
  const cacheHeaders = { "Cache-Control": "private, max-age=30" };
  if (!scripture) {
    const versesRows = await env.DB.prepare(
      `SELECT
         substr(target_id, 1, instr(target_id, ':') - 1) AS slug,
         COUNT(*) AS n,
         MAX(created_at) AS latest
       FROM comments
       WHERE target_type='verse' AND status='published' AND instr(target_id, ':') > 0
       GROUP BY slug`
    ).all();
    const totals = {};
    for (const r of versesRows.results ?? []) {
      if (r.slug) totals[r.slug] = { total: r.n, new: 0 };
    }
    if (uid) {
      const visits = await env.DB.prepare(
        `SELECT scripture_slug, MIN(last_visited) AS oldest_visit
         FROM user_visits WHERE user_id = ?
         GROUP BY scripture_slug`
      ).bind(uid).all();
      const oldestBySlug = new Map();
      for (const v of visits.results ?? []) oldestBySlug.set(v.scripture_slug, v.oldest_visit);
      for (const slug of Object.keys(totals)) {
        const oldest = oldestBySlug.get(slug);
        if (!oldest) {
          totals[slug].new = totals[slug].total;
          continue;
        }
        const nr = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM comments
           WHERE target_type='verse' AND status='published'
             AND substr(target_id, 1, instr(target_id, ':') - 1) = ?
             AND created_at > ?`
        ).bind(slug, oldest).first();
        totals[slug].new = nr?.n ?? 0;
      }
    } else {
    }
    return json({ scriptures: totals, anonymous: !uid }, 200, cacheHeaders);
  }
  const versePrefix = `${scripture}:`;
  const verseRows = await env.DB.prepare(
    `SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest
     FROM comments
     WHERE target_type='verse' AND status='published'
       AND target_id LIKE ? ESCAPE '\\'
     GROUP BY target_id`
  ).bind(versePrefix.replace(/[%_]/g, "\\$&") + "%").all();
  const chapterRows = scripture === "cheonjigaebyeokgyeong" ? await env.DB.prepare(
    `SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest
         FROM comments
         WHERE target_type='chapter' AND status='published'
         GROUP BY target_id`
  ).all() : { results: [] };
  function chapterKeyFromAnchor(anchor) {
    if (scripture === "cheonjigaebyeokgyeong") {
      if (anchor.startsWith("preface")) return "preface";
      const m = anchor.match(/^(\d+)-(\d+)/);
      if (m) return `${m[1]}-${m[2]}`;
      return anchor;
    }
    if (scripture === "hwaeundang-silgi") {
      if (anchor.startsWith("preface")) return "preface";
      if (anchor.startsWith("appendix")) return "appendix";
      const m = anchor.match(/^(\d+)/);
      if (m) return m[1];
      return anchor;
    }
    return "0";
  }
  const chapters = {};
  for (const r of verseRows.results ?? []) {
    const anchor = r.target_id.slice(versePrefix.length);
    if (!anchor) continue;
    const key = chapterKeyFromAnchor(anchor);
    if (!chapters[key]) chapters[key] = { total: 0, new: 0, latest: null };
    chapters[key].total += r.n;
    if (!chapters[key].latest || r.latest > chapters[key].latest) chapters[key].latest = r.latest;
  }
  for (const r of chapterRows.results ?? []) {
    const key = r.target_id.replace(":", "-");
    if (!chapters[key]) chapters[key] = { total: 0, new: 0, latest: null };
    chapters[key].total += r.n;
    if (!chapters[key].latest || r.latest > chapters[key].latest) chapters[key].latest = r.latest;
  }
  let scriptureTotal = 0;
  let scriptureNew = 0;
  if (uid) {
    const visits = await env.DB.prepare(
      `SELECT chapter_anchor, last_visited FROM user_visits
       WHERE user_id = ? AND scripture_slug = ?`
    ).bind(uid, scripture).all();
    const visitMap = new Map();
    for (const v of visits.results ?? []) visitMap.set(v.chapter_anchor, v.last_visited);
    for (const [key, entry] of Object.entries(chapters)) {
      scriptureTotal += entry.total;
      const lv = visitMap.get(key);
      if (!lv) {
        entry.new = entry.total;
        scriptureNew += entry.total;
        continue;
      }
      if (!entry.latest || entry.latest <= lv) {
        entry.new = 0;
        continue;
      }
      const verseN = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM comments
         WHERE target_type='verse' AND status='published'
           AND target_id LIKE ? ESCAPE '\\'
           AND created_at > ?`
      ).bind(`${versePrefix.replace(/[%_]/g, "\\$&")}${chapterKeyPattern(scripture, key)}`, lv).first();
      let n = verseN?.n ?? 0;
      if (scripture === "cheonjigaebyeokgyeong") {
        const m = key.match(/^(\d+)-(\d+)$/);
        if (m) {
          const chN = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM comments
             WHERE target_type='chapter' AND status='published'
               AND target_id = ?
               AND created_at > ?`
          ).bind(`${m[1]}:${m[2]}`, lv).first();
          n += chN?.n ?? 0;
        }
      }
      entry.new = n;
      scriptureNew += n;
    }
  } else {
    for (const entry of Object.values(chapters)) scriptureTotal += entry.total;
  }
  const out = {};
  for (const [k, v] of Object.entries(chapters)) out[k] = { total: v.total, new: v.new };
  return json({
    chapters: out,
    scripture_total: { total: scriptureTotal, new: scriptureNew },
    anonymous: !uid
  }, 200, cacheHeaders);
}
function chapterKeyPattern(scripture, chapterKey) {
  if (scripture === "cheonjigaebyeokgyeong") {
    if (chapterKey === "preface") return "preface-%";
    return `${chapterKey}-%`;
  }
  if (scripture === "hwaeundang-silgi") {
    if (chapterKey === "preface") return "preface-%";
    if (chapterKey === "appendix") return "appendix-%";
    return `${chapterKey}-%`;
  }
  return "%";
}
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const UPLOAD_RATE_LIMIT_PER_HOUR = 30;
function extFromContentType(ct) {
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  return "bin";
}
async function uploadImage(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || !u.display_name) return json({ error: "닉네임 설정 필요" }, 403);
  if ((u.level ?? 0) < 1) return json({ error: "업로드 권한 없음" }, 403);
  const ct = req.headers.get("Content-Type") ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(ct)) {
    return json({ error: "허용된 형식: jpeg/png/webp" }, 415);
  }
  const lenHeader = req.headers.get("Content-Length");
  const len = lenHeader ? parseInt(lenHeader, 10) : NaN;
  if (Number.isFinite(len) && len > MAX_IMAGE_BYTES) {
    return json({ error: `파일이 너무 큼 (max ${Math.round(MAX_IMAGE_BYTES / 1024)} KB)` }, 413);
  }
  const hashHeader = req.headers.get("X-Upload-Hash");
  const widthHeader = req.headers.get("X-Image-Width");
  const heightHeader = req.headers.get("X-Image-Height");
  const hash = hashHeader && /^[0-9a-f]{64}$/i.test(hashHeader) ? hashHeader.toLowerCase() : null;
  const width = widthHeader ? Math.max(0, parseInt(widthHeader, 10)) : 0;
  const height = heightHeader ? Math.max(0, parseInt(heightHeader, 10)) : 0;
  if (hash) {
    const existing = await env.DB.prepare(
      "SELECT url, r2_key, width, height FROM user_uploaded_photos WHERE user_id=? AND hash=?"
    ).bind(uid, hash).first();
    if (existing) {
      return json({
        ok: true,
        deduped: true,
        url: existing.url,
        key: existing.r2_key,
        view_url: mediaUrl(env, existing.r2_key),
        width: existing.width,
        height: existing.height
      });
    }
  }
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: `파일이 너무 큼 (max ${Math.round(MAX_IMAGE_BYTES / 1024)} KB)` }, 413);
  }
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const userPrefix = `comments/${yyyy}/${mm}/${dd}/${hh}/${uid}/`;
  const list = await env.UPLOADS.list({ prefix: userPrefix, limit: 100 });
  if ((list.objects?.length ?? 0) >= UPLOAD_RATE_LIMIT_PER_HOUR) {
    return json({ error: "업로드 한도 초과 (시간당)" }, 429);
  }
  const ext = extFromContentType(ct);
  const id = uuid();
  const key = `${userPrefix}${id}.${ext}`;
  await env.UPLOADS.put(key, buf, {
    httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uid, originalSize: String(buf.byteLength), ...hash ? { hash } : {} }
  });
  const base = (env.UPLOADS_PUBLIC_BASE || "").replace(/\/$/, "");
  const url = `${base}/${key}`;
  if (hash) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_uploaded_photos
         (user_id, hash, url, r2_key, width, height, size_bytes, content_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, hash, url, key, width, height, buf.byteLength, ct).run();
  }
  return json({ ok: true, url, key, view_url: mediaUrl(env, key), width, height, bytes: buf.byteLength, contentType: ct });
}
async function checkUpload(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({}));
  const hash = body.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return json({ error: "invalid hash" }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT url, width, height FROM user_uploaded_photos WHERE user_id=? AND hash=?"
  ).bind(uid, hash.toLowerCase()).first();
  if (!row) return json({ exists: false });
  return json({ exists: true, url: row.url, width: row.width, height: row.height });
}
const EVENT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TITLE_MAX = 200;
const EVENT_CATEGORY_MAX = 40;
const EVENT_MEMO_MAX = 2e3;
const EVENT_CATEGORIES = new Set(["기념일", "일정", "기타"]);
function normalizeEventInput(raw) {
  if (!raw || typeof raw !== "object") return { error: "invalid body" };
  const b = raw;
  const out = {};
  if (b.title !== void 0) {
    if (typeof b.title !== "string") return { error: "title must be string" };
    const t = b.title.trim();
    if (!t) return { error: "title required" };
    if (t.length > EVENT_TITLE_MAX) return { error: `title too long (max ${EVENT_TITLE_MAX})` };
    out.title = t;
  }
  if (b.start_date !== void 0) {
    if (typeof b.start_date !== "string" || !EVENT_DATE_RE.test(b.start_date)) {
      return { error: "start_date must be YYYY-MM-DD" };
    }
    out.start_date = b.start_date;
  }
  if (b.end_date !== void 0) {
    if (b.end_date === null || b.end_date === "") {
      out.end_date = null;
    } else if (typeof b.end_date === "string" && EVENT_DATE_RE.test(b.end_date)) {
      out.end_date = b.end_date;
    } else {
      return { error: "end_date must be YYYY-MM-DD or null" };
    }
  }
  if (b.all_day !== void 0) {
    out.all_day = b.all_day ? 1 : 0;
  }
  if (b.category !== void 0) {
    if (b.category === null) {
      out.category = null;
    } else if (typeof b.category === "string") {
      const c = b.category.trim();
      if (c.length > EVENT_CATEGORY_MAX) return { error: `category too long (max ${EVENT_CATEGORY_MAX})` };
      if (c && !EVENT_CATEGORIES.has(c)) return { error: `category must be one of: ${[...EVENT_CATEGORIES].join(", ")}` };
      out.category = c || null;
    } else {
      return { error: "category must be string or null" };
    }
  }
  if (b.is_annual !== void 0) out.is_annual = b.is_annual ? 1 : 0;
  if (b.is_lunar !== void 0) out.is_lunar = b.is_lunar ? 1 : 0;
  if (b.is_public !== void 0) out.is_public = b.is_public ? 1 : 0;
  if (b.memo !== void 0) {
    if (b.memo === null) {
      out.memo = null;
    } else if (typeof b.memo === "string") {
      if (b.memo.length > EVENT_MEMO_MAX) return { error: `memo too long (max ${EVENT_MEMO_MAX})` };
      out.memo = b.memo;
    } else {
      return { error: "memo must be string or null" };
    }
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) {
    return { error: "end_date must be on or after start_date" };
  }
  if (out.category === "기념일") {
    out.is_public = 1;
  } else if (out.category === "일정" || out.category === "기타") {
    if (out.is_annual === 1) return { error: "일정/기타 카테고리는 연례 옵션을 사용할 수 없습니다" };
    if (out.is_lunar === 1) return { error: "일정/기타 카테고리는 음력 옵션을 사용할 수 없습니다" };
  }
  return out;
}
const EVENT_SELECT = `
  SELECT ev.id, ev.user_id, ev.title, ev.start_date, ev.end_date, ev.all_day,
         ev.category, ev.is_annual, ev.is_lunar, ev.is_public, ev.memo,
         ev.created_at, ev.updated_at, ev.source_post_id
    FROM events ev
`;
async function eventAdmin(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return null;
  const u = await loadUser(env, uid);
  return u && u.level >= 4 ? { id: u.id } : null;
}
async function listEvents(req, env) {
  const admin = await eventAdmin(req, env);
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const category = url.searchParams.get("category");
  if (from && !EVENT_DATE_RE.test(from)) return json({ error: "from must be YYYY-MM-DD" }, 400);
  if (to && !EVENT_DATE_RE.test(to)) return json({ error: "to must be YYYY-MM-DD" }, 400);
  if (category && !EVENT_CATEGORIES.has(category)) return json({ error: "unknown category" }, 400);
  const conds = [];
  const binds = [];
  if (!admin) conds.push("ev.is_public = 1");
  if (category) {
    conds.push("ev.category = ?");
    binds.push(category);
  }
  const rangeConds = [];
  if (from) {
    rangeConds.push("COALESCE(ev.end_date, ev.start_date) >= ?");
    binds.push(from);
  }
  if (to) {
    rangeConds.push("ev.start_date <= ?");
    binds.push(to);
  }
  if (rangeConds.length) conds.push(`(ev.is_annual = 1 OR (${rangeConds.join(" AND ")}))`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rs = await env.DB.prepare(`${EVENT_SELECT} ${where} ORDER BY ev.start_date ASC, ev.created_at ASC LIMIT 1000`).bind(...binds).all();
  const events = (rs.results ?? []).map((r) => ({ ...r, owner_name: null, is_mine: admin ? 1 : 0 }));
  return json({ events, can_edit: !!admin });
}
async function createEvent(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const admin = await eventAdmin(req, env);
  if (!admin) return json({ error: "일정은 운영자만 추가할 수 있습니다" }, 403);
  const raw = await req.json().catch(() => ({}));
  const parsed = normalizeEventInput(raw);
  if (parsed.error) return json({ error: parsed.error }, 400);
  if (!parsed.title || !parsed.start_date) return json({ error: "title and start_date required" }, 400);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO events (id, user_id, title, start_date, end_date, all_day,
                          category, is_annual, is_lunar, is_public, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    admin.id,
    parsed.title,
    parsed.start_date,
    parsed.end_date ?? null,
    parsed.all_day ?? 1,
    parsed.category ?? null,
    parsed.is_annual ?? 0,
    parsed.is_lunar ?? 0,
    parsed.is_public ?? 0,
    parsed.memo ?? null
  ).run();
  const row = await env.DB.prepare(`${EVENT_SELECT} WHERE ev.id=?`).bind(id).first();
  return json({ event: row }, 201);
}
async function updateEvent(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const admin = await eventAdmin(req, env);
  if (!admin) return json({ error: "일정은 운영자만 수정할 수 있습니다" }, 403);
  const existing = await env.DB.prepare("SELECT id FROM events WHERE id=?").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  const raw = await req.json().catch(() => ({}));
  const parsed = normalizeEventInput(raw);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const sets = [];
  const binds = [];
  if (parsed.title !== void 0) {
    sets.push("title=?");
    binds.push(parsed.title);
  }
  if (parsed.start_date !== void 0) {
    sets.push("start_date=?");
    binds.push(parsed.start_date);
  }
  if (parsed.end_date !== void 0) {
    sets.push("end_date=?");
    binds.push(parsed.end_date);
  }
  if (parsed.all_day !== void 0) {
    sets.push("all_day=?");
    binds.push(parsed.all_day);
  }
  if (parsed.category !== void 0) {
    sets.push("category=?");
    binds.push(parsed.category);
  }
  if (parsed.is_annual !== void 0) {
    sets.push("is_annual=?");
    binds.push(parsed.is_annual);
  }
  if (parsed.is_lunar !== void 0) {
    sets.push("is_lunar=?");
    binds.push(parsed.is_lunar);
  }
  if (parsed.is_public !== void 0) {
    sets.push("is_public=?");
    binds.push(parsed.is_public);
  }
  if (parsed.memo !== void 0) {
    sets.push("memo=?");
    binds.push(parsed.memo);
  }
  if (sets.length === 0) return json({ error: "nothing to update" }, 400);
  sets.push("updated_at=datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  const row = await env.DB.prepare(`${EVENT_SELECT} WHERE ev.id=?`).bind(id).first();
  return json({ event: row });
}
async function deleteEvent(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const admin = await eventAdmin(req, env);
  if (!admin) return json({ error: "일정은 운영자만 삭제할 수 있습니다" }, 403);
  const existing = await env.DB.prepare("SELECT id FROM events WHERE id=?").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  await env.DB.prepare("DELETE FROM events WHERE id=?").bind(id).run();
  return json({ ok: true });
}
const NEWS_CATEGORIES = new Set(["notice", "update", "release", "roadmap"]);
const NEWS_TITLE_MAX = 200;
const NEWS_SUMMARY_MAX = 500;
const NEWS_BODY_MAX = 2e5;
const NEWS_SLUG_RE = /^[A-Za-z0-9가-힣_\-]+$/;
const NEWS_SELECT = `
  SELECT n.id, n.slug, n.title, n.category, n.body_md, n.body_html, n.summary,
         n.draft, n.pinned, n.published_at, n.author_id, n.created_at, n.updated_at,
         u.display_name AS author_name
    FROM news n
    LEFT JOIN users u ON u.id = n.author_id
`;
function slugifyNews(s) {
  return s.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9가-힣\-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function normalizeNewsInput(raw) {
  if (!raw || typeof raw !== "object") return { error: "body must be JSON object" };
  const b = raw;
  const out = {};
  if (b.title !== void 0) {
    if (typeof b.title !== "string") return { error: "title must be string" };
    const t = b.title.trim();
    if (!t) return { error: "title required" };
    if (t.length > NEWS_TITLE_MAX) return { error: `title too long (max ${NEWS_TITLE_MAX})` };
    out.title = t;
  }
  if (b.category !== void 0) {
    if (typeof b.category !== "string" || !NEWS_CATEGORIES.has(b.category)) {
      return { error: `category must be one of: ${[...NEWS_CATEGORIES].join(", ")}` };
    }
    out.category = b.category;
  }
  if (b.body_md !== void 0) {
    if (typeof b.body_md !== "string") return { error: "body_md must be string" };
    if (b.body_md.length > NEWS_BODY_MAX) return { error: `body_md too long (max ${NEWS_BODY_MAX})` };
    out.body_md = b.body_md;
  }
  if (b.summary !== void 0) {
    if (b.summary === null) {
      out.summary = null;
    } else if (typeof b.summary === "string") {
      const s = b.summary.trim();
      if (s.length > NEWS_SUMMARY_MAX) return { error: `summary too long (max ${NEWS_SUMMARY_MAX})` };
      out.summary = s || null;
    } else {
      return { error: "summary must be string or null" };
    }
  }
  if (b.slug !== void 0) {
    if (typeof b.slug !== "string") return { error: "slug must be string" };
    const s = b.slug.trim();
    if (!s) return { error: "slug must not be empty" };
    if (s.length > 120) return { error: "slug too long (max 120)" };
    if (!NEWS_SLUG_RE.test(s)) return { error: "slug 형식이 잘못되었습니다 (영문/숫자/한글/_-)" };
    out.slug = s;
  }
  if (b.draft !== void 0) out.draft = b.draft ? 1 : 0;
  if (b.pinned !== void 0) out.pinned = b.pinned ? 1 : 0;
  return out;
}
async function ensureUniqueSlug(env, base, excludeId) {
  for (let i = 0; i < 100; i++) {
    const cand = i === 0 ? base : `${base}-${i + 1}`;
    const row = excludeId ? await env.DB.prepare("SELECT 1 FROM news WHERE slug = ? AND id <> ?").bind(cand, excludeId).first() : await env.DB.prepare("SELECT 1 FROM news WHERE slug = ?").bind(cand).first();
    if (!row) return cand;
  }
  return `${base}-${Date.now()}`;
}
async function listNews(req, env) {
  const url = new URL(req.url);
  const cat = url.searchParams.get("category");
  const includeDrafts = url.searchParams.get("include_drafts") === "1";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  let isAdmin = false;
  if (includeDrafts) {
    const uid = await currentUserId(req, env);
    if (!uid) return json({ error: "unauthenticated" }, 401);
    const me = await loadUser(env, uid);
    if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
    isAdmin = true;
  }
  if (cat && !NEWS_CATEGORIES.has(cat)) return json({ error: "invalid category" }, 400);
  const where = [];
  const binds = [];
  if (!isAdmin) where.push("n.draft = 0");
  if (cat) {
    where.push("n.category = ?");
    binds.push(cat);
  }
  const sql = `${NEWS_SELECT}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY n.pinned DESC,
             COALESCE(n.published_at, n.updated_at) DESC,
             n.created_at DESC
    LIMIT ?`;
  const rs = await env.DB.prepare(sql).bind(...binds, limit).all();
  return json({ news: rs.results ?? [] });
}
async function getNews(req, env, slug) {
  const row = await env.DB.prepare(`${NEWS_SELECT} WHERE n.slug = ? LIMIT 1`).bind(slug).first();
  if (!row) return json({ error: "not found" }, 404);
  if (row.draft === 1) {
    const uid = await currentUserId(req, env);
    if (!uid) return json({ error: "not found" }, 404);
    const me = await loadUser(env, uid);
    if (!me || me.level < 4) return json({ error: "not found" }, 404);
  }
  return json({ news: row });
}
async function createNews(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const raw = await req.json().catch(() => null);
  const parsed = normalizeNewsInput(raw);
  if (parsed.error) return json({ error: parsed.error }, 400);
  if (!parsed.title || !parsed.category || parsed.body_md === void 0) {
    return json({ error: "title, category, body_md required" }, 400);
  }
  const base = parsed.slug ?? slugifyNews(parsed.title) ?? `news-${Date.now()}`;
  const slug = await ensureUniqueSlug(env, base || `news-${Date.now()}`, null);
  const id = uuid();
  const draft = parsed.draft ?? 0;
  const publishedAt = draft === 0 ? (new Date()).toISOString().replace(/\.\d+Z$/, "Z") : null;
  const html = renderNewsMarkdown(parsed.body_md);
  await env.DB.prepare(
    `INSERT INTO news (id, slug, title, category, body_md, body_html, summary, draft, published_at, author_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    slug,
    parsed.title,
    parsed.category,
    parsed.body_md,
    html,
    parsed.summary ?? null,
    draft,
    publishedAt,
    uid
  ).run();
  const row = await env.DB.prepare(`${NEWS_SELECT} WHERE n.id = ?`).bind(id).first();
  return json({ news: row }, 201);
}
async function updateNews(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const existing = await env.DB.prepare(
    "SELECT id, slug, draft FROM news WHERE id = ?"
  ).bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  const raw = await req.json().catch(() => null);
  const parsed = normalizeNewsInput(raw);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const sets = [];
  const binds = [];
  if (parsed.title !== void 0) {
    sets.push("title=?");
    binds.push(parsed.title);
  }
  if (parsed.category !== void 0) {
    sets.push("category=?");
    binds.push(parsed.category);
  }
  if (parsed.body_md !== void 0) {
    sets.push("body_md=?");
    binds.push(parsed.body_md);
    sets.push("body_html=?");
    binds.push(renderNewsMarkdown(parsed.body_md));
  }
  if (parsed.summary !== void 0) {
    sets.push("summary=?");
    binds.push(parsed.summary);
  }
  if (parsed.slug !== void 0 && parsed.slug !== existing.slug) {
    const newSlug = await ensureUniqueSlug(env, parsed.slug, id);
    sets.push("slug=?");
    binds.push(newSlug);
  }
  if (parsed.draft !== void 0) {
    sets.push("draft=?");
    binds.push(parsed.draft);
    if (parsed.draft === 0 && existing.draft === 1) {
      sets.push("published_at=?");
      binds.push((new Date()).toISOString().replace(/\.\d+Z$/, "Z"));
    } else if (parsed.draft === 1) {
      sets.push("published_at=NULL");
    }
  }
  if (parsed.pinned !== void 0) {
    sets.push("pinned=?");
    binds.push(parsed.pinned);
  }
  if (sets.length === 0) return json({ error: "nothing to update" }, 400);
  sets.push("updated_at=datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE news SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  const row = await env.DB.prepare(`${NEWS_SELECT} WHERE n.id = ?`).bind(id).first();
  return json({ news: row });
}
async function deleteNews(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);
  const existing = await env.DB.prepare("SELECT id FROM news WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  await env.DB.prepare("DELETE FROM news WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
function escapeHtmlNews(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderNewsInline(s) {
  let out = escapeHtmlNews(s);
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const safe = /^(https?:\/\/|\/)/i.test(url) ? url : "#";
    return `<a href="${safe}" rel="noopener">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}
function renderNewsMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let buf = [];
  let fence = null;
  const flush = () => {
    if (buf.length) {
      blocks.push(renderBlock(buf.join("\n")));
      buf = [];
    }
  };
  for (const line of lines) {
    if (fence !== null) {
      if (/^```\s*$/.test(line)) {
        blocks.push(`<pre><code>${escapeHtmlNews(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    if (line.trim() === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  if (fence !== null) {
    blocks.push(`<pre><code>${escapeHtmlNews(fence.join("\n"))}</code></pre>`);
  }
  flush();
  return blocks.join("\n");
}
function renderBlock(block) {
  const lines = block.split("\n");
  if (lines.length === 1) {
    const h = lines[0].match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      return `<h${lvl}>${renderNewsInline(h[2])}</h${lvl}>`;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(lines[0])) return "<hr>";
  }
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderNewsInline(l.replace(/^[-*]\s+/, ""))}</li>`).join("");
    return `<ul>${items}</ul>`;
  }
  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderNewsInline(l.replace(/^\d+\.\s+/, ""))}</li>`).join("");
    return `<ol>${items}</ol>`;
  }
  if (lines.every((l) => /^>\s?/.test(l))) {
    const inner2 = lines.map((l) => l.replace(/^>\s?/, "")).join("\n");
    return `<blockquote><p>${renderNewsInline(inner2.replace(/\n/g, " "))}</p></blockquote>`;
  }
  const inner = lines.map((l) => renderNewsInline(l)).join("<br>\n");
  return `<p>${inner}</p>`;
}
const POST_PAGE_SIZE = 20;
function canSeePost(board, authorId, viewer) {
  if (!PRIVATE_BOARDS.has(board)) return true;
  return !!viewer && (viewer.id === authorId || viewer.level >= 4);
}
async function viewerOf(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return null;
  const u = await loadUser(env, uid);
  return u ? { id: uid, level: u.level ?? 0 } : null;
}
const NEWS_BOARD = "news";
function newsExtras(raw) {
  const out = {};
  if (raw.notice !== void 0) out.notice = !!raw.notice;
  if (raw.period !== void 0) {
    if (raw.period === null || !raw.period?.start) out.period = null;
    else {
      const start = String(raw.period.start);
      const end = raw.period.end ? String(raw.period.end) : null;
      if (!EVENT_DATE_RE.test(start) || end && !EVENT_DATE_RE.test(end)) return { error: "기간은 YYYY-MM-DD 형식이어야 합니다" };
      if (end && end < start) return { error: "끝나는 날이 시작하는 날보다 앞입니다" };
      out.period = { start, end: end && end !== start ? end : null };
    }
  }
  return out;
}
function newsExtraStmts(env, postId, uid, title, x) {
  const st = [];
  if (x.notice !== void 0) st.push(env.DB.prepare("UPDATE posts SET is_pinned=? WHERE id=?").bind(x.notice ? 1 : 0, postId));
  if (x.period !== void 0) {
    st.push(env.DB.prepare("DELETE FROM events WHERE source_post_id=?").bind(postId));
    if (x.period) {
      st.push(
        env.DB.prepare(
          `INSERT INTO events (id, user_id, title, start_date, end_date, category, is_annual, is_lunar, is_public, source_post_id)
           VALUES (?, ?, ?, ?, ?, '일정', 0, 0, 1, ?)`
        ).bind(uuid(), uid, title, x.period.start, x.period.end, postId)
      );
    }
  }
  return st;
}
async function privatePostOf(env, targetType, targetId) {
  if (targetType !== "post") return null;
  const p = await env.DB.prepare("SELECT board, author_id FROM posts WHERE id=?").bind(targetId).first();
  return p && PRIVATE_BOARDS.has(p.board) ? p : null;
}
function parseAttachments(raw) {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
function shapePost(r, includeBody) {
  return {
    id: r.id,
    board: r.board,
    category: r.category,
    title: r.title,
    ...includeBody ? { body_html: r.body_html ?? "", body_md: r.body_md ?? "" } : {},
    attachments: parseAttachments(r.attachments),
    cover_image: r.cover_image,
    view_count: r.view_count,
    comment_count: r.comment_count ?? 0,
    is_pinned: r.is_pinned === 1,
    // 목록용 본문 앞부분(오리알터 피드 카드) — 목록에서만 채운다
    ...r.excerpt != null ? { excerpt: r.excerpt } : {},
    // 소식 일정 기간(달력에 들어간 일정) — 없으면 null
    period: r.ev_start ? { start: r.ev_start, end: r.ev_end ?? null } : null,
    // 최근 댓글 한 건(오리알터 피드 카드 아래 미리보기 — 밴드처럼)
    ...r.lc_body != null ? { last_comment: { body: r.lc_body, author: r.lc_author ?? "회원", created_at: toIsoUtc(r.lc_at) } } : {},
    created_at: toIsoUtc(r.created_at),
    updated_at: toIsoUtc(r.updated_at),
    author: {
      display_name: r.author_name,
      avatar_url: r.author_avatar,
      affiliation: r.author_affiliation,
      level: r.author_level,
      branch: r.author_branch ?? null
      // 교인 인증 지부 코드(src/data/branches.ts)
    },
    author_id: r.author_uid
  };
}
const POST_COMMENT_COUNT_SQL = "(SELECT COUNT(*) FROM comments c WHERE c.target_type='post' AND c.target_id=p.id AND c.status='published')";
async function listPosts(req, env) {
  const url = new URL(req.url);
  const board = url.searchParams.get("board");
  const category = url.searchParams.get("category");
  const before = url.searchParams.get("before");
  const qs = url.searchParams.getAll("q").map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const hasImage = url.searchParams.get("has_image") === "1";
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit")) || POST_PAGE_SIZE)
  );
  const where = ["p.status='published'"];
  const binds = [];
  const viewer = await viewerOf(req, env);
  if (!viewer) where.push(`p.board NOT IN (${PRIVATE_BOARDS_SQL})`);
  else if (viewer.level < 4) {
    where.push(`(p.board NOT IN (${PRIVATE_BOARDS_SQL}) OR p.author_id = ?)`);
    binds.push(viewer.id);
  }
  if (board) {
    const boards = board.split(",").map((b) => b.trim()).filter((b) => ALLOWED_BOARDS.has(b));
    if (boards.length === 0) return json({ error: "invalid board" }, 400);
    where.push(`p.board IN (${boards.map(() => "?").join(",")})`);
    binds.push(...boards);
  }
  if (category) {
    where.push("p.category=?");
    binds.push(category);
  }
  const author = url.searchParams.get("author");
  if (author) {
    where.push("p.author_id=?");
    binds.push(author);
  }
  if (hasImage) where.push("p.cover_image IS NOT NULL");
  for (const t of qs) {
    where.push("(p.title LIKE ? OR p.body_md LIKE ?)");
    binds.push(`%${t}%`, `%${t}%`);
  }
  const pageNo = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
  if (before && !pageNo) {
    where.push("p.is_pinned=0 AND p.created_at < ?");
    binds.push(before);
  }
  const from = !pageNo && !before ? url.searchParams.get("from") : null;
  let fromOrder = "";
  if (from) {
    const fr = await env.DB.prepare("SELECT created_at FROM posts WHERE id=? AND status='published'").bind(from).first();
    if (fr) {
      where.push("p.is_pinned=0 AND p.created_at <= ?");
      binds.push(fr.created_at);
      fromOrder = "CASE WHEN p.id = ? THEN 0 ELSE 1 END, ";
    }
  }
  const rows = await env.DB.prepare(
    `SELECT p.id, p.board, p.category, p.title, p.attachments, p.cover_image,
            p.view_count, p.is_pinned, p.status, p.created_at, p.updated_at,
            substr(p.body_md, 1, 1200) AS excerpt, mp.branch AS author_branch,
            lc.body AS lc_body, lc.created_at AS lc_at, lcu.display_name AS lc_author,
            (SELECT e.start_date FROM events e WHERE e.source_post_id = p.id LIMIT 1) AS ev_start,
            (SELECT e.end_date FROM events e WHERE e.source_post_id = p.id LIMIT 1) AS ev_end,
            u.id AS author_uid, u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.affiliation AS author_affiliation, u.level AS author_level,
            ${POST_COMMENT_COUNT_SQL} AS comment_count
     FROM posts p JOIN users u ON u.id = p.author_id
     LEFT JOIN member_profiles mp ON mp.user_id = u.id
     LEFT JOIN comments lc ON lc.id = (
       SELECT c2.id FROM comments c2 WHERE c2.target_type='post' AND c2.target_id=p.id AND c2.status='published' AND c2.parent_id IS NULL
       ORDER BY c2.created_at DESC LIMIT 1)
     LEFT JOIN users lcu ON lcu.id = lc.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${fromOrder}p.is_pinned DESC, p.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, ...fromOrder ? [from] : [], limit + 1, pageNo ? (pageNo - 1) * limit : 0).all();
  let total = null;
  if (pageNo) {
    const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where.join(" AND ")}`).bind(...binds).first();
    total = c?.n ?? 0;
  }
  const results = rows.results ?? [];
  const hasMore = results.length > limit;
  const page = results.slice(0, limit);
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;
  return json({
    posts: page.map((r) => shapePost(r, false)),
    next: pageNo ? null : nextCursor,
    has_more: hasMore,
    ...pageNo ? { page: pageNo, total, pages: Math.max(1, Math.ceil((total ?? 0) / limit)) } : {}
  });
}
async function listPostAuthors(req, env) {
  const url = new URL(req.url);
  const board = url.searchParams.get("board") ?? "";
  if (!ALLOWED_BOARDS.has(board) || PRIVATE_BOARDS.has(board)) return json({ error: "invalid board" }, 400);
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 10));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rs = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.avatar_url, mp.branch, MAX(p.created_at) AS last_at, COUNT(*) AS posts
       FROM posts p JOIN users u ON u.id = p.author_id
       LEFT JOIN member_profiles mp ON mp.user_id = u.id
      WHERE p.board = ? AND p.status = 'published'
      GROUP BY u.id
      ORDER BY last_at DESC
      LIMIT ? OFFSET ?`
  ).bind(board, limit + 1, offset).all();
  const rows = rs.results ?? [];
  return json({
    authors: rows.slice(0, limit).map((r) => ({ ...r, last_at: toIsoUtc(r.last_at) })),
    has_more: rows.length > limit
  });
}
async function preparePostBlocks(env, raw, req, uid, existingBlocksJson = null) {
  const normalized = normalizeBlocks(raw, { allowMedia: false, allowKey: true });
  if (!normalized.length) throw new BlockError("본문이 비어 있습니다. 블록을 하나 이상 채워 주세요");
  const prev = parseStoredBlocks(existingBlocksJson) ?? [];
  const keep = new Set(allKeys(prev));
  const keepPoints = new Set(allPointIds(prev));
  const blocks = await resolveBlocks(env.DB, normalized, siteHosts(env, req), { owner: uid, keep }, { keep: keepPoints });
  const json_ = JSON.stringify(blocks);
  if (json_.length > 6e4) throw new BlockError("본문이 너무 깁니다");
  const { html, rctx } = await renderRowBlocks(env, blocks);
  const attachments = [];
  for (const b of blocks) {
    if (b.type === "image") {
      for (const it of imageItems(b)) {
        const k = it.key ? rctx.keys.get(it.key) : void 0;
        if (k) attachments.push({ type: "image", url: k.url, ...k.width ? { width: k.width, height: k.height } : {} });
      }
    } else if (b.type === "video" && b.video_id) {
      attachments.push({ type: "video", provider: "youtube", videoId: b.video_id, url: `https://www.youtube.com/watch?v=${b.video_id}` });
    }
  }
  const cover = attachments.find((a) => a.type === "image")?.url ?? null;
  return { blocks, json: json_, html, plain: plainFromBlocks(blocks, rctx), attachments, cover };
}
function legacyPostBlocks(env, bodyMd, attachments) {
  const out = [];
  let n = 0;
  const id = () => `legacy${++n}xx`;
  if (bodyMd.trim()) out.push({ id: id(), type: "text", text: bodyMd });
  const base = (env.UPLOADS_PUBLIC_BASE || "").replace(/\/$/, "");
  for (const a of attachments) {
    if (a?.type === "video" && a.videoId) out.push({ id: id(), type: "video", video_id: a.videoId });
    if (a?.type === "image" && typeof a.url === "string" && base && a.url.startsWith(base + "/")) {
      out.push({ id: id(), type: "image", items: [{ key: a.url.slice(base.length + 1) }] });
    }
  }
  return out;
}
async function createPost(req, env) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || !u.display_name) return json({ error: "닉네임 설정 필요" }, 403);
  if ((u.level ?? 0) < 1) return json({ error: "글쓰기 권한 없음" }, 403);
  const body = await req.json().catch(() => ({}));
  const board = body.board ?? "";
  if (!ALLOWED_BOARDS.has(board)) return json({ error: "invalid board" }, 400);
  if (OPERATOR_BOARDS.has(board) && (u.level ?? 0) < 4) {
    return json({ error: "운영자만 작성 가능" }, 403);
  }
  if ((u.level ?? 0) < (BOARD_MIN_LEVEL[board] ?? 1)) {
    return json({ error: "교인 인증 회원만 쓸 수 있습니다" }, 403);
  }
  let title = (body.title ?? "").trim();
  const titleOptional = TITLE_OPTIONAL_BOARDS.has(board);
  if (!titleOptional && title.length === 0 || title.length > 200) {
    return json({ error: "제목은 1~200자여야 합니다" }, 400);
  }
  const nx = board === NEWS_BOARD ? newsExtras(body) : {};
  if (nx.error) return json({ error: nx.error }, 400);
  let libSeries = null;
  if (board === LIBRARY_BOARD) {
    const lf = await normLibraryPostFields(env.DB, body);
    if ("error" in lf) return json({ error: lf.error }, 400);
    body.category = lf.category;
    libSeries = lf.series_id;
  }
  const id = uuid();
  if (body.blocks !== void 0) {
    let pb;
    try {
      pb = await preparePostBlocks(env, body.blocks, req, uid);
    } catch (e) {
      if (e instanceof BlockError) return json({ error: e.message }, 400);
      throw e;
    }
    if (!title) title = autoTitleFromBlocks(pb);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posts (id, board, category, title, body_md, body_html, body_blocks, author_id, attachments, cover_image, series_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        board,
        body.category ?? null,
        title,
        pb.plain,
        pb.html,
        pb.json,
        uid,
        pb.attachments.length ? JSON.stringify(pb.attachments) : null,
        pb.cover,
        libSeries
      ),
      ...refIndexStmts(env, "post", id, pb.blocks),
      ...newsExtraStmts(env, id, uid, title, nx)
    ]);
    return json({ ok: true, id });
  }
  const text = (body.body ?? "").trim();
  const attachments = sanitizeAttachments(body.attachments, env);
  if (text.length === 0 && attachments.length === 0) {
    return json({ error: "본문 또는 첨부가 필요합니다" }, 400);
  }
  if (!title) return json({ error: "제목은 1~200자여야 합니다" }, 400);
  if (text.length > 2e4) return json({ error: "본문이 너무 깁니다" }, 400);
  const attJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
  const cover = attachments.find((a) => a.type === "image");
  await env.DB.prepare(
    `INSERT INTO posts (id, board, category, title, body_md, body_html, author_id, attachments, cover_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    board,
    body.category ?? null,
    title,
    text,
    renderNewsMarkdown(text),
    uid,
    attJson,
    cover?.url ?? null
  ).run();
  return json({ ok: true, id });
}
async function getPost(req, env, id) {
  const r = await env.DB.prepare(
    `SELECT p.id, p.board, p.category, p.series_id, p.title, p.body_md, p.body_html, p.body_blocks, p.attachments, p.cover_image,
            p.view_count, p.is_pinned, p.status, p.created_at, p.updated_at,
            u.id AS author_uid, u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.affiliation AS author_affiliation, u.level AS author_level, mp.branch AS author_branch,
            (SELECT e.start_date FROM events e WHERE e.source_post_id = p.id LIMIT 1) AS ev_start,
            (SELECT e.end_date FROM events e WHERE e.source_post_id = p.id LIMIT 1) AS ev_end,
            ${POST_COMMENT_COUNT_SQL} AS comment_count
     FROM posts p JOIN users u ON u.id = p.author_id
     LEFT JOIN member_profiles mp ON mp.user_id = u.id
     WHERE p.id=? AND p.status='published'`
  ).bind(id).first();
  if (!r) return json({ error: "not found" }, 404);
  if (PRIVATE_BOARDS.has(r.board) && !canSeePost(r.board, r.author_uid, await viewerOf(req, env))) {
    return json({ error: "not found" }, 404);
  }
  await env.DB.prepare("UPDATE posts SET view_count = view_count + 1 WHERE id=?").bind(id).run();
  const shaped = shapePost(r, true);
  shaped.view_count += 1;
  shaped.series_id = r.series_id ?? null;
  const stored = parseStoredBlocks(r.body_blocks);
  if (stored) {
    const { html, rctx } = await renderRowBlocks(env, stored);
    shaped.body_html = html;
    shaped.blocks = blocksForEditor(stored, rctx);
    shaped.has_blocks = true;
  } else {
    const legacy = legacyPostBlocks(env, r.body_md ?? "", shaped.attachments);
    const { rctx } = await renderRowBlocks(env, legacy);
    shaped.blocks = blocksForEditor(legacy, rctx);
    shaped.has_blocks = false;
  }
  return json({ post: shaped });
}
function autoTitleFromBlocks(pb) {
  const first = pb.plain.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const photos = pb.attachments.filter((a) => a.type === "image").length;
  return first ? first.length > 40 ? first.slice(0, 40) + "…" : first : photos ? `사진 ${photos}장` : "오리알터";
}
async function updatePost(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  const post = await env.DB.prepare(
    "SELECT author_id, status, board, body_blocks, category, series_id, title FROM posts WHERE id=?"
  ).bind(id).first();
  if (!post || post.status === "deleted") return json({ error: "not found" }, 404);
  const isOwner = post.author_id === uid;
  const isAdmin = (u?.level ?? 0) >= 4;
  if (!isOwner && !isAdmin) return json({ error: "forbidden" }, 403);
  if (OPERATOR_BOARDS.has(post.board) && !isAdmin) return json({ error: "운영자만 수정할 수 있습니다" }, 403);
  const body = await req.json().catch(() => ({}));
  let title = (body.title ?? "").trim();
  if (!title && TITLE_OPTIONAL_BOARDS.has(post.board)) title = post.title ?? "";
  if (title.length === 0 || title.length > 200) {
    return json({ error: "제목은 1~200자여야 합니다" }, 400);
  }
  const nx = post.board === NEWS_BOARD ? newsExtras(body) : {};
  if (nx.error) return json({ error: nx.error }, 400);
  const newsStmts = post.board === NEWS_BOARD ? [
    ...newsExtraStmts(env, id, uid, title, nx),
    ...nx.period === void 0 ? [env.DB.prepare("UPDATE events SET title=?, updated_at=datetime('now') WHERE source_post_id=?").bind(title, id)] : []
  ] : [];
  let libSeries = post.series_id;
  if (post.board === LIBRARY_BOARD) {
    const lf = await normLibraryPostFields(
      env.DB,
      { category: body.category, series_id: "series_id" in body ? body.series_id : post.series_id },
      post.category ?? LIBRARY_BOARD
    );
    if ("error" in lf) return json({ error: lf.error }, 400);
    body.category = lf.category;
    libSeries = lf.series_id;
  }
  if (body.blocks !== void 0) {
    let pb;
    try {
      pb = await preparePostBlocks(env, body.blocks, req, uid, post.body_blocks);
    } catch (e) {
      if (e instanceof BlockError) return json({ error: e.message }, 400);
      throw e;
    }
    if (!(body.title ?? "").trim() && TITLE_OPTIONAL_BOARDS.has(post.board)) title = autoTitleFromBlocks(pb);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE posts SET title=?, body_md=?, body_html=?, body_blocks=?, category=?, attachments=?, cover_image=?, series_id=?, updated_at=datetime('now')
         WHERE id=?`
      ).bind(
        title,
        pb.plain,
        pb.html,
        pb.json,
        body.category ?? null,
        pb.attachments.length ? JSON.stringify(pb.attachments) : null,
        pb.cover,
        libSeries,
        id
      ),
      ...refIndexStmts(env, "post", id, pb.blocks),
      ...newsStmts
    ]);
    return json({ ok: true });
  }
  const text = (body.body ?? "").trim();
  const attachments = sanitizeAttachments(body.attachments, env);
  if (text.length === 0 && attachments.length === 0) {
    return json({ error: "본문 또는 첨부가 필요합니다" }, 400);
  }
  const attJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
  const cover = attachments.find((a) => a.type === "image");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE posts SET title=?, body_md=?, body_html=?, body_blocks=NULL, category=?, attachments=?, cover_image=?, updated_at=datetime('now')
       WHERE id=?`
    ).bind(title, text, renderNewsMarkdown(text), body.category ?? null, attJson, cover?.url ?? null, id),
    env.DB.prepare("DELETE FROM content_refs WHERE from_type='post' AND from_id=?").bind(id)
  ]);
  return json({ ok: true });
}
async function deletePost(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  const post = await env.DB.prepare(
    "SELECT author_id, board FROM posts WHERE id=?"
  ).bind(id).first();
  if (!post) return json({ error: "not found" }, 404);
  const isOwner = post.author_id === uid;
  const isAdmin = (u?.level ?? 0) >= 4;
  if (!isOwner && !isAdmin) return json({ error: "forbidden" }, 403);
  if (OPERATOR_BOARDS.has(post.board) && !isAdmin) return json({ error: "운영자만 삭제할 수 있습니다" }, 403);
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET status='deleted', updated_at=datetime('now') WHERE id=?").bind(id),
    // 소식 글에서 온 달력 일정도 함께 지운다
    env.DB.prepare("DELETE FROM events WHERE source_post_id=?").bind(id)
  ]);
  return json({ ok: true });
}
async function pinPost(req, env, id) {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if ((u?.level ?? 0) < 4) return json({ error: "forbidden" }, 403);
  const post = await env.DB.prepare(
    "SELECT is_pinned FROM posts WHERE id=?"
  ).bind(id).first();
  if (!post) return json({ error: "not found" }, 404);
  const next = post.is_pinned === 1 ? 0 : 1;
  await env.DB.prepare("UPDATE posts SET is_pinned=? WHERE id=?").bind(next, id).run();
  return json({ ok: true, is_pinned: next === 1 });
}
