#!/usr/bin/env node
// 올림함(/api/intake*) API 시험 — 로컬 전용. `pnpm dev`(또는 dev:api)를 띄운 뒤 `node scripts/test-intake.mjs`.
// 로컬 D1 에 시험 계정(local-dev-l20·l60·admin)을 만들고, 시험으로 만든 올림·글·일정은 끝에 지운다.
// 운영(--remote)은 건드리지 않는다.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevPorts } from "./dev-ports.mjs";
import { assembleDraft, buildSystemPrompt } from "../jsbeob-api/intake-draft.mjs";
import { titleSimilarity } from "../jsbeob-api/intake-similar.mjs";

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
  const go = () => fetch(API + p, { method, body, headers: { ...(c ? { Cookie: c } : {}), Origin: SITE, ...headers } });
  // wrangler d1 명령(수 초)을 사이에 여러 번 부르면 쉬던 연결이 서버 쪽에서 닫혀 있을 수 있다 — 본문이 없는 요청만 한 번 다시
  const res = await go().catch((e) => (body === undefined ? go() : Promise.reject(e)));
  const ct = res.headers.get("Content-Type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.arrayBuffer();
  return { res, data };
}

// ── AI 초안 일정 메모 형식(서버 없이) — "시간: …" / "장소: …" / 한 줄 안내, 없는 줄은 뺀다 (2026-11-27 오너)
{
  const ev = (o) => ({ label: "수공", calendar: "solar", year: 2026, month: 12, day: 4, ...o });
  const memoOf = (o) => assembleDraft({ kind: "event_notice", events: [ev(o)] }, { uploadedAt: "2026-11-27 01:00:00" }).draft_blocks[0].memo;
  check("메모: 시간·장소·안내 세 줄", memoOf({ start_time: "15:00", end_time: "17:00", place: "겨레얼살리기연수원", note: "준비물: 수건" }) === "시간: 15:00~17:00\n장소: 겨레얼살리기연수원\n준비물: 수건");
  check("메모: 시작 시각만", memoOf({ start_time: "9:30", place: "본부" }) === "시간: 09:30\n장소: 본부");
  check("메모: 시간 없으면 시간 줄 없음", memoOf({ place: "본부", note: "1회차" }) === "장소: 본부\n1회차");
  check("메모: 장소 없으면 장소 줄 없음", memoOf({ start_time: "14:00", note: "1회차" }) === "시간: 14:00\n1회차");
  check("메모: 아무것도 없으면 memo 없음", memoOf({}) === undefined);
  check("메모: AI 가 붙인 '장소:' 말머리는 겹치지 않게", memoOf({ place: "장소: 본부" }) === "장소: 본부");
  check("메모: 기간 행사 시간", memoOf({ end_year: 2026, end_month: 12, end_day: 6, start_time: "14:00", end_time: "12:00" }) === "시간: 12/4 14:00 ~ 12/6 12:00");
  check("메모: 음력은 안내 줄 앞에", memoOf({ calendar: "lunar", month: 9, day: 19, start_time: "10:00", note: "치성" }) === "시간: 10:00\n음력 9월 19일 · 치성");
  check("지시문에 메모 형식 안내", buildSystemPrompt({ uploadedAt: "2026-11-27 01:00:00" }).includes('"시간: 15:00~17:00"'));
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
// 2단계 중복 경고: 막지 않고 새 건을 만들되 "이미 올린 것입니다" 안내 + 한 건 보기에 same_file
check(
  "같은 파일 묶음 다시 올림 → 새 건 + duplicate 안내",
  dup.res.status === 201 && dup.data.duplicate === true && dup.data.intake?.id !== it?.id && dup.data.duplicate_of?.id === it?.id && /이미 올린 것입니다/.test(dup.data.notice ?? ""),
  JSON.stringify(dup.data).slice(0, 300),
);
if (dup.data.intake) made.intakes.push(dup.data.intake.id);
const dupOne = await call(`/api/intake/${dup.data.intake?.id}`, { c: c60 });
check("한 건 보기 same_file 에 앞 건", dupOne.data.intake?.same_file?.some((x) => x.id === it?.id));
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
check(
  "같은 파일 건의 same_file 에 '만든 글' 표시",
  (await call(`/api/intake/${dup.data.intake?.id}`, { c: c60 })).data.intake?.same_file?.find((x) => x.id === it?.id)?.post?.id === post.data.id,
);
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

// ── 제목 글자 겹침 비교(서버 없이)
check("비슷함: 숫자·띄어쓰기·흔한 말 무시", titleSimilarity("제5회 동지 치성 안내", "동지치성") === 1);
check("비슷함: 다른 행사는 낮음", titleSimilarity("화천절 치성", "청소년 수련회") < 0.5);
check("비슷함: 일부 겹침", titleSimilarity("겨레얼 학술대회", "겨레얼살리기 학술 대회") >= 0.5);
check("비슷함: 너무 짧으면 0", titleSimilarity("안내", "일정 안내") === 0);

// ── 달력만 등록 + 비슷한 일정 경고 (1단계 남은 것·2단계)
const calForm = form([[`달력.pdf`, new Uint8Array([...pdfX, 0x25, 0x43]), "application/pdf"]], { note: "달력만 시험" });
const cal = await call("/api/intake", { c: c60, method: "POST", body: calForm });
const calId = cal.data.intake?.id;
if (calId) made.intakes.push(calId);
// AI 초안 대신 시험 초안을 직접 넣는다(감시 서비스 없이) — 일정 두 개
d1(
  `UPDATE intakes SET status='ready', kind='event_notice', title='시험 학술대회 ${stamp}', draft_blocks='${JSON.stringify([
    { type: "schedule", start: "2026-12-10", label: `겨레얼 학술대회 ${stamp}`, memo: "시간: 14:00\n장소: 본부" },
    { type: "schedule", start: "2026-12-11", end: "2026-12-12", label: `겨레얼 수련 ${stamp}` },
  ])}' WHERE id='${calId}'`,
);
// 비슷한 일정 — 하루 뒤(±1일 안), 이름 비슷 / 사흘 뒤(범위 밖) / 같은 날 다른 이름
const mk = async (title, start_date) => {
  const r = await call("/api/events", { c: c60, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, start_date, category: "일정", is_public: 1 }) });
  if (r.data.event) made.events.push(r.data.event.id);
  return r.data.event?.id;
};
const near = await mk(`제2회 겨레얼학술대회 ${stamp}`, "2026-12-09");
const far = await mk(`겨레얼 학술대회 ${stamp}`, "2026-12-14");
const other = await mk("청소년 모임 시험", "2026-12-10");
const sim = (await call(`/api/intake/${calId}`, { c: c60 })).data.intake?.similar_events ?? [];
const simIds = sim.flatMap((g) => g.matches.map((m) => m.id));
check("비슷한 일정: ±1일 안·이름 비슷 → 경고", simIds.includes(near), JSON.stringify(sim).slice(0, 300));
check("비슷한 일정: 날짜가 멀면 제외", !simIds.includes(far));
check("비슷한 일정: 이름이 다르면 제외", !simIds.includes(other));
check("일반(20) 달력만 등록 → 403", (await call(`/api/intake/${calId}/calendar`, { c: c20, method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).res.status === 403);
const calBad = await call(`/api/intake/${calId}/calendar`, {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ events: [{ label: "x", start: "2026-13-01" }] }),
});
check("날짜가 틀리면 400", calBad.res.status === 400);
const calOk = await call(`/api/intake/${calId}/calendar`, {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    events: [
      { label: `겨레얼 학술대회 ${stamp}`, start: "2026-12-10", memo: "시간: 14:00\n장소: 본부" },
      { label: `겨레얼 수련 ${stamp}`, start: "2026-12-11", end: "2026-12-12" },
    ],
  }),
});
const ci = calOk.data.intake;
check("달력만 등록 → published, event_ids 2, 글 없음", calOk.res.status === 200 && ci?.status === "published" && ci?.event_ids?.length === 2 && !ci?.post_id, JSON.stringify(calOk.data).slice(0, 300));
check("handled_by 기록", ci?.handled_by?.id === "local-dev-l60");
const calEvs = JSON.parse(d1(`SELECT category, is_public, is_annual, memo, source_post_id, end_date FROM events WHERE id IN (${(ci?.event_ids ?? []).map((x) => `'${x}'`).join(",") || "''"}) ORDER BY start_date`))[0].results;
check(
  "만든 일정: 카테고리 '일정'·공개·메모·기간",
  calEvs.length === 2 && calEvs.every((e) => e.category === "일정" && e.is_public === 1 && e.is_annual === 0 && !e.source_post_id) && calEvs[0].memo === "시간: 14:00\n장소: 본부" && calEvs[1].end_date === "2026-12-12",
);
check("한 건 보기 events 에 만든 일정", ci?.events?.length === 2 && ci.events[0].title.startsWith("겨레얼 학술대회"));
const pubList = (await call("/api/events?from=2026-12-01&to=2026-12-31")).data.events ?? [];
check("비로그인 달력에 보임(공개)", ci?.event_ids?.every((x) => pubList.some((e) => e.id === x)));
check("만든 일정은 비슷한 일정 경고에서 빠짐", !(ci?.similar_events ?? []).some((g) => g.matches.some((m) => ci.event_ids.includes(m.id))));
const calTwice = await call(`/api/intake/${calId}/calendar`, {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ events: [{ label: "x", start: "2026-12-10" }] }),
});
check("두 번 등록 → 409", calTwice.res.status === 409);
const postAfterCal = await call("/api/posts", {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ board: "news", title: "x", intake_id: calId, blocks: [{ type: "text", text: "x" }] }),
});
check("달력만 등록한 올림으로 글쓰기 → 400", postAfterCal.res.status === 400);
check("일반(20) 되돌리기 → 403", (await call(`/api/intake/${calId}/calendar`, { c: c20, method: "DELETE" })).res.status === 403);
const undo = await call(`/api/intake/${calId}/calendar`, { c: c60, method: "DELETE" });
check("되돌리기 → 초안 준비, event_ids 비움", undo.res.status === 200 && undo.data.intake?.status === "ready" && undo.data.intake?.event_ids?.length === 0);
const left = JSON.parse(d1(`SELECT COUNT(*) AS n FROM events WHERE id IN (${(ci?.event_ids ?? []).map((x) => `'${x}'`).join(",") || "''"})`))[0].results[0].n;
check("되돌리기 → 만든 일정 지워짐", left === 0);
check("소식 글로 게시한 올림 되돌리기 → 409", (await call(`/api/intake/${it?.id}/calendar`, { c: c60, method: "DELETE" })).res.status === 409);
const calPriv = await call(`/api/intake/${calId}/calendar`, {
  c: c60,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ public: false, events: [{ label: `비공개 일정 ${stamp}`, start: "2026-12-10" }] }),
});
const privId = calPriv.data.intake?.event_ids?.[0];
if (privId) made.events.push(privId);
const pubList2 = (await call("/api/events?from=2026-12-01&to=2026-12-31")).data.events ?? [];
check("편집진만 보기 → 비로그인 달력에 안 보임", !!privId && !pubList2.some((e) => e.id === privId));

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
if (made.events.length) d1(`DELETE FROM events WHERE id IN (${made.events.map((x) => `'${x}'`).join(",")})`);
for (const id of made.intakes) await call(`/api/intake/${id}`, { c: c60, method: "DELETE" });
d1(`DELETE FROM intakes WHERE id IN (${made.intakes.map((x) => `'${x}'`).join(",") || "''"})`);

console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
