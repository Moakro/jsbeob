<script lang="ts">
  import { LEVEL } from "../data/levels";
  // 자료 서랍(오른쪽, 모바일은 아래 시트) — 이 페이지에 연결된 사이트 자료 카드, 페이지 피드(교인 댓글), 페이지 목록.
  // 본문의 [data-drawer-kind][data-drawer-id] / [data-ref-kind][data-ref-id] 링크를 누르면 카드로 연다.
  // 지도(KakaoMap·MapBundle)는 jb:drawer-open / jb:drawer-bundle / jb:drawer-clear 로 장소 카드를 띄운다.
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/RefDrawer.*.js) 기준.
  import { onMount, tick } from "svelte";
  import { confirmNavigate } from "../lib/confirm";

  interface Ref {
    kind: string;
    id: string;
    title: string;
    label: string;
  }
  interface Tab {
    key: string;
    card: any;
    error: string | null;
    backlinks: any[] | null;
  }

  let refs = $state<Ref[]>([]);
  /** refs(자료) | feed(피드) | list(페이지 목록) */
  let tab = $state<"refs" | "feed" | "list">("refs");
  /** group: 묶음 제목(앞 항목과 다르면 제목 줄), draft: 비공개 배지 글자 — SideList 의 data-* 를 그대로 옮긴다 (2026-11-20) */
  let pageList = $state<{ title: string; sub: string; href: string; on: boolean; group: string; draft: string }[]>([]);
  let pageListLabel = $state("목록");
  let narrow = $state(false);
  /** 페이지 목록 탭은 좁은 화면에서만(넓으면 옆에 목록이 있다) */
  const showList = $derived(pageList.length > 0 && narrow);

  // ── 모바일 아래 막대(dock, 2026-11-21) ──
  // 좁은 화면에서 이동(목록·이전/다음)과 읽기 보조(자료·피드)의 입구를 아래 막대 하나로 모은다.
  // 시트는 역할별로 나뉜다: '목록' = 이동 전용(탭 없음), '자료' = 자료·피드 탭. 오른쪽 모서리 버튼은 넓은 화면에서만.
  // 이전·다음은 DocPager 가 남긴 [data-doc-pager] 데이터에서 읽는다.
  let pager = $state<{ prev: { href: string; label: string } | null; next: { href: string; label: string } | null } | null>(
    null,
  );
  let dockHidden = $state(false);
  /** 목록에서 지금 글의 위치 — '창교 1/4' (묶음이 없으면 '3/12') */
  const listPos = $derived.by(() => {
    const cur = pageList.find((p) => p.on);
    if (!cur) return "";
    const same = pageList.filter((p) => p.group === cur.group);
    return `${cur.group ? `${cur.group} ` : ""}${same.indexOf(cur) + 1}/${same.length}`;
  });

  // ── 페이지 피드 ──
  let feedTarget = $state<{ kind: string; id: string; title: string } | null>(null);
  let feed = $state<any[] | null>(null);
  let feedError = $state<string | null>(null);
  /** undefined = 아직 모름 */
  let me = $state<any>(undefined);
  let draft = $state("");
  let posting = $state(false);
  let replyTo = $state<string | null>(null);
  const MIN_LEVEL = LEVEL.BELIEVER;
  const roots = $derived((feed ?? []).filter((c) => !c.parent_id));
  const repliesOf = (id: string) => (feed ?? []).filter((c) => c.parent_id === id);
  const feedCount = $derived((feed ?? []).filter((c) => c.status === "published").length);

  async function loadFeed() {
    if (!feedTarget) return;
    feedError = null;
    try {
      const [c, m] = await Promise.all([
        fetch(`/api/comments?target=${encodeURIComponent(`${feedTarget.kind}:${feedTarget.id}`)}`, {
          credentials: "same-origin",
        }).then((r) => r.json()),
        me === undefined
          ? fetch("/api/me", { credentials: "same-origin" })
              .then((r) => r.json())
              .catch(() => ({ user: null }))
          : Promise.resolve(null),
      ]);
      feed = c.comments ?? [];
      if (m) me = m.user ?? null;
    } catch {
      feedError = "피드를 불러오지 못했습니다.";
    }
  }

  async function postFeed() {
    if (!feedTarget || !draft.trim()) return;
    posting = true;
    feedError = null;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: `${feedTarget.kind}:${feedTarget.id}`,
          body: draft.trim(),
          parent_id: replyTo,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "등록하지 못했습니다");
      draft = "";
      replyTo = null;
      await loadFeed();
    } catch (e) {
      feedError = e instanceof Error ? e.message : "등록하지 못했습니다";
    } finally {
      posting = false;
    }
  }

  async function deleteFeed(id: string) {
    const { confirmDialog } = await import("../lib/confirm");
    if (
      !(await confirmDialog({
        title: "피드 삭제",
        message: "이 피드를 지울까요?",
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    await fetch(`/api/comments/${id}`, { method: "DELETE", credentials: "same-origin" });
    await loadFeed();
  }

  function setTab(t: "refs" | "feed" | "list") {
    tab = t;
    if (t === "feed" && feed === null) loadFeed();
  }
  /** 목록 시트(이동 전용) */
  function openList() {
    if (!pageList.length) return;
    tab = "list";
    open = true;
  }
  /** 자료 시트(자료·피드) */
  function openAid() {
    scanRefs();
    view = "list";
    open = true;
    setTab(refs.length ? "refs" : "feed");
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  };

  // ── 자료 카드 ──
  let pageTitle = $state("");
  let open = $state(false);
  /** list(자료 목록) | card(카드) */
  let view = $state<"list" | "card">("list");
  let tabs = $state<Tab[]>([]);
  let active = $state(0);
  let root = $state<HTMLElement | null>(null);
  const current = $derived(tabs[active] ?? null);
  const keyOf = (kind: string, id: string) => `${kind}:${id}`;

  /** 본문의 자료 링크를 모은다(서랍 안 링크 제외) */
  function scanRefs() {
    const seen = new Set<string>();
    const out: Ref[] = [];
    document
      .querySelectorAll<HTMLElement>("[data-drawer-kind][data-drawer-id], [data-ref-kind][data-ref-id]")
      .forEach((el) => {
        if (root?.contains(el)) return;
        const kind = el.dataset.drawerKind ?? el.dataset.refKind ?? "";
        const id = el.dataset.drawerId ?? el.dataset.refId ?? "";
        const k = keyOf(kind, id);
        if (!kind || !id || seen.has(k)) return;
        seen.add(k);
        out.push({
          kind,
          id,
          title: el.dataset.refTitle ?? el.textContent?.trim() ?? "",
          label: el.dataset.refLabel ?? "자료",
        });
      });
    refs = out;
  }

  /** 이 카드가 본문 어디에 나오는지 */
  function occurrences(kind: string, id: string) {
    const sel = `[data-drawer-kind="${kind}"][data-drawer-id="${CSS.escape(id)}"], [data-ref-kind="${kind}"][data-ref-id="${CSS.escape(id)}"]`;
    return [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => !root?.contains(el));
  }

  function flashOccurrence(el: HTMLElement) {
    const blk = el.closest<HTMLElement>(".blk") ?? el;
    blk.scrollIntoView({ behavior: "smooth", block: "center" });
    blk.classList.remove("ref-flash");
    void blk.offsetWidth; // 애니메이션 다시 시작
    blk.classList.add("ref-flash");
  }

  /** 경전 인용(문장 위치)으로 열었으면 카드 안의 그 문장으로 내려가 강조한다 (2026-11-14) */
  async function showAnchor(anchor?: string) {
    if (!anchor) return;
    // 카드가 미끄러져 들어오는 동안 기다린다
    for (let n = 0; n < 20; n++) {
      await tick();
      const body = root?.querySelector<HTMLElement>(".sd-body.sd-slide");
      const el = body?.querySelector<HTMLElement>(`.sd-content [id="${CSS.escape(anchor)}"]`);
      if (body && el) {
        body.querySelectorAll(".is-cited").forEach((x) => x.classList.remove("is-cited"));
        el.classList.add("is-cited");
        const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTo({ top: Math.max(0, top - body.clientHeight / 3), behavior: "smooth" });
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 카드 열기 — 이미 열린 카드면 그 카드로 넘긴다 */
  async function openCard(kind: string, id: string, anchor?: string) {
    open = true;
    tab = "refs";
    view = "card";
    const k = keyOf(kind, id);
    const i = tabs.findIndex((t) => t.key === k);
    if (i >= 0) {
      if (i !== active) dir = i > active ? 1 : -1;
      swipeFrom = 0;
      active = i;
      await showAnchor(anchor);
      return;
    }
    tabs = [...tabs, { key: k, card: null, error: null, backlinks: null }];
    dir = 1;
    swipeFrom = 0;
    active = tabs.length - 1;
    await loadCard(k);
    await tick();
    root?.querySelector(".sd-body")?.scrollTo(0, 0);
    await showAnchor(anchor);
  }

  const loadingKeys = new Set<string>();
  async function loadCard(k: string) {
    const t0 = tabs.find((t) => t.key === k);
    if (!t0 || t0.card || t0.error || loadingKeys.has(k)) return;
    loadingKeys.add(k);
    const i = k.indexOf(":");
    const kind = k.slice(0, i);
    const id = k.slice(i + 1);
    const find = () => tabs.find((t) => t.key === k);
    try {
      const res = await fetch(
        `/api/content/card?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.card)
        throw new Error(
          res.status === 404 ? "삭제되었거나 공개되지 않은 자료입니다." : "자료를 불러오지 못했습니다.",
        );
      const t1 = find();
      if (t1) t1.card = d.card;
      const bl = await fetch(
        `/api/content/backlinks?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      )
        .then((r) => r.json())
        .catch(() => ({ items: [] }));
      const t2 = find();
      // 지금 페이지로 가는 역링크는 뺀다
      if (t2) t2.backlinks = (bl.items ?? []).filter((x: any) => x.href.split("#")[0] !== location.pathname);
    } catch (e) {
      const t3 = find();
      if (t3) t3.error = e instanceof Error ? e.message : "자료를 불러오지 못했습니다.";
    } finally {
      loadingKeys.delete(k);
    }
  }

  // ── 지도 묶음(모달) ──
  /** 본문 지도(MapBundle) 위에 떠 있는 동안 */
  let modal = $state(false);
  let saved: {
    tabs: Tab[];
    active: number;
    view: "list" | "card";
    open: boolean;
    tab: "refs" | "feed" | "list";
  } | null = null;
  /** 지도 페이지·묶음 — 장소 카드 서랍 */
  const mapMode = $derived(mapPage || modal);
  /** 카드 링크가 지금 페이지면 '이동' 버튼을 숨긴다 */
  const isHere = (href: string) =>
    (modal && location.pathname.startsWith("/jeongak/")) ||
    new URL(href, location.href).pathname.replace(/\/?$/, "/") === location.pathname.replace(/\/?$/, "/");

  function openBundle(items: { kind: string; id: string }[], at: number, asModal: boolean) {
    if (asModal && !modal) {
      saved = { tabs: $state.snapshot(tabs) as Tab[], active, view, open, tab };
      modal = true;
    }
    const seen = new Set<string>();
    tabs = items
      .map((x) => keyOf(x.kind, x.id))
      .filter((k) => !seen.has(k) && (seen.add(k), true))
      .map((key) => ({ key, card: null, error: null, backlinks: null }));
    active = Math.max(0, Math.min(at, tabs.length - 1));
    dir = 1;
    swipeFrom = 0;
    tab = "refs";
    view = "card";
    expanded = false;
    open = tabs.length > 0;
    // 보이는 카드부터 불러온다
    const order = [active, ...tabs.map((_, i) => i).filter((i) => i !== active)];
    for (const i of order) loadCard(tabs[i].key);
  }

  let modalEndedAt = 0;
  function endModal() {
    if (!modal) return;
    modalEndedAt = performance.now();
    modal = false;
    const s = saved;
    saved = null;
    tabs = s?.tabs ?? [];
    active = s?.active ?? 0;
    view = s?.view ?? "list";
    tab = s?.tab ?? "refs";
    open = s?.open ?? false;
  }

  // ── 모바일 시트 ──
  let mapPage = $state(false);
  /** 페이지가 [data-drawer-nofab] 이면 오른쪽 서랍 버튼을 숨긴다(소개 등). 목록 시트·링크 카드는 그대로 */
  let noFab = $state(false);
  let sheetMedia = $state(false);
  const sheet = $derived(sheetMedia);
  let vh = $state(800);
  let expanded = $state(false);
  let dragH = $state<number | null>(null);
  let drag: { id: number; y0: number; h0: number; moved: boolean } | null = null;
  let justDragged = false;
  const lowH = $derived(Math.round(vh * 0.3));
  const highH = $derived(Math.round(vh * 0.85));
  const sheetH = $derived(dragH ?? (expanded ? highH : lowH));

  function gripDown(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y0: e.clientY, h0: sheetH, moved: false };
  }
  function gripMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    dragH = Math.max(0, Math.min(highH, drag.h0 - dy));
  }
  function gripUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    // 끈 뒤 바로 오는 click 은 무시
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    finishDrag(e.clientY - d.y0, dragH ?? d.h0);
  }
  /** 끌기를 놓았을 때 — 위로 40px 이상이면 펼치기, 아래로 40px 이상이면 접기(이미 접혀 있으면 닫기) */
  function finishDrag(dy: number, h: number) {
    dragH = null;
    if (dy <= -40) expanded = true;
    else if (dy >= 40) {
      if (expanded && h >= lowH * 0.55) expanded = false;
      else open = false;
    }
  }

  // 머리 줄로 끌기 (2026-11-21) — 손잡이뿐 아니라 제목 줄 어디를 잡아도. 버튼·링크는 그대로 눌린다.
  function headDown(e: PointerEvent) {
    if (!sheet || (e.target as Element).closest("button, a, input")) return;
    gripDown(e);
  }

  // 내용에서 아래로 당겨 닫기 (2026-11-21) — 내용이 맨 위일 때 아래로 당기면 시트가 따라 내려온다.
  // 세로 스크롤과 겨루므로 터치 이벤트로(passive: false) 받아, 시트를 움직일 때만 기본 스크롤을 막는다.
  let pull: { x0: number; y0: number; h0: number; active: boolean; body: HTMLElement } | null = null;
  function pullStart(e: TouchEvent) {
    pull = null;
    if (!sheet || e.touches.length !== 1) return;
    const body = (e.target as Element).closest<HTMLElement>(".sd-body");
    if (!body || body.scrollTop > 0) return;
    const t = e.touches[0];
    pull = { x0: t.clientX, y0: t.clientY, h0: sheetH, active: false, body };
  }
  function pullMove(e: TouchEvent) {
    if (!pull) return;
    const t = e.touches[0];
    const dy = t.clientY - pull.y0;
    const dx = t.clientX - pull.x0;
    if (!pull.active) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      // 아래로, 세로가 뚜렷하고, 내용이 여전히 맨 위일 때만 시트를 끈다(그 밖엔 평소 스크롤·카드 넘기기)
      if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && pull.body.scrollTop <= 0) pull.active = true;
      else {
        pull = null;
        return;
      }
    }
    e.preventDefault();
    dragH = Math.max(0, Math.min(highH, pull.h0 - dy));
  }
  function pullEnd(e: TouchEvent) {
    const p = pull;
    pull = null;
    if (!p?.active) return;
    const t = e.changedTouches[0];
    finishDrag(t ? t.clientY - p.y0 : 0, dragH ?? p.h0);
  }
  $effect(() => {
    const el = root;
    if (!el || !sheet) return;
    const cancel = () => {
      if (pull?.active) dragH = null;
      pull = null;
    };
    el.addEventListener("touchstart", pullStart, { passive: true });
    el.addEventListener("touchmove", pullMove, { passive: false });
    el.addEventListener("touchend", pullEnd);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", pullStart);
      el.removeEventListener("touchmove", pullMove);
      el.removeEventListener("touchend", pullEnd);
      el.removeEventListener("touchcancel", cancel);
    };
  });
  function gripCancel() {
    drag = null;
    dragH = null;
  }
  function gripClick() {
    if (!justDragged) expanded = !expanded;
  }

  // 일반 페이지 시트는 크게 연다
  let wasOpen = false;
  $effect(() => {
    const o = open;
    if (o && !wasOpen && sheet && !mapMode) expanded = true;
    wasOpen = o;
  });

  // 시트 높이를 CSS 변수로(지도가 가리지 않게)
  $effect(() => {
    const el = document.documentElement;
    const h = sheet && open ? sheetH : 0;
    el.style.setProperty("--jb-sheet-h", `${h}px`);
    if (dragH !== null) el.setAttribute("data-sheet-drag", "");
    else el.removeAttribute("data-sheet-drag");
  });

  function closeTab(i: number) {
    tabs = tabs.filter((_, j) => j !== i);
    if (!tabs.length && mapMode) {
      open = false;
      view = "list";
      active = 0;
      return;
    }
    if (!tabs.length) view = "list";
    dir = i >= tabs.length ? -1 : 1;
    swipeFrom = 0;
    active = Math.max(0, Math.min(active, tabs.length - 1));
  }

  function clearAll() {
    tabs = [];
    active = 0;
    view = "list";
    open = false;
  }

  // ── 카드 넘기기 ──
  let dir = $state(1);
  let swipeFrom = 0;
  let swipeX = $state(0);
  let swipe: { id: number; x0: number; y0: number; lock: "x" | "y" | null; w: number } | null = null;
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function step(d: number, from = 0) {
    if (tabs.length < 2) return;
    dir = d;
    swipeFrom = from;
    active = (active + d + tabs.length) % tabs.length;
  }
  function goTo(i: number) {
    if (i === active) return;
    dir = i > active ? 1 : -1;
    swipeFrom = 0;
    active = i;
  }

  /** 들어오는 카드 */
  function slideIn(_node: Element, p: { dir: number }) {
    return {
      duration: reduceMotion() ? 0 : 240,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      css: (t: number) => `transform: translateX(${p.dir * 100 * (1 - t)}%)`,
    };
  }
  /** 나가는 카드 — 손가락으로 끈 만큼(from)에서 이어서 */
  function slideOut(_node: Element, p: { dir: number; from: number }) {
    return {
      duration: reduceMotion() ? 0 : 240,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      css: (t: number) => `transform: translateX(calc(${p.from * t}px + ${-p.dir * 100 * (1 - t)}%))`,
    };
  }

  function swipeDown(e: PointerEvent) {
    if (e.pointerType === "mouse" || tabs.length < 2 || swipe) return;
    swipe = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      lock: null,
      w: (e.currentTarget as HTMLElement).clientWidth,
    };
  }
  function swipeMove(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    if (!swipe.lock) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        swipe.lock = "x";
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      } else if (Math.abs(dy) > 10) swipe.lock = "y";
    }
    if (swipe.lock === "x") swipeX = dx;
  }
  function swipeUp(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const s = swipe;
    swipe = null;
    if (s.lock !== "x") return;
    const dx = e.clientX - s.x0;
    if (Math.abs(dx) > Math.min(80, s.w * 0.2)) step(dx < 0 ? 1 : -1, dx);
    swipeX = 0;
  }
  function swipeCancel() {
    swipe = null;
    swipeX = 0;
  }

  // 트랙패드 가로 스크롤로 넘기기
  let wheelSum = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelLockUntil = 0;
  function onWheel(e: WheelEvent) {
    if (tabs.length < 2 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => (wheelSum = 0), 200);
    if (performance.now() < wheelLockUntil) return;
    wheelSum += e.deltaX;
    if (Math.abs(wheelSum) > 80) {
      step(wheelSum > 0 ? 1 : -1);
      wheelSum = 0;
      wheelLockUntil = performance.now() + 500;
    }
  }

  onMount(() => {
    // 제목과 한자(span)가 붙어 나오지 않게 조각마다 띄어 잇는다
    const h1 = document.querySelector("h1");
    pageTitle =
      (h1 ? [...h1.childNodes].map((n) => n.textContent?.trim() ?? "").filter(Boolean).join(" ") : "") ||
      document.title.split("·")[0].trim();
    scanRefs();
    noFab = !!document.querySelector("[data-drawer-nofab]");
    // 페이지 피드 대상(자료 문서)
    const pf = document.querySelector<HTMLElement>("[data-page-feed]");
    if (pf?.dataset.kind && pf.dataset.id)
      feedTarget = { kind: pf.dataset.kind, id: pf.dataset.id, title: pf.dataset.title ?? pageTitle };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.dataset.drawerKind && a.dataset.drawerId) {
        e.preventDefault();
        openCard(a.dataset.drawerKind, a.dataset.drawerId, a.dataset.drawerAnchor);
        return;
      }
      // 서랍 안 사이트 링크는 이동 전에 확인
      if (
        root?.contains(a) &&
        !a.hasAttribute("data-direct") &&
        a.target !== "_blank" &&
        a.href &&
        new URL(a.href, location.href).origin === location.origin
      ) {
        e.preventDefault();
        confirmNavigate(a.href, a.dataset.refTitle ?? a.textContent?.trim());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        open &&
        !modal &&
        performance.now() - modalEndedAt > 300 &&
        !document.querySelector("dialog[open]")
      )
        open = false;
    };
    const onBundle = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (Array.isArray(d?.items)) openBundle(d.items, d.active ?? 0, !!d.modal);
    };
    const onClear = () => clearAll();
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d?.kind || !d?.id) return;
      if (sheet) expanded = false;
      openCard(d.kind, d.id);
    };
    // 지도 페이지(장소 시트)
    mapPage = !!document.querySelector("[data-drawer-sheet]");
    // 옆 목록(SideList)을 좁은 화면에서는 서랍 '목록' 탭으로
    const list = document.querySelector<HTMLElement>("[data-page-list]");
    if (list) {
      pageListLabel = list.dataset.listLabel ?? "목록";
      pageList = [...list.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => ({
        title: a.dataset.title ?? a.textContent?.trim() ?? "",
        sub: a.dataset.sub ?? "",
        href: a.getAttribute("href") ?? "",
        on: a.classList.contains("on"),
        group: a.dataset.group ?? "",
        draft: a.dataset.draft ?? "",
      }));
    }
    const mqNarrow = window.matchMedia("(max-width: 860px)");
    const syncNarrow = () => (narrow = mqNarrow.matches);
    syncNarrow();
    mqNarrow.addEventListener("change", syncNarrow);
    const onList = () => openList();
    // 이전·다음(DocPager 데이터)
    const pg = document.querySelector<HTMLElement>("[data-doc-pager]");
    if (pg) {
      const d = pg.dataset;
      pager = {
        prev: d.prevHref ? { href: d.prevHref, label: d.prevLabel ?? "" } : null,
        next: d.nextHref ? { href: d.nextHref, label: d.nextLabel ?? "" } : null,
      };
    }
    // 아래로 읽는 동안은 막대를 숨기고, 위로 올리거나 끝에 닿으면 다시
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (window.innerHeight + y >= document.documentElement.scrollHeight - 80 || y < 40 || y < lastY - 4)
        dockHidden = false;
      else if (y > lastY + 4) dockHidden = true;
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("jb:drawer-list", onList);
    const mqSheet = window.matchMedia("(max-width: 760px)");
    const syncSheet = () => (sheetMedia = mqSheet.matches);
    const syncVh = () => (vh = window.innerHeight);
    syncSheet();
    syncVh();
    mqSheet.addEventListener("change", syncSheet);
    window.addEventListener("resize", syncVh);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("jb:drawer-open", onOpen);
    window.addEventListener("jb:drawer-bundle", onBundle);
    window.addEventListener("jb:drawer-clear", onClear);
    window.addEventListener("jb:drawer-modal-end", endModal);
    (window as any).__jbDrawerReady = true;
    window.dispatchEvent(new CustomEvent("jb:drawer-ready"));
    return () => {
      (window as any).__jbDrawerReady = false;
      window.removeEventListener("jb:drawer-bundle", onBundle);
      window.removeEventListener("jb:drawer-clear", onClear);
      window.removeEventListener("jb:drawer-modal-end", endModal);
      mqSheet.removeEventListener("change", syncSheet);
      mqNarrow.removeEventListener("change", syncNarrow);
      window.removeEventListener("jb:drawer-list", onList);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncVh);
      document.documentElement.style.removeProperty("--jb-sheet-h");
      document.documentElement.removeAttribute("data-sheet-drag");
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("jb:drawer-open", onOpen);
    };
  });

  // 지도가 선택 마커를 맞추도록 서랍 상태를 알린다
  $effect(() => {
    const key = open && view === "card" ? (tabs[active]?.key ?? null) : null;
    window.dispatchEvent(new CustomEvent("jb:drawer-state", { detail: { open, key, count: tabs.length } }));
  });
