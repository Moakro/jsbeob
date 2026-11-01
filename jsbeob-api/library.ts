// 자료실 카테고리·시리즈 API (/api/library/*)
// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
export const LIBRARY_BOARD = "etc";
const RESERVED_KEYS = new Set(["places", "library", "p", "write", "edit", "new", "api", "search", "all"]);
const KEY_RE = /^[a-z][a-z0-9-]{1,29}$/;
const LIST_ORDERS = new Set(["alpha", "toc", "recent"]);
const PAGE = 20;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" }
  });
}
const bad = (msg, status = 400) => json({ error: msg }, status);
const str = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
function shapeCategory(r) {
  return {
    key: r.key,
    label: r.label,
    type: r.type,
    list_order: r.list_order,
    as_book: !!r.as_book,
    sort_order: r.sort_order,
    place: r.place === "side" ? "side" : "main",
    intro: r.intro ?? null
  };
}
async function listCategories(db) {
  const rs = await db.prepare("SELECT * FROM library_categories ORDER BY sort_order, key").all();
  return (rs.results ?? []).map(shapeCategory);
}
async function getCategory(db, key) {
  const r = await db.prepare("SELECT * FROM library_categories WHERE key=?").bind(key).first();
  return r ? shapeCategory(r) : null;
}
export async function isArticleCategory(db, key) {
  return (await getCategory(db, key))?.type === "article";
}
async function isPostCategory(db, key) {
  return (await getCategory(db, key))?.type === "post";
}
export async function handleLibrary(req, env, path, ctx) {
  if (!path.startsWith("/api/library/")) return null;
  const m = req.method;
  const db = env.DB;
  if (path === "/api/library/categories" && m === "GET") return json({ categories: await listCategories(db) });
  if (path === "/api/library/posts" && m === "GET") return listLibraryPosts(req, db);
  let r = path.match(/^\/api\/library\/posts\/([^/]+)\/meta$/);
  if (r && m === "GET") return postMeta(db, decodeURIComponent(r[1]));
  r = path.match(/^\/api\/library\/series\/([^/]+)$/);
  if (r && m === "GET") return seriesToc(db, decodeURIComponent(r[1]));
  const admin = await ctx.adminUser(req);
  if (!admin) return bad("운영자만 할 수 있습니다", 403);
  if (path === "/api/library/categories" && m === "POST") return saveCategory(req, db, null);
  if (path === "/api/library/categories/order" && m === "PUT") return orderCategories(req, db);
  r = path.match(/^\/api\/library\/categories\/([^/]+)$/);
  if (r && m === "PUT") return saveCategory(req, db, decodeURIComponent(r[1]));
  if (r && m === "DELETE") return deleteCategory(db, decodeURIComponent(r[1]));
  if (path === "/api/library/series" && m === "GET") return listSeries(req, db);
  if (path === "/api/library/series" && m === "POST") return createSeries(req, db, admin.id);
  r = path.match(/^\/api\/library\/series\/([^/]+)$/);
  if (r && m === "PUT") return renameSeries(req, db, decodeURIComponent(r[1]));
  if (r && m === "DELETE") return deleteSeries(db, decodeURIComponent(r[1]));
  return bad("not found", 404);
}
async function saveCategory(req, db, key) {
  const raw = await req.json().catch(() => ({}));
  const label = str(raw.label, 40);
  if (!label) return bad("분류 이름을 입력해 주세요");
  const listOrder = raw.list_order ?? "alpha";
  if (!LIST_ORDERS.has(listOrder)) return bad("정렬 방식 값이 잘못되었습니다");
  const asBook = raw.as_book ? 1 : 0;
  if (raw.place !== void 0 && raw.place !== "main" && raw.place !== "side") return bad("첫 화면 자리 값이 잘못되었습니다");
  const intro = raw.intro === void 0 ? void 0 : str(raw.intro, 200) || null;
  if (key === null) {
    const k = str(raw.key, 30).toLowerCase();
    if (!KEY_RE.test(k)) return bad("주소 이름은 영문 소문자로 시작하는 영문·숫자·- 2~30자여야 합니다");
    if (RESERVED_KEYS.has(k)) return bad(`'${k}'는 이미 쓰는 주소라 분류 주소로 쓸 수 없습니다`);
    const type = raw.type;
    if (type !== "article" && type !== "post") return bad("종류(정형 자료/게시물)를 골라 주세요");
    if (await getCategory(db, k)) return bad("같은 주소의 분류가 이미 있습니다", 409);
    await db.prepare(
      `INSERT INTO library_categories (key, label, type, list_order, as_book, place, intro, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM library_categories))`
    ).bind(k, label, type, listOrder, asBook, raw.place ?? "main", intro ?? null).run();
    return json({ category: await getCategory(db, k) }, 201);
  }
  const cur = await getCategory(db, key);
  if (!cur) return bad("분류를 찾을 수 없습니다", 404);
  await db.prepare("UPDATE library_categories SET label=?, list_order=?, as_book=?, place=?, intro=?, updated_at=datetime('now') WHERE key=?").bind(label, listOrder, asBook, raw.place ?? cur.place, intro === void 0 ? cur.intro : intro, key).run();
  return json({ category: await getCategory(db, key) });
}
async function orderCategories(req, db) {
  const raw = await req.json().catch(() => ({}));
  const keys = Array.isArray(raw.keys) ? raw.keys.filter((k) => typeof k === "string") : [];
  if (!keys.length) return bad("순서가 비어 있습니다");
  await db.batch(keys.map((k, i) => db.prepare("UPDATE library_categories SET sort_order=? WHERE key=?").bind(i + 1, k)));
  return json({ categories: await listCategories(db) });
}
async function deleteCategory(db, key) {
  const cur = await getCategory(db, key);
  if (!cur) return bad("분류를 찾을 수 없습니다", 404);
  const n = cur.type === "article" ? await db.prepare("SELECT COUNT(*) AS n FROM articles WHERE section='library' AND kind=?").bind(key).first() : await db.prepare("SELECT COUNT(*) AS n FROM posts WHERE board=? AND category=? AND status<>'deleted'").bind(LIBRARY_BOARD, key).first();
  if ((n?.n ?? 0) > 0) return bad(`이 분류에 글이 ${n.n}건 있습니다. 글을 다른 분류로 옮긴 뒤 지워 주세요`, 409);
  await db.prepare("DELETE FROM library_categories WHERE key=?").bind(key).run();
  return json({ ok: true });
}
async function listLibraryPosts(req, db) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? "";
  if (!await isPostCategory(db, category)) return bad("invalid category");
  const before = url.searchParams.get("before");
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || PAGE));
  const rs = await db.prepare(
    `SELECT p.id, p.title, p.category, p.created_at, p.series_id,
              s.title AS series_title,
              CASE WHEN p.series_id IS NULL THEN NULL
                   ELSE (SELECT COUNT(*) FROM posts c WHERE c.series_id = p.series_id AND c.status='published') END AS series_count
       FROM posts p LEFT JOIN series s ON s.id = p.series_id
       WHERE p.board = ? AND p.category = ? AND p.status = 'published'
         ${before ? "AND p.created_at < ?" : ""}
         AND (p.series_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM posts q
               WHERE q.series_id = p.series_id AND q.status = 'published' AND q.created_at > p.created_at))
       ORDER BY p.created_at DESC
       LIMIT ?`
  ).bind(...before ? [LIBRARY_BOARD, category, before, limit + 1] : [LIBRARY_BOARD, category, limit + 1]).all();
  const rows = rs.results ?? [];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return json({
    items: page.map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category ?? LIBRARY_BOARD,
      created_at: p.created_at,
      series: p.series_id ? { id: p.series_id, title: p.series_title ?? "", count: p.series_count ?? 1 } : null
    })),
    next: more ? page[page.length - 1]?.created_at ?? null : null
  });
}
async function postMeta(db, id) {
  if (!ID_RE.test(id)) return bad("not found", 404);
  const r = await db.prepare(
    `SELECT p.id, p.board, p.category, p.title, p.series_id, s.title AS series_title
       FROM posts p LEFT JOIN series s ON s.id = p.series_id
       WHERE p.id = ? AND p.status = 'published'`
  ).bind(id).first();
  if (!r) return bad("not found", 404);
  return json({
    post: {
      id: r.id,
      board: r.board,
      category: r.board === LIBRARY_BOARD ? r.category ?? LIBRARY_BOARD : r.category,
      title: r.title,
      series: r.series_id ? { id: r.series_id, title: r.series_title ?? "" } : null
    }
  });
}
async function seriesToc(db, id) {
  const s = await db.prepare("SELECT id, title FROM series WHERE id=?").bind(id).first();
  if (!s) return bad("not found", 404);
  const rs = await db.prepare(
    `SELECT id, title, category, created_at FROM posts
       WHERE series_id = ? AND status = 'published' ORDER BY created_at ASC`
  ).bind(id).all();
  return json({
    series: s,
    posts: (rs.results ?? []).map((p) => ({ ...p, category: p.category ?? LIBRARY_BOARD }))
  });
}
async function listSeries(req, db) {
  const rs = await db.prepare(
    `SELECT s.id, s.title, s.created_at,
              (SELECT COUNT(*) FROM posts p WHERE p.series_id = s.id AND p.status <> 'deleted') AS count,
              (SELECT MAX(p.created_at) FROM posts p WHERE p.series_id = s.id AND p.status <> 'deleted') AS last_at
       FROM series s ORDER BY COALESCE(last_at, s.created_at) DESC`
  ).all();
  return json({ series: rs.results ?? [] });
}
async function createSeries(req, db, uid) {
  const raw = await req.json().catch(() => ({}));
  const title = str(raw.title, 100);
  if (!title) return bad("시리즈 이름을 입력해 주세요");
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO series (id, title, created_by) VALUES (?, ?, ?)").bind(id, title, uid).run();
  return json({ series: { id, title, count: 0 } }, 201);
}
async function renameSeries(req, db, id) {
  const raw = await req.json().catch(() => ({}));
  const title = str(raw.title, 100);
  if (!title) return bad("시리즈 이름을 입력해 주세요");
  const res = await db.prepare("UPDATE series SET title=?, updated_at=datetime('now') WHERE id=?").bind(title, id).run();
  if (!res.meta.changes) return bad("not found", 404);
  return json({ ok: true });
}
async function deleteSeries(db, id) {
  await db.batch([
    db.prepare("UPDATE posts SET series_id = NULL WHERE series_id = ?").bind(id),
    db.prepare("DELETE FROM series WHERE id = ?").bind(id)
  ]);
  return json({ ok: true });
}
export async function normLibraryPostFields(db, raw, fallbackCategory = LIBRARY_BOARD) {
  const category = typeof raw.category === "string" && raw.category ? raw.category : fallbackCategory;
  if (!await isPostCategory(db, category)) return { error: "자료실 분류가 잘못되었습니다" };
  let series_id = null;
  if (typeof raw.series_id === "string" && raw.series_id) {
    const s = await db.prepare("SELECT id FROM series WHERE id=?").bind(raw.series_id).first();
    if (!s) return { error: "시리즈를 찾을 수 없습니다" };
    series_id = raw.series_id;
  }
  return { category, series_id };
}

