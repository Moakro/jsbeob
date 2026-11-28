// 글·댓글 신고와 숨김 (2026-11-28 오너 결정 — 교인이 ＋ 버튼으로 오리알터에 바로 게시 + 신고·숨김)
// 표: migrations/2026-11-28-reports.sql. 숨김은 posts.status / comments.status 의 'hidden'.
//
//   POST /api/posts/<id>/report        {reason?}  로그인 회원 — 한 사람이 같은 글에 한 번
//   POST /api/comments/<id>/report     {reason?}  로그인 회원 — 한 사람이 같은 댓글에 한 번
//   GET  /api/admin/reports?status=open|all       관리자 — 대상별로 묶은 신고 목록
//   POST /api/admin/reports/<post|comment>/<id>  {action: hide|restore|keep}  관리자 — 숨김·되살리기·문제없음
//
// 관리자 알림은 화면 배지만(이메일·디스코드 연동 안 함): /api/me 의 reports_open (관리자에게만).
import { LEVEL } from "../src/data/levels";

const REASON_MAX = 500;
const ACTIONS = { hide: "hidden", restore: "restored", keep: "kept" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" }
  });
}
const toIso = (s) => (s && !/Z$|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") + "Z" : s);

/** 처리 전 신고가 있는 대상 수 — 관리자 배지 */
export async function openReportCount(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM (SELECT 1 FROM reports WHERE status='open' GROUP BY target_type, target_id)"
  ).first();
  return r?.n ?? 0;
}

/**
 * deps.requestUser(req) → {id, level, display_name} | {error, status}
 * deps.canSeePost(post, user) → boolean — 이 사람이 그 글을 볼 수 있나(게시판 읽기·비공개·숨김)
 */
export async function handleReports(req, env, path, deps) {
  const m = req.method;
  const rp = path.match(/^\/api\/(posts|comments)\/([^/]+)\/report$/);
  if (rp && m === "POST") return createReport(req, env, rp[1] === "posts" ? "post" : "comment", rp[2], deps);
  if (path === "/api/admin/reports" && m === "GET") return adminList(req, env, deps);
  const ap = path.match(/^\/api\/admin\/reports\/(post|comment)\/([^/]+)$/);
  if (ap && m === "POST") return adminAct(req, env, ap[1], ap[2], deps);
  return null;
}

async function createReport(req, env, type, id, deps) {
  const u = await deps.requestUser(req);
  if (u.error) return json({ error: u.error }, u.status);
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim().slice(0, REASON_MAX);
  let owner;
  if (type === "post") {
    const p = await env.DB.prepare("SELECT id, board, author_id, is_private, status FROM posts WHERE id=?").bind(id).first();
    if (!p || p.status !== "published" || !(await deps.canSeePost(p, u))) return json({ error: "글을 찾을 수 없습니다" }, 404);
    owner = p.author_id;
  } else {
    const c = await env.DB.prepare(
      `SELECT c.user_id, c.status, c.target_type, p.id AS pid, p.board, p.author_id, p.is_private, p.status AS pstatus
         FROM comments c LEFT JOIN posts p ON c.target_type='post' AND p.id=c.target_id WHERE c.id=?`
    ).bind(id).first();
    if (!c || c.status !== "published") return json({ error: "댓글을 찾을 수 없습니다" }, 404);
    if (c.pid && (c.pstatus !== "published" || !(await deps.canSeePost({ id: c.pid, board: c.board, author_id: c.author_id, is_private: c.is_private, status: c.pstatus }, u)))) {
      return json({ error: "댓글을 찾을 수 없습니다" }, 404);
    }
    owner = c.user_id;
  }
  if (owner === u.id) return json({ error: "내가 쓴 것은 신고할 수 없습니다" }, 400);
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (target_type, target_id, user_id, reason) VALUES (?, ?, ?, ?)"
  ).bind(type, id, u.id, reason).run();
  const already = !r.meta?.changes;
  return json({ ok: true, already }, already ? 200 : 201);
}

async function requireAdmin(req, deps) {
  const u = await deps.requestUser(req);
  if (u.error) return { res: json({ error: u.error }, u.status) };
  if ((u.level ?? 0) < LEVEL.ADMIN) return { res: json({ error: "관리자만 쓸 수 있습니다" }, 403) };
  return { u };
}