</script>

{#snippet feedItem(c: any, reply = false)}
  <li class="fd-item" class:reply>
    {#if c.status === "deleted"}
      <p class="dim">삭제된 피드입니다.</p>
    {:else}
      <div class="fd-meta">
        <strong>{c.author.display_name ?? "회원"}</strong>
        <span>{fmtDate(c.created_at)}</span>
        {#if !reply && me && (me.level ?? 0) >= MIN_LEVEL}
          <button type="button" class="link" onclick={() => (replyTo = c.id)}>답글</button>
        {/if}
        {#if me && c.author_id === me.id}
          <button type="button" class="link danger" onclick={() => deleteFeed(c.id)}>삭제</button>
        {/if}
      </div>
      <div class="fd-body">{@html c.body_html}</div>
    {/if}
  </li>
{/snippet}

{#if (refs.length || feedTarget) && !open && !modal && !noFab && !narrow}
  <button
    type="button"
    class="sd-fab"
    aria-label="자료 서랍 열기"
    title="이 페이지의 자료·피드"
    onclick={() => {
      scanRefs();
      open = true;
      setTab(refs.length ? "refs" : "feed");
    }}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      ><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"
      ></rect><line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" stroke-width="1.8"></line><polyline
        points="11,9 8,12 11,15"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      ></polyline></svg
    >
  </button>
{/if}
{#if narrow && !mapMode && (pageList.length || refs.length || feedTarget || pager)}
  <div class="dock-spacer" aria-hidden="true"></div>
  <nav class="dock" class:is-hidden={dockHidden || (open && sheet)} aria-label="페이지 이동·자료">
    {#if pageList.length}
      <button type="button" class="dk-btn" onclick={openList} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
          ><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg
        >
        {pageListLabel.endsWith("차례") ? "차례" : "목록"}
      </button>
    {/if}
    <span class="dk-pos">{listPos}</span>
    {#if refs.length || feedTarget}
      <button type="button" class="dk-btn" onclick={openAid} aria-haspopup="dialog">
        {refs.length ? "자료" : "피드"}{#if refs.length}<span class="cnt">{refs.length}</span>{/if}
      </button>
    {/if}
    {#if pager}
      <span class="dk-nav">
        {#if pager.prev}
          <a href={pager.prev.href} aria-label={`이전 글: ${pager.prev.label}`} title={pager.prev.label}>‹</a>
        {:else}<span class="off" aria-hidden="true">‹</span>{/if}
        {#if pager.next}
          <a href={pager.next.href} aria-label={`다음 글: ${pager.next.label}`} title={pager.next.label}>›</a>
        {:else}<span class="off" aria-hidden="true">›</span>{/if}
      </span>
    {/if}
  </nav>
{/if}
{#if open && sheet && !mapMode}
  <button type="button" class="sd-scrim" aria-label="시트 닫기" onclick={() => (open = false)}></button>
{/if}
{#if open}
  <aside
    class="sd"
    class:is-sheet={sheet}
    class:is-modal={modal && !sheet}
    class:is-dragging={sheet && dragH !== null}
    style:height={sheet ? `${sheetH}px` : null}
    aria-label="자료 서랍"
    bind:this={root}
  >
    {#if sheet}
      <button
        type="button"
        class="sd-grip"
        aria-label={expanded ? "시트 접기" : "시트 펼치기"}
        aria-expanded={expanded}
        onpointerdown={gripDown}
        onpointermove={gripMove}
        onpointerup={gripUp}
        onpointercancel={gripCancel}
        onclick={gripClick}><span aria-hidden="true"></span></button
      >
    {/if}
    <!-- 복원: 배포본 템플릿의 공백으로 보아 이 자리에 주석이 둘 있었다 -->
    <!-- 지도에서 연 장소 카드는 머리에 장소 이름 -->
    <!-- svelte-ignore a11y_no_static_element_interactions — 끌기는 손잡이(button)와 같은 보조 동작, 키보드는 손잡이로 -->
    <header
      class="sd-top"
      class:is-place={mapMode && view === "card" && !!current}
      onpointerdown={headDown}
      onpointermove={gripMove}
      onpointerup={gripUp}
      onpointercancel={gripCancel}
    >
      {#if mapMode && view === "card" && current}
        <div class="sd-title">
          {#if current.card}
            <span class="chip">{current.card.label}</span>
            <strong class="sd-page">{current.card.title}</strong>
            {#if current.card.title_hanja}<span class="hanja">({current.card.title_hanja})</span>{/if}
          {:else}
            <strong class="sd-page">{current.error ? "자료" : "불러오는 중…"}</strong>
          {/if}
        </div>
      {:else}
        <strong class="sd-page">{tab === "list" ? pageListLabel : pageTitle}</strong>
      {/if}
      <button
        type="button"
        class="sd-collapse"
        title="닫기"
        aria-label={sheet ? "시트 닫기" : "서랍 닫기"}
        onclick={() => (open = false)}
      >
        {#if sheet}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
            ><polyline
              points="6,9 12,15 18,9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></polyline></svg
          >
        {:else}›{/if}
      </button>
    </header>
    {#if !mapMode && tab !== "list"}
      <nav class="sd-tabs" aria-label="서랍 탭">
        {#if refs.length}
          <button
            type="button"
            class:on={tab === "refs"}
            onclick={() => {
              setTab("refs");
              view = "list";
            }}>자료 <span class="cnt">{refs.length}</span></button
          >
        {/if}
        {#if feedTarget}
          <button type="button" class:on={tab === "feed"} onclick={() => setTab("feed")}
            >피드{#if feed}<span class="cnt">{feedCount}</span>{/if}</button
          >
        {/if}
      </nav>
    {/if}
    {#if tab === "list" && showList}
      <div class="sd-body sd-pagelist">
        <ul aria-label={pageListLabel}>
          {#each pageList as it, i (it.href)}
            {#if it.group && it.group !== pageList[i - 1]?.group}
              <li class="grp" aria-hidden="true">{it.group}</li>
            {/if}
            <li>
              <a href={it.href} data-direct="" aria-current={it.on ? "page" : undefined} class:on={it.on}>
                <span class="t">{it.title}</span>
                {#if it.sub}<span class="sub">{it.sub}</span>{/if}
                {#if it.draft}<span class="draft">{it.draft}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {:else if tab === "feed" && feedTarget}
      <div class="sd-body sd-feed">
        {#if feedError}<p class="err">{feedError}</p>{/if}
        {#if feed === null}
          <p class="dim">불러오는 중…</p>
        {:else if roots.length}
          <ul class="fd-list">
            {#each roots as c (c.id)}
              {@render feedItem(c, false)}
              {#each repliesOf(c.id) as r (r.id)}
                {@render feedItem(r, true)}
              {/each}
            {/each}
          </ul>
        {:else}
          <p class="dim">아직 피드가 없습니다.</p>
        {/if}
        <div class="fd-write">
          {#if me === undefined}
            <p class="dim">확인 중…</p>
          {:else if !me}
            <p class="dim">피드는 교인 인증 회원이 쓸 수 있습니다.</p>
            <button
              type="button"
              class="fd-login"
              onclick={() => window.dispatchEvent(new CustomEvent("jb:login"))}>로그인</button
            >
          {:else if (me.level ?? 0) < MIN_LEVEL}
            <p class="dim">피드는 교인 인증 회원만 쓸 수 있습니다. 읽기는 누구나 가능합니다.</p>
          {:else if !me.display_name}
            <p class="dim">닉네임을 설정해야 피드를 쓸 수 있습니다.</p>
          {:else}
            {#if replyTo}
              <p class="fd-replying">
                답글 쓰는 중 <button type="button" class="link" onclick={() => (replyTo = null)}>취소</button>
              </p>
            {/if}
            <textarea
              rows="3"
              maxlength="4000"
              placeholder={replyTo ? "답글" : "이 자료에 대한 생각을 남겨 주세요"}
              bind:value={draft}></textarea>
            <button type="button" class="fd-post" disabled={posting || !draft.trim()} onclick={postFeed}
              >{posting ? "등록 중…" : "등록"}</button
            >
          {/if}
        </div>
      </div>
    {:else if view === "list" || !current}
      <div class="sd-body">
        {#if !refs.length}<p class="dim">이 페이지에는 연결된 사이트 자료가 없습니다.</p>{/if}
        <ul class="sd-list">
          {#each refs as r (r.kind + r.id)}
            <li>
              <button type="button" onclick={() => openCard(r.kind, r.id)}
                ><span class="chip">{r.label}</span>{r.title}</button
              >
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      {#if !mapMode}
        <div class="sd-cardhead">
          <button type="button" class="sd-back" onclick={() => (view = "list")}>← 목록</button>
          {#if current.card}<span class="chip">{current.card.label}</span><strong class="t"
              >{current.card.title}</strong
            >{#if current.card.title_hanja}<span class="hanja">({current.card.title_hanja})</span>{/if}{/if}
          <button type="button" class="sd-x" aria-label="이 카드 닫기" onclick={() => closeTab(active)}
            >✕</button
          >
        </div>
      {/if}
      <div
        class="sd-slides"
        role="group"
        aria-roledescription="카드 넘기기"
        onpointerdown={swipeDown}
        onpointermove={swipeMove}
        onpointerup={swipeUp}
        onpointercancel={swipeCancel}
        onwheel={onWheel}
      >
        {#each [current] as t (t.key)}
          <div
            class="sd-body sd-slide"
            class:is-swiping={swipeX !== 0 && swipe !== null}
            style:transform={swipeX ? `translateX(${swipeX}px)` : null}
            in:slideIn={{ dir }}
            out:slideOut={{ dir, from: swipeFrom }}
          >
            {#if t.error}
              <p class="dim">{t.error}</p>
            {:else if !t.card}
              <p class="dim">불러오는 중…</p>
            {:else}
              {@const occ = occurrences(t.card.kind, t.card.id)}
              {#if occ.length}
                <section class="sd-occ">
                  <strong>이 페이지에서 등장 ({occ.length})</strong>
                  <div>
                    {#each occ as el, i}
                      <button type="button" onclick={() => flashOccurrence(el)}
                        >{i + 1}번째 · {el.closest(".blk-quote") ? "인용" : "링크"}</button
                      >
                    {/each}
                  </div>
                </section>
              {/if}
              {#if t.card.hero}<img class="sd-hero" src={t.card.hero.url} alt={t.card.hero.alt ?? ""} />{/if}
              {#if t.card.summary}<p class="sd-summary">{t.card.summary}</p>{/if}
              <div class="prose sd-content">{@html t.card.body_html}</div>
              {#if t.backlinks && t.backlinks.length}
                <section class="sd-back-links">
                  <h4>
                    {t.card.kind === "point" ? "이 장소가 나오는 자료" : "이 자료를 인용한 곳"} ({t.backlinks
                      .length})
                  </h4>
                  {#each t.backlinks as b (b.kind + b.id)}
                    <button type="button" onclick={() => confirmNavigate(b.href, b.title)}>{b.title}</button>
                  {/each}
                </section>
              {/if}
              {#if t.card.href && !isHere(t.card.href)}
                <button type="button" class="sd-go" onclick={() => confirmNavigate(t.card.href, t.card.title)}
                  >이 자료 페이지로 이동 →</button
                >
              {/if}
            {/if}
          </div>
        {/each}
      </div>
      {#if tabs.length > 1}
        <footer class="sd-foot" class:is-map={mapMode}>
          <div class="sd-nav">
            <button type="button" class="sd-arrow" aria-label="이전 카드" onclick={() => step(-1)}>‹</button>
            <div class="dots">
              {#each tabs as t, i (t.key)}
                <button
                  type="button"
                  class:on={i === active}
                  aria-label={t.card?.title ?? `${i + 1}번째 카드`}
                  title={t.card?.title ?? ""}
                  onclick={() => goTo(i)}
                ></button>
              {/each}
            </div>
            <button type="button" class="sd-arrow" aria-label="다음 카드" onclick={() => step(1)}>›</button>
          </div>
          {#if mapPage && !modal}
            <button type="button" class="sd-clear" onclick={clearAll}>장소 비우기</button>
          {/if}
        </footer>
      {/if}
    {/if}
  </aside>
{/if}

<style>
  .sd-scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    border: 0;
    padding: 0;
    background: #1e140c47;
    animation: scrim-in 0.2s ease-out;
    -webkit-tap-highlight-color: transparent;
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  .sd-pagelist ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sd-pagelist li + li {
    border-top: 1px solid var(--color-rule);
  }
  .sd-pagelist .grp {
    padding: 9px 12px 5px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  /* 비공개 배지 — DraftBadge 와 같은 모양 */
  .sd-pagelist .draft {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-primary-bg);
    color: var(--color-primary);
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
  }
  .sd-pagelist a {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 46px;
    padding: 0 12px;
    color: var(--color-ink);
  }
  .sd-pagelist a .t {
    flex: none;
    font-weight: 600;
  }
  .sd-pagelist a .sub {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted);
    font-size: 0.88em;
  }
  .sd-pagelist a.on {
    background: var(--color-primary-bg);
    box-shadow: inset 3px 0 0 var(--color-primary);
    color: var(--color-primary);
  }
  .sd-pagelist a.on .t {
    font-weight: 700;
  }
  .sd-pagelist a.on .sub {
    color: inherit;
  }
  .sd-fab {
    position: fixed;
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 80;
    width: 46px;
    height: 56px;
    border: 0;
    border-radius: 28px 0 0 28px;
    background: var(--color-primary);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-right: 6px;
    cursor: pointer;
    box-shadow: var(--shadow-md);
  }
  /* ── 모바일 아래 막대 ── */
  .dock-spacer {
    height: calc(56px + env(safe-area-inset-bottom, 0px));
  }
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    gap: 6px;
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding: 0 10px env(safe-area-inset-bottom, 0px);
    background: var(--color-surface);
    border-top: 1px solid var(--color-rule);
    box-shadow: 0 -4px 14px #28190f14;
    transition: transform 0.22s ease;
  }
  .dock.is-hidden {
    transform: translateY(100%);
  }
  .dk-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 14px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-ink);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .dk-btn .cnt {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--color-primary);
    color: #fff;
    font-size: 0.72rem;
    line-height: 18px;
    text-align: center;
  }
  .dk-pos {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted);
    font-size: 0.85rem;
    text-align: center;
  }
  .dk-nav {
    flex: none;
    display: inline-flex;
    gap: 4px;
  }
  .dk-nav a,
  .dk-nav .off {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    font-size: 1.4rem;
    line-height: 1;
  }
  .dk-nav a {
    color: var(--color-ink);
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
  }
  .dk-nav .off {
    color: var(--color-rule);
  }
  @media (min-width: 861px) {
    .dock,
    .dock-spacer {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dock {
      transition: none;
    }
  }
  .sd {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 91;
    width: min(420px, 100vw);
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    box-shadow: -8px 0 24px #28190f2e;
    animation: sd-in 0.18s ease-out;
  }
  .sd.is-modal {
    top: var(--jb-sd-top, 0px);
    right: var(--jb-sd-right, 0px);
    bottom: var(--jb-sd-bottom, 0px);
    border-radius: 0 var(--radius-lg, 12px) var(--radius-lg, 12px) 0;
    overflow: hidden;
  }
  @keyframes sd-in {
    from {
      transform: translate(24px);
      opacity: 0;
    }
  }
  .sd.is-sheet {
    top: auto;
    left: 0;
    width: 100%;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    box-shadow: 0 -8px 24px #28190f38;
    overflow: hidden;
    transition: height 0.2s ease-out;
    animation: sheet-in 0.2s ease-out;
  }
  .sd.is-sheet.is-dragging {
    transition: none;
  }
  @keyframes sheet-in {
    from {
      transform: translateY(100%);
    }
  }
  .sd-grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 100%;
    height: 30px; /* 손가락으로 잡기 쉽게 (22 → 30) */
    padding: 0;
    border: 0;
    background: var(--color-primary-bg);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .sd.is-sheet .sd-top {
    padding: 2px 14px 8px;
    /* 머리 줄로도 끌 수 있게 — 세로 스크롤 제스처를 시트가 받는다 */
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  /* 내용을 맨 위에서 당길 때 페이지 '당겨서 새로고침'이 끼어들지 않게 */
  .sd.is-sheet .sd-body {
    overscroll-behavior-y: contain;
  }
  .sd.is-sheet .sd-collapse {
    display: grid;
    place-items: center;
    padding: 0;
  }
  .sd-grip span {
    width: 40px;
    height: 5px;
    border-radius: 999px;
    background: var(--color-muted);
    opacity: 0.55;
  }
  .sd-grip:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .sd.is-sheet {
      transition: none;
      animation: none;
    }
  }
  .sd-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: var(--color-primary-bg);
    border-bottom: 1px solid var(--color-rule);
  }
  .sd-page {
    color: var(--color-primary);
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sd-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sd-title .sd-page {
    min-width: 0;
    font-size: 1rem;
  }
  .sd-title .hanja {
    flex: none;
  }
  .sd-top.is-place .sd-collapse {
    margin-left: 0;
  }
  .sd-collapse {
    flex: none;
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: #fff;
    color: var(--color-primary);
    font-size: 1.2rem;
    cursor: pointer;
  }
  .sd-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-rule);
  }
  .sd-tabs button {
    flex: 1;
    padding: 10px 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    font: inherit;
    color: var(--color-muted);
    cursor: pointer;
  }
  .sd-tabs button.on {
    color: var(--color-fg);
    font-weight: 700;
    border-bottom-color: var(--color-muted);
  }
  .cnt {
    margin-left: 4px;
    display: inline-block;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--color-muted);
    color: #fff;
    font-size: 0.72rem;
    line-height: 18px;
  }
  .sd-body {
    flex: 1;
    overflow: auto;
    padding: 12px 14px 24px;
  }
  .sd-slides {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: pan-y;
    overscroll-behavior-x: contain;
  }
  .sd-slide {
    position: absolute;
    inset: 0;
    background: var(--color-bg);
    touch-action: pan-y;
    overscroll-behavior-x: contain;
    transition: transform 0.2s ease-out;
  }
  .sd-slide.is-swiping {
    transition: none;
  }
  .sd-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .sd-list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sd-list button:hover {
    border-color: var(--color-secondary);
  }
  .chip {
    flex: none;
    font-size: 0.72rem;
    padding: 1px 8px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    color: var(--color-muted);
    background: #fff;
  }
  .sd-cardhead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-rule);
  }
  .sd-cardhead .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hanja {
    color: var(--color-muted);
    font-size: 0.85em;
  }
  .sd-back,
  .sd-x {
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font: inherit;
    font-size: 0.8rem;
    color: var(--color-muted);
    cursor: pointer;
    flex: none;
  }
  .sd-x {
    margin-left: auto;
    border: 0;
    background: none;
    font-size: 1rem;
  }
  .sd-occ {
    padding: 10px 12px;
    margin-bottom: 14px;
    border: 1px solid var(--color-secondary);
    border-radius: var(--radius-sm);
    background: var(--color-secondary-bg);
    font-size: 0.86rem;
    color: var(--color-secondary);
  }
  .sd-occ div {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .sd-occ button {
    border: 1px solid var(--color-secondary);
    border-radius: 999px;
    background: #fff;
    color: var(--color-secondary);
    font: inherit;
    font-size: 0.78rem;
    padding: 2px 10px;
    cursor: pointer;
  }
  .sd-hero {
    width: 100%;
    border-radius: var(--radius-md);
    margin-bottom: 10px;
  }
  .sd-summary {
    margin: 0 0 12px;
    color: var(--color-muted);
  }
  .sd-content :global(h1) {
    display: none;
  }
  .sd-back-links {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--color-rule);
    display: grid;
    gap: 6px;
  }
  .sd-back-links h4 {
    margin: 0 0 4px;
    color: var(--color-primary);
    font-size: 0.95rem;
  }
  .sd-back-links button {
    text-align: left;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .sd-go {
    margin-top: 18px;
    border: 0;
    background: none;
    color: var(--color-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .sd-foot {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px;
    border-top: 1px solid var(--color-rule);
  }
  .sd-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .sd-foot.is-map {
    justify-content: space-between;
    padding: 8px 14px;
  }
  .sd-foot.is-map .sd-nav {
    gap: 10px;
  }
  .sd-foot.is-map .dots {
    flex-wrap: wrap;
  }
  .sd-clear {
    flex: none;
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    background: #fff;
    color: var(--color-primary);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .sd-clear:active {
    background: var(--color-primary-bg);
  }
  .sd-arrow {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--color-rule);
    background: #fff;
    cursor: pointer;
    font-size: 1.1rem;
    color: var(--color-muted);
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dots button {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 0;
    padding: 0;
    background: var(--color-rule);
    cursor: pointer;
  }
  .dots button.on {
    background: var(--color-muted);
  }
  .dim {
    color: var(--color-muted);
  }
  .fd-list {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .fd-item {
    padding: 10px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  .fd-item.reply {
    margin-left: 18px;
    background: var(--color-bg);
  }
  .fd-meta {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 0.8rem;
    color: var(--color-muted);
    margin-bottom: 4px;
  }
  .fd-meta strong {
    color: var(--color-fg);
  }
  .fd-body {
    font-size: 0.92rem;
    line-height: 1.7;
    word-break: break-word;
  }
  .fd-body :global(p) {
    margin: 0;
  }
  .fd-write {
    display: grid;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--color-rule);
  }
  .fd-write textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font: inherit;
    resize: vertical;
  }
  .fd-post,
  .fd-login {
    justify-self: end;
    padding: 6px 16px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--color-primary);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .fd-post:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .fd-replying {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-secondary);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 0.8rem;
    color: var(--color-secondary);
    cursor: pointer;
  }
  .link.danger {
    color: var(--color-primary);
  }
  .err {
    color: var(--color-primary);
    font-size: 0.85rem;
  }
</style>
