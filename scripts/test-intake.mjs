#!/usr/bin/env node
// 올림함(/api/intake*) API 시험 — 로컬 전용. `pnpm dev`(또는 dev:api)를 띄운 뒤 `node scripts/test-intake.mjs`.
// 로컬 D1 에 시험 계정(local-dev-l20·l60·admin)을 만들고, 시험으로 만든 올림·글·일정은 끝에 지운다.
// 운영(--remote)은 건드리지 않는다.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevPorts } from "./dev-ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = `http://localhost:${loadDevPorts(root).api}`;
const SITE = `http://localhost:${loadDevPorts(root).site}`;

const cookie = (level) =>
  /jb_session=[^;"]+/.exec(execFileSync("node", [path.join(root, "scripts/dev-login.mjs"), "--level", String(level)], { encoding: "utf8" }))[0];
// wrangler 가 안내 글을 앞에 찍을 수 있어 첫 '[' 부터 JSON 으로 읽는다
const d1 = (sql) => {
  const out = execFileSync(path.join(root, "node_modules/.bin/wrangler"), ["d1", "execute", "jsbeob-db", "--local", "-c", "wrangler.toml", "--json", "--command", sql], {
    cwd: path.join(root, "jsbeob-api"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out.slice(out.indexOf("["));
};

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !extra ? "" : `  — ${extra}`}`);
}
async function call(p, { c, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(API + p, { method, body, headers: { ...(c ? { Cookie: c } : {}), Origin: SITE, ...headers } });
  const ct = res.headers.get("Content-Type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.arrayBuffer();
  return { res, data };
}

// 작은 시험 파일
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const stamp = Date.now().toString(36);
const form = (files, fields = {}) => {
  const f = new FormData();
  for (const [name, bytes, type] of files) f.append("files[]", new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
// 해시가 매번 달라지게 PDF 끝에 표시를 붙인다(이전 시험의 '같은 파일' 판정에 걸리지 않게)
const pdfX = new Uint8Array([...PDF, ...new TextEncoder().encode(`%${stamp}\n`)]);

const c20 = cookie(20);
const c60 = cookie(60);
const c100 = cookie(100);
const made = { intakes: [], posts: [], events: [] };

// ── 권한
check("비로그인 목록 → 401", (await call("/api/intake")).res.status === 401);
check("일반(20) 목록 → 403", (await call("/api/intake", { c: c20 })).res.status === 403);
check("일반(20) 올리기 → 403", (await call("/api/intake", { c: c20, method: "POST", body: form([["a.png", PNG, "image/png"]]) })).res.status === 403);
check("편집진(60) 목록 → 200", (await call("/api/intake", { c: c60 })).res.status === 200);
check("관리자(100) 목록 → 200", (await call("/api/intake", { c: c100 })).res.status === 200);
check(
  "다른 출처(Origin) 올리기 → 403",
  (await call("/api/intake", { c: c60, method: "POST", body: form([], { note: "x" }), headers: { Origin: "https://evil.example" } })).res.status === 403,
);
check("Bearer 토큰(앱 로그인 전) → 401", (await call("/api/intake", { headers: { Authorization: "Bearer abc.def.ghi" } })).res.status === 401);

// ── 올리기
const key = `test-${stamp}-1`;
const up = await call("/api/intake", {
  c: c60,
  method: "POST",
  body: form([["공문.png", PNG, "image/png"], ["안내.pdf", pdfX, "application/pdf"]], { note: "시험 메모", url: "https://example.com/a", source: "web" }),
  headers: { "Idempotency-Key": key },
});
const it = up.data.intake;
check("편집진 올리기(사진+PDF+메모+주소) → 201", up.res.status === 201 && it?.files?.length === 2, JSON.stringify(up.data));
if (it) made.intakes.push(it.id);
check("응답에 R2 키가 없음", !JSON.stringify(up.data).includes("intake/20"));
check("올린 사람 표시", it?.user?.id === "local-dev-l60");
const again = await call("/api/intake", {
  c: c60,
  method: "POST",
  body: form([["공문.png", PNG, "image/png"], ["안내.pdf", pdfX, "application/pdf"]], { note: "시험 메모" }),
  headers: { "Idempotency-Key": key },
});
check("같은 Idempotency-Key 재전송 → 같은 건(replayed)", again.data.replayed === true && again.data.intake?.id === it?.id);
const dup = await call("/api/intake", {
  c: c100,
  method: "POST",
  body: form([["공문.png", PNG, "image/png"], ["안내.pdf", pdfX, "application/pdf"]]),
});
check("같은 파일 묶음 다시 올림 → duplicate, 새 건 없음", dup.data.duplicate === true && dup.data.intake?.id === it?.id);
const memo = await call("/api/intake", { c: c60, method: "POST", body: form([], { note: `글자 메모만 ${stamp}` }) });
check("파일 없이 메모만 → 201", memo.res.status === 201);
if (memo.data.intake) made.intakes.push(memo.data.intake.id);
check("빈 올림 → 400", (await call("/api/intake", { c: c60, method: "POST", body: form([]) })).res.status === 400);
check("받지 않는 형식(.txt) → 415", (await call("/api/intake", { c: c60, method: "POST", body: form([["a.txt", PNG, "text/plain"]]) })).res.status === 415);
check(
  "확장자와 내용이 다름(.png 인데 PDF) → 415",
  (await call("/api/intake", { c: c60, method: "POST", body: form([["fake.png", PDF, "image/png"]]) })).res.status === 415,
);
check("잘못된 주소 → 400", (await call("/api/intake", { c: c60, method: "POST", body: form([], { url: "javascript:alert(1)" }) })).res.status === 400);
check(
  "파일 11개 → 400",
  (await call("/api/intake", { c: c60, method: "POST", body: form(Array.from({ length: 11 }, (_, i) => [`${i}.png`, PNG, "image/png"])) })).res.status === 400,
);

// ── 목록·한 건·원본
const list = await call("/api/intake", { c: c60 });
check("목록에 올린 건이 있음 + open 숫자", list.data.items?.some((x) => x.id === it?.id) && list.data.open >= 2);
check("배지 숫자 /api/intake/count", typeof (await call("/api/intake/count", { c: c60 })).data.open === "number");
const one = await call(`/api/intake/${it?.id}`, { c: c60 });
check("한 건 보기 → 메모·파일", one.data.intake?.note === "시험 메모" && one.data.intake?.files?.[0]?.file_url === `/api/intake/${it?.id}/file/1`);
const f1 = await call(`/api/intake/${it?.id}/file/1`, { c: c60 });
check(
  "원본 보기(편집진) → 200, image/png, no-store",
  f1.res.status === 200 && f1.res.headers.get("Content-Type") === "image/png" && f1.res.headers.get("Cache-Control") === "private, no-store",
);
check("원본 보기(일반 20) → 403", (await call(`/api/intake/${it?.id}/file/1`, { c: c20 })).res.status === 403);
check("원본 보기(비로그인) → 401", (await call(`/api/intake/${it?.id}/file/1`)).res.status === 401);
const r2key = JSON.parse(d1(`SELECT files FROM intakes WHERE id='${it?.id}'`))[0].results[0].files;
const k1 = JSON.parse(r2key)[0].key;
check("R2 키가 intake/ 접두어", k1.startsWith("intake/"));
check("공개 경로 /api/files/<키> 로는 안 나옴 → 404", (await call(`/api/files/${k1}`)).res.status === 404);
check("사이트 경유 /api/files/<키> 도 404", (await fetch(`${SITE}/api/files/${k1}`)).status === 404);

// ── 글로 옮기기(게시) — 소식 게시판 편집진 60
const post = await call("/api/posts", {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    board: "news",
    title: `올림 시험 ${stamp}`,
    notice: true,
    intake_id: it?.id,
    blocks: [
      { type: "schedule", start: "2026-12-01", label: "시험 일정" },
      { type: "text", text: "대상: 전 교인" },
    ],
  }),
});
check("편집진 소식 글쓰기 + intake_id → 200", post.res.status === 200 && post.data.id, JSON.stringify(post.data));
if (post.data.id) made.posts.push(post.data.id);
const after = await call(`/api/intake/${it?.id}`, { c: c60 });
check("올림 상태 → published, 글 연결", after.data.intake?.status === "published" && after.data.intake?.post_id === post.data.id);
const pin = JSON.parse(d1(`SELECT is_pinned FROM posts WHERE id='${post.data.id}'`))[0].results[0]?.is_pinned;
check("편집진의 공지 고정은 무시됨", pin === 0);
const ev = JSON.parse(d1(`SELECT COUNT(*) AS n FROM events WHERE source_post_id='${post.data.id}'`))[0].results[0].n;
check("일정 블록 → 달력 일정 1건", ev === 1);
const twice = await call("/api/posts", {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ board: "news", title: "두 번", intake_id: it?.id, blocks: [{ type: "text", text: "x" }] }),
});
check("이미 게시한 올림으로 또 쓰기 → 400", twice.res.status === 400);
const p20 = await call("/api/posts", {
  c: c20,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ board: "news", title: "일반", blocks: [{ type: "text", text: "x" }] }),
});
check("일반(20) 소식 글쓰기 → 403", p20.res.status === 403);

// ── 달력 /api/events — 편집진 60
const e60 = await call("/api/events", {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `시험 일정 ${stamp}`, start_date: "2026-12-02", category: "일정", is_public: 0 }),
});
check("편집진 달력 일정 추가 → 201", e60.res.status === 201);
if (e60.data.event) made.events.push(e60.data.event.id);
check(
  "편집진 달력 일정 수정 → 200",
  (await call(`/api/events/${e60.data.event?.id}`, { c: c60, method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo: "수정" }) })).res
    .status === 200,
);
check(
  "일반(20) 달력 일정 추가 → 403",
  (await call("/api/events", { c: c20, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", start_date: "2026-12-02" }) })).res
    .status === 403,
);

// ── 버리기
const m2 = memo.data.intake?.id;
const pdfOnly = await call("/api/intake", { c: c60, method: "POST", body: form([[`버릴것.pdf`, new Uint8Array([...pdfX, 0x0a, 0x25]), "application/pdf"]]) });
const del = pdfOnly.data.intake?.id;
if (del) made.intakes.push(del);
check("일반(20) 버리기 → 403", (await call(`/api/intake/${del}`, { c: c20, method: "DELETE" })).res.status === 403);
check("편집진 버리기 → 200", (await call(`/api/intake/${del}`, { c: c60, method: "DELETE" })).res.status === 200);
check("버린 건 원본 → 404", (await call(`/api/intake/${del}/file/1`, { c: c60 })).res.status === 404);
check("버린 건 상태 discarded", (await call(`/api/intake/${del}`, { c: c60 })).data.intake?.status === "discarded");

// ── 1년 자동 삭제(Cron) — 예정일을 과거로 돌려 /__scheduled 로 직접 부른다(wrangler dev --test-scheduled)
d1(`UPDATE intakes SET purge_after=datetime('now','-1 day') WHERE id='${m2}'`);
const sch = await fetch(`${API}/__scheduled?cron=0+18+*+*+*`);
check("Cron 수동 실행 /__scheduled → 200", sch.ok);
await new Promise((r) => setTimeout(r, 500));
const purged = JSON.parse(d1(`SELECT purged_at, note FROM intakes WHERE id='${m2}'`))[0].results[0];
check("1년 지난 올림: purged_at 기록 + 메모 지움", !!purged?.purged_at && purged?.note === null);

// ── 정리(시험 데이터)
for (const id of made.posts) d1(`DELETE FROM events WHERE source_post_id='${id}'; DELETE FROM posts WHERE id='${id}'`);
for (const id of made.events) d1(`DELETE FROM events WHERE id='${id}'`);
for (const id of made.intakes) await call(`/api/intake/${id}`, { c: c60, method: "DELETE" });
d1(`DELETE FROM intakes WHERE id IN (${made.intakes.map((x) => `'${x}'`).join(",") || "''"})`);

console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
