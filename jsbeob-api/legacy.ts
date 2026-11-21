// 옛 홈페이지 보관함 API — 읽기 전용 (2026-11-12)
//   GET /api/legacy/categories                         분류별 글 수
//   GET /api/legacy/posts?board=&category=&q=&page=   목록(30개씩, 최신순)
//   GET /api/legacy/posts/:board/:cid[?lp=&cat=]       글 + 댓글 + 아래 목록(cat 없으면 게시판 전체, 있으면 그 분류. 15개씩, 기본은 지금 글이 든 쪽)
// 데이터는 옛 사이트에서 옮겨 온 그대로이며 이 API로는 쓰지 않는다.
// 2026-11-21: 순번(seq_board·seq_cat)과 글 수(legacy_counts)를 미리 계산해 두고 읽는다 — 글마다 표 전체를 세던
// COUNT·GROUP BY 가 하루 D1 읽기 한도를 넘겼다(migrations/2026-11-21-legacy-seq.sql). 검색(q)과 전체 목록만 예전 방식.

const PAGE_SIZE = 30;
const BOARD_RE = /^[a-z]{2,20}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

async function categories(env) {
  const rs = await env.DB.prepare("SELECT board, category, n FROM legacy_counts ORDER BY n DESC").all();
  return json({ items: rs.results ?? [] });
}

/** 게시판(·분류) 글 수 — legacy_counts 에서 */
async function countOf(env, board: string, category?: string | null, byCat = false): Promise<number> {
  const r = byCat
    ? await env.DB.prepare("SELECT n FROM legacy_counts WHERE board=? AND category IS ?").bind(board, category ?? null).first()
    : await env.DB.prepare("SELECT SUM(n) AS n FROM legacy_counts WHERE board=?").bind(board).first();
  return (r?.n as number) ?? 0;
}

const LIST_COLS = "board, cid, category, title, author, created_at, hits, comment_count";

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
  // 게시판(·분류) 목록은 미리 계산한 순번 범위로 — 읽는 행이 한 쪽(30개)뿐
  if (board && !q) {
    const byCat = !!category;
    const total = await countOf(env, board, category || null, byCat);
    const from = (page - 1) * PAGE_SIZE + 1;
    const rs = byCat
      ? await env.DB.prepare(
          `SELECT ${LIST_COLS} FROM legacy_posts WHERE board=? AND category=? AND seq_cat BETWEEN ? AND ? ORDER BY seq_cat`
        ).bind(board, category, from, from + PAGE_SIZE - 1).all()
      : await env.DB.prepare(
          `SELECT ${LIST_COLS} FROM legacy_posts WHERE board=? AND seq_board BETWEEN ? AND ? ORDER BY seq_board`
        ).bind(board, from, from + PAGE_SIZE - 1).all();
    return json({ items: rs.results ?? [], total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), size: PAGE_SIZE });
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM legacy_posts ${w}`).bind(...binds).first())?.n ?? 0;
  const rs = await env.DB.prepare(
    `SELECT board, cid, category, title, author, created_at, hits, comment_count
       FROM legacy_posts ${w} ORDER BY created_at DESC, cid DESC LIMIT ? OFFSET ?`
  ).bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
  return json({ items: rs.results ?? [], total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), size: PAGE_SIZE });
}

// 글 보기 아래 목록 — 한 쪽 15개. 범위는 글을 연 목록을 따른다 (2026-11-14 사용자 지시):
//   cat 없음 → 그 게시판 전체 / cat = 그 글의 분류 → 그 분류. (그 글의 분류가 아닌 cat 은 무시하고 게시판 전체)
const BOTTOM_SIZE = 15;

async function bottomList(env, post, lpParam: string | null, catParam: string | null = null) {
  const byCat = !!catParam && catParam === post.category;
  const total = await countOf(env, post.board, post.category, byCat);
  const pages = Math.max(1, Math.ceil(total / BOTTOM_SIZE));
  // 쪽을 따로 고르지 않으면 지금 글이 들어 있는 쪽 (최신순 순번으로 계산)
  const seq = (byCat ? post.seq_cat : post.seq_board) ?? 1;
  const own = Math.floor((seq - 1) / BOTTOM_SIZE) + 1;
  const lp = Math.max(1, Math.min(pages, parseInt(lpParam ?? "", 10) || own));
  const from = (lp - 1) * BOTTOM_SIZE + 1;
  const cols = "board, cid, category, title, created_at, hits, comment_count";
  const rs = byCat
    ? await env.DB.prepare(
        `SELECT ${cols} FROM legacy_posts WHERE board=? AND category IS ? AND seq_cat BETWEEN ? AND ? ORDER BY seq_cat`
      ).bind(post.board, post.category, from, from + BOTTOM_SIZE - 1).all()
    : await env.DB.prepare(
        `SELECT ${cols} FROM legacy_posts WHERE board=? AND seq_board BETWEEN ? AND ? ORDER BY seq_board`
      ).bind(post.board, from, from + BOTTOM_SIZE - 1).all();
  return { items: rs.results ?? [], page: lp, pages, own, total, category: byCat ? post.category : null };
}

async function one(env, board: string, cid: number, lpParam: string | null = null, catParam: string | null = null) {
  if (!BOARD_RE.test(board) || !Number.isInteger(cid)) return json({ error: "not found" }, 404);
  const post = await env.DB.prepare("SELECT * FROM legacy_posts WHERE board=? AND cid=?").bind(board, cid).first();
  if (!post) return json({ error: "not found" }, 404);
  const list = await bottomList(env, post, lpParam, catParam);
  const rs = await env.DB.prepare(
    "SELECT id, parent_id, author, created_at, body_html FROM legacy_comments WHERE board=? AND post_cid=? ORDER BY id"
  ).bind(board, cid).all();
  // 같은 분류의 앞뒤 글 — 순번 ±1 (prev = 더 오래된 글, next = 더 새 글)
  const near = "SELECT board, cid, title FROM legacy_posts WHERE board=? AND category IS ? AND seq_cat=?";
  const prev = await env.DB.prepare(near).bind(board, post.category, (post.seq_cat ?? 0) + 1).first();
  const next = post.seq_cat > 1 ? await env.DB.prepare(near).bind(board, post.category, post.seq_cat - 1).first() : null;
  // 순번 칸은 화면에 쓰지 않는다
  delete post.seq_board;
  delete post.seq_cat;
  return json({ post, comments: rs.results ?? [], prev: prev ?? null, next: next ?? null, list });
}

export async function handleLegacy(req: Request, env, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/legacy/")) return null;
  if (req.method !== "GET") return json({ error: "읽기 전용입니다" }, 405);
  const url = new URL(req.url);
  if (path === "/api/legacy/categories") return categories(env);
  if (path === "/api/legacy/posts") return list(url, env);
  const m = path.match(/^\/api\/legacy\/posts\/([a-z]+)\/(\d+)$/);
  if (m) return one(env, m[1], Number(m[2]), url.searchParams.get("lp"), (url.searchParams.get("cat") ?? "").slice(0, 40) || null);
  return json({ error: "not found" }, 404);
}