async function adminList(req, env, deps) {
  const { u, res } = await requireAdmin(req, deps);
  if (res) return res;
  const all = new URL(req.url).searchParams.get("status") === "all";
  // 대상별로 묶는다 — 처리 전만 보거나, 최근 처리한 것까지(200개)
  const groups = await env.DB.prepare(
    `SELECT target_type, target_id, COUNT(*) AS n,
            SUM(status='open') AS open_n, MAX(created_at) AS last_at,
            MAX(resolved_at) AS resolved_at, MAX(resolution) AS resolution
       FROM reports ${all ? "" : "WHERE status='open'"}
      GROUP BY target_type, target_id
      ORDER BY open_n > 0 DESC, last_at DESC
      LIMIT 200`
  ).all();
  const rows = groups.results ?? [];
  if (!rows.length) return json({ reports: [], open: 0 });
  const postIds = rows.filter((r) => r.target_type === "post").map((r) => r.target_id);
  const cmtIds = rows.filter((r) => r.target_type === "comment").map((r) => r.target_id);
  const q = (n) => Array(n).fill("?").join(",");
  const posts = new Map();
  if (postIds.length) {
    const rs = await env.DB.prepare(
      `SELECT p.id, p.board, p.title, p.status, p.cover_image, substr(p.body_md, 1, 300) AS excerpt, p.created_at,
              u.id AS author_id, u.display_name AS author_name
         FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id IN (${q(postIds.length)})`
    ).bind(...postIds).all();
    for (const r of rs.results ?? []) posts.set(r.id, r);
  }
  const cmts = new Map();
  if (cmtIds.length) {
    const rs = await env.DB.prepare(
      `SELECT c.id, c.status, substr(c.body, 1, 300) AS excerpt, c.target_type, c.target_id, c.created_at,
              u.id AS author_id, u.display_name AS author_name, p.board AS post_board, p.title AS post_title
         FROM comments c JOIN users u ON u.id = c.user_id
         LEFT JOIN posts p ON c.target_type='post' AND p.id=c.target_id
        WHERE c.id IN (${q(cmtIds.length)})`
    ).bind(...cmtIds).all();
    for (const r of rs.results ?? []) cmts.set(r.id, r);
  }
  // 신고 한 건씩(이유·신고한 사람) — 대상마다 최근 20건
  const keys = rows.map((r) => `${r.target_type}:${r.target_id}`);
  const detail = await env.DB.prepare(
    `SELECT r.target_type, r.target_id, r.reason, r.status, r.created_at, u.display_name AS reporter
       FROM reports r JOIN users u ON u.id = r.user_id
      WHERE (r.target_type || ':' || r.target_id) IN (${q(keys.length)})
      ORDER BY r.created_at DESC`
  ).bind(...keys).all();
  const byKey = new Map();
  for (const d of detail.results ?? []) {
    const k = `${d.target_type}:${d.target_id}`;
    const list = byKey.get(k) ?? [];
    if (list.length < 20) list.push({ reason: d.reason, reporter: d.reporter ?? "회원", open: d.status === "open", created_at: toIso(d.created_at) });
    byKey.set(k, list);
  }
  const out = rows.map((r) => {
    const k = `${r.target_type}:${r.target_id}`;
    let target = null;
    if (r.target_type === "post") {
      const p = posts.get(r.target_id);
      if (p)
        target = {
          id: p.id,
          board: p.board,
          title: p.title,
          status: p.status,
          excerpt: p.excerpt,
          cover_image: p.cover_image,
          author: { id: p.author_id, name: p.author_name },
          created_at: toIso(p.created_at),
          href: `/community/${p.board}/${p.id}/`
        };
    } else {
      const c = cmts.get(r.target_id);
      if (c)
        target = {
          id: c.id,
          status: c.status,
          excerpt: c.excerpt,
          author: { id: c.author_id, name: c.author_name },
          created_at: toIso(c.created_at),
          post_title: c.post_title ?? null,
          href: c.target_type === "post" && c.post_board ? `/community/${c.post_board}/${c.target_id}/` : null
        };
    }
    return {
      type: r.target_type,
      id: r.target_id,
      count: r.n,
      open: r.open_n ?? 0,
      last_at: toIso(r.last_at),
      resolution: r.open_n ? null : r.resolution,
      resolved_at: toIso(r.resolved_at),
      target,
      items: byKey.get(k) ?? []
    };
  });
  return json({ reports: out, open: await openReportCount(env), me: u.id });
}

async function adminAct(req, env, type, id, deps) {
  const { u, res } = await requireAdmin(req, deps);
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const resolution = ACTIONS[body.action];
  if (!resolution) return json({ error: "action 은 hide·restore·keep 중 하나여야 합니다" }, 400);
  const table = type === "post" ? "posts" : "comments";
  const row = await env.DB.prepare(`SELECT status FROM ${table} WHERE id=?`).bind(id).first();
  // 글쓴이가 지운 대상 — 숨김·되살리기는 못 하고, '확인'(keep)으로 열린 신고만 닫는다(배지가 남지 않게)
  const gone = !row || row.status === "deleted";
  if (gone && body.action !== "keep") return json({ error: "이미 지워졌거나 없는 대상입니다" }, 404);
  const stmts = [];
  let status = gone ? "deleted" : row.status;
  if (body.action === "hide" && row.status === "published") status = "hidden";
  if (body.action === "restore" && row.status === "hidden") status = "published";
  if (!gone && status !== row.status) {
    // 숨김·되살리기는 글 수정 시각(updated_at)을 건드리지 않는다 — '수정됨'처럼 보이지 않게
    stmts.push(env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(status, id));
  }
  // 숨김·되살리기는 그 대상의 신고 전부에(지난 처리 기록도 최신 상태로), 문제없음은 열린 신고에만
  stmts.push(
    env.DB.prepare(
      `UPDATE reports SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now')
        WHERE target_type=? AND target_id=? ${body.action === "keep" ? "AND status='open'" : ""}`
    ).bind(resolution, u.id, type, id)
  );
  await env.DB.batch(stmts);
  return json({ ok: true, status, open: await openReportCount(env) });
}
