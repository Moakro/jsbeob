// 옛 홈페이지 보관함 API — 읽기 전용 (2026-11-12)
//   GET /api/legacy/categories                         분류별 글 수
//   GET /api/legacy/posts?board=&category=&q=&page=   목록(30개씩, 최신순)
//   GET /api/legacy/posts/:board/:cid[?lp=]            글 + 댓글 + 아래 목록(같은 분류, 15개씩, 기본은 지금 글이 든 쪽)
// 데이터는 옛 사이트에서 옮겨 온 그대로이며 이 API로는 쓰지 않는다.

const PAGE_SIZE = 30;
const BOARD_RE = /^[a-z]{2,20}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

async function categories(env) {
  const rs = await env.DB.prepare(
    "SELECT board, category, COUNT(*) AS n FROM legacy_posts GROUP BY board, category ORDER BY n DESC"
  ).all();
  return json({ items: rs.results ?? [] });
}

async function list(url: URL, env) {
  const board = url.searchParams.get("board") ?? "";
  const category = (url.searchParams.get("category") ?? "").slice(0, 40);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(10000, parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (board) {
    if (!BOARD_RE.test(board)) return json({ error: "board" }, 400);
    where.push("board=?");
    binds.push(board);
  }
  if (category) {
    where.push("category=?");
    binds.push(category);
  }
  if (q) {
    // 제목·작성자에서 찾는다 (LIKE 특수문자는 글자로)
    const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    where.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')");
    binds.push(like, like);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM legacy_posts ${w}`).bind(...binds).first())?.n ?? 0;
  const rs = await env.DB.prepare(
    `SELECT board, cid, category, title, author, created_at, hits, comment_count
       FROM legacy_posts ${w} ORDER BY created_at DESC, cid DESC LIMIT ? OFFSET ?`
  ).bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
  return json({ items: rs.results ?? [], total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), size: PAGE_SIZE });
}

// 글 보기 아래 목록(옛 사이트처럼 같은 분류 글 목록) — 한 쪽 15개
const BOTTOM_SIZE = 15;

async function bottomList(env, post, lpParam: string | null) {
  const where = "board=? AND category IS ?";
  const binds = [post.board, post.category];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM legacy_posts WHERE ${where}`).bind(...binds).first())?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / BOTTOM_SIZE));
  // 쪽을 따로 고르지 않으면 지금 글이 들어 있는 쪽 (최신순에서 지금 글보다 앞선 글 수로 계산)
  const before =
    (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM legacy_posts WHERE ${where} AND (created_at > ? OR (created_at = ? AND cid > ?))`
    ).bind(...binds, post.created_at, post.created_at, post.cid).first())?.n ?? 0;
  const own = Math.floor(before / BOTTOM_SIZE) + 1;
  const lp = Math.max(1, Math.min(pages, parseInt(lpParam ?? "", 10) || own));
  const rs = await env.DB.prepare(
    `SELECT board, cid, category, title, created_at, hits, comment_count FROM legacy_posts WHERE ${where}
      ORDER BY created_at DESC, cid DESC LIMIT ? OFFSET ?`
  ).bind(...binds, BOTTOM_SIZE, (lp - 1) * BOTTOM_SIZE).all();
  return { items: rs.results ?? [], page: lp, pages, own, total };
}

async function one(env, board: string, cid: number, lpParam: string | null = null) {
  if (!BOARD_RE.test(board) || !Number.isInteger(cid)) return json({ error: "not found" }, 404);
  const post = await env.DB.prepare("SELECT * FROM legacy_posts WHERE board=? AND cid=?").bind(board, cid).first();
  if (!post) return json({ error: "not found" }, 404);
  const list = await bottomList(env, post, lpParam);
  const rs = await env.DB.prepare(
    "SELECT id, parent_id, author, created_at, body_html FROM legacy_comments WHERE board=? AND post_cid=? ORDER BY id"
  ).bind(board, cid).all();
  // 같은 분류의 앞뒤 글
  const prev = await env.DB.prepare(
    "SELECT board, cid, title FROM legacy_posts WHERE board=? AND category IS ? AND (created_at < ? OR (created_at = ? AND cid < ?)) ORDER BY created_at DESC, cid DESC LIMIT 1"
  ).bind(board, post.category, post.created_at, post.created_at, cid).first();
  const next = await env.DB.prepare(
    "SELECT board, cid, title FROM legacy_posts WHERE board=? AND category IS ? AND (created_at > ? OR (created_at = ? AND cid > ?)) ORDER BY created_at ASC, cid ASC LIMIT 1"
  ).bind(board, post.category, post.created_at, post.created_at, cid).first();
  return json({ post, comments: rs.results ?? [], prev: prev ?? null, next: next ?? null, list });
}

export async function handleLegacy(req: Request, env, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/legacy/")) return null;
  if (req.method !== "GET") return json({ error: "읽기 전용입니다" }, 405);
  const url = new URL(req.url);
  if (path === "/api/legacy/categories") return categories(env);
  if (path === "/api/legacy/posts") return list(url, env);
  const m = path.match(/^\/api\/legacy\/posts\/([a-z]+)\/(\d+)$/);
  if (m) return one(env, m[1], Number(m[2]), url.searchParams.get("lp"));
  return json({ error: "not found" }, 404);
}
