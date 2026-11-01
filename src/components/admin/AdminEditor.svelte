<script lang="ts">
  // 관리자 — 문서(article)·장소(place) 편집기. 본문은 블록 편집기, 오른쪽에 공개 상태·태그·속성·사진.
  // 자료실 책은 차례(장 목록)를, 장은 책의 공개 상태를 따른다. 저장할 때마다 직전 내용이 수정 이력에 남는다.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi, fmtKst, toApi, fromApi, emptyBlock, newImage, type EditBlock } from "../../lib/blocks";
  import { library, articleHref, chapterHref, SCRIPTURE_CATEGORY } from "../../lib/library";
  import { PLACE_KINDS, ABOUT_KINDS } from "../../lib/content-types";
  import { BRANCHES } from "../../data/branches";
  import { iconPath } from "../../lib/map-categories";
  import { confirmDialog } from "../../lib/confirm";
  import { CROP_DEFAULT, cropStyle, type Crop } from "../../lib/crop";
  import BlockEditor from "../BlockEditor.svelte";
  import MediaLibrary from "../MediaLibrary.svelte";
  import SelectMenu from "../SelectMenu.svelte";

  let {
    type,
    id = null,
    section = "about",
    parent = null,
  }: { type: "article" | "place"; id?: string | null; section?: string; parent?: string | null } = $props();

  let categories = $state<any[]>([]);
  library
    .categories()
    .then((r) => (categories = r.categories.filter((c: any) => c.type === "article")))
    .catch(() => {});

  const isArticle = type === "article";
  let currentId = $state<string | null>(id);
  let loading = $state(!!id);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let msg = $state<{ tone: string; text: string } | null>(null);
  /** 주소를 직접 고쳤거나 기존 글이면 제목에서 slug 를 자동으로 만들지 않는다 */
  let slugTouched = $state(!!id);
  // 마지막으로 저장된 값(미리보기 주소용)
  let savedStatus = $state("draft");
  let savedSlug = $state("");
  let savedKind = $state("");
  let savedSection = $state(section);
  let parentId = $state<string | null>(parent);
  let book = $state<any>(null);
  let chapters = $state<any[]>([]);
  let ordering = $state(false);

  /** 책의 한 장 */
  const isChapter = $derived(isArticle && !!parentId);
  /** 차례 상자를 보일 책: 경전 분류이거나 이미 장이 있는 자료실 글 */
  const showToc = $derived(
    isArticle &&
      !parentId &&
      !!currentId &&
      savedSection === "library" &&
      (savedKind === SCRIPTURE_CATEGORY || chapters.length > 0),
  );

  function setBook(it: any) {
    parentId = it.parent_id ?? null;
    book = it.book ?? null;
    chapters = Array.isArray(it.chapters) ? it.chapters : [];
  }

  async function moveChapter(i: number, d: number) {
    const j = i + d;
    if (!currentId || ordering || j < 0 || j >= chapters.length) return;
    const before = chapters;
    const next = [...chapters];
    [next[i], next[j]] = [next[j], next[i]];
    chapters = next;
    ordering = true;
    try {
      await adminApi.orderChapters(
        currentId,
        next.map((c) => c.id),
      );
    } catch (e) {
      chapters = before;
      msg = { tone: "err", text: e instanceof Error ? e.message : "순서 저장 실패" };
    } finally {
      ordering = false;
    }
  }

  const f = $state({
    section,
    kind: isArticle ? "" : "jeongak",
    slug: "",
    title: "",
    title_hanja: "",
    summary: "",
    sort_order: 0 as number | string,
    pinned: false,
    featured: false,
    status: "draft",
    birth: "",
    aliases: "",
    built: "",
    lat: "" as number | string,
    lng: "" as number | string,
    location_hidden: false,
    branch_code: "",
    geojson: "",
    tags: [] as string[],
  });

  let allTags = $state<any[]>([]);
  function toggleTag(tid: string) {
    f.tags = f.tags.includes(tid) ? f.tags.filter((t) => t !== tid) : [...f.tags, tid];
  }

  let blocks = $state<EditBlock[]>([]);
  let hero = $state<{ id: string; url: string } | null>(null);
  let thumb = $state<{ id: string; url: string } | null>(null);
  let revisions = $state<any[]>([]);
  let picking = $state<"thumb" | "hero" | null>(null);
  let crop = $state<Crop>({ ...CROP_DEFAULT });
  const ratio = isArticle ? "16 / 10" : "4 / 3";

  function setThumb(m: { id: string; url: string } | null) {
    if (m?.id !== thumb?.id) crop = { ...CROP_DEFAULT };
    thumb = m;
  }
  /** 본문 사진 블록에서 "썸네일로/헤더로" 지정 */
  function onRole(role: "thumb" | "hero", m: { id: string; url: string }) {
    if (role === "hero") hero = hero?.id === m.id ? null : m;
    else setThumb(thumb?.id === m.id ? null : m);
  }

  // 썸네일 초점 끌기
  let drag: { px: number; py: number; x: number; y: number; ox: number; oy: number } | null = null;
  function cropDown(e: PointerEvent) {
    const box = e.currentTarget as HTMLElement;
    const img = box.querySelector("img");
    if (!img?.naturalWidth) return;
    const r = box.getBoundingClientRect();
    const scale = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight) * crop.z;
    drag = {
      px: e.clientX,
      py: e.clientY,
      x: crop.x,
      y: crop.y,
      ox: img.naturalWidth * scale - r.width,
      oy: img.naturalHeight * scale - r.height,
    };
    box.setPointerCapture(e.pointerId);
  }
  function cropMove(e: PointerEvent) {
    if (!drag) return;
    const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
    if (drag.ox > 1) crop.x = clamp(drag.x - ((e.clientX - drag.px) / drag.ox) * 100);
    if (drag.oy > 1) crop.y = clamp(drag.y - ((e.clientY - drag.py) / drag.oy) * 100);
  }
  function cropUp() {
    drag = null;
  }

  let savedJson = $state("");

  const kindGroups = $derived(
    isArticle
      ? f.section === "library"
        ? [{ options: categories.map((c) => ({ value: c.key, label: c.label })) }]
        : [{ options: Object.entries(ABOUT_KINDS).map(([value, label]) => ({ value, label })) }]
      : [{ options: Object.entries(PLACE_KINDS).map(([value, label]) => ({ value, label })) }],
  );
  const branchGroups = [
    {
      label: "지부",
      options: BRANCHES.filter((b) => b.kind === "지부").map((b) => ({ value: b.code, label: b.name })),
    },
    {
      label: "분원",
      options: BRANCHES.filter((b) => b.kind === "분원").map((b) => ({ value: b.code, label: b.name })),
    },
  ];

  /** 저장할 값 */
  function payload() {
    const base = {
      kind: f.kind,
      slug: f.slug.trim(),
      summary: f.summary,
      blocks: toApi(blocks),
      sort_order: f.sort_order === "" ? 0 : Number(f.sort_order),
      status: f.status,
      hero_media_id: hero?.id ?? null,
      thumb_media_id: thumb?.id ?? null,
      thumb_crop: thumb ? crop : null,
      gallery: [],
      tags: [...f.tags].sort(),
    };
    if (isArticle) {
      const meta: Record<string, unknown> = {};
      if (f.kind === "person" && f.birth.trim()) meta.birth = f.birth.trim();
      if (f.kind === "person" || f.section === "library") {
        const aliases = f.aliases
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (aliases.length) meta.aliases = aliases;
      }
      const lib =
        f.section === "library" ? { pinned: f.pinned, featured: f.featured, parent_id: parentId } : {};
      return { ...base, ...lib, section: f.section, title: f.title, title_hanja: f.title_hanja, meta };
    }
    return {
      ...base,
      name: f.title,
      name_hanja: f.title_hanja,
      built: f.built,
      lat: f.lat === "" ? null : Number(f.lat),
      lng: f.lng === "" ? null : Number(f.lng),
      location_hidden: f.location_hidden,
      branch_code: f.kind === "branch" && f.branch_code ? f.branch_code : null,
      geojson: f.geojson,
    };
  }

  const dirty = $derived(!loading && JSON.stringify(payload()) !== savedJson);
  $effect(() => {
    (window as any).__jbAdminDirty = dirty;
  });

  function fill(it: any) {
    f.section = it.section ?? section;
    f.kind = it.kind ?? "";
    f.slug = it.slug ?? "";
    f.title = it.title ?? it.name ?? "";
    f.title_hanja = it.title_hanja ?? it.name_hanja ?? "";
    f.summary = it.summary ?? "";
    blocks = fromApi(it.blocks ?? (it.body_md ? [{ type: "text", text: it.body_md }] : []));
    f.sort_order = it.sort_order ?? 0;
    f.pinned = !!it.pinned;
    f.featured = !!it.featured;
    f.status = it.status ?? "draft";
    f.birth = it.meta?.birth ?? "";
    f.aliases = Array.isArray(it.meta?.aliases) ? it.meta.aliases.join(", ") : "";
    f.built = it.built ?? "";
    f.lat = it.lat ?? "";
    f.lng = it.lng ?? "";
    f.location_hidden = !!it.location_hidden;
    f.branch_code = it.branch_code ?? "";
    f.geojson = typeof it.geojson == "string" ? it.geojson : it.geojson ? JSON.stringify(it.geojson) : "";
    f.tags = Array.isArray(it.tags) ? [...it.tags] : [];
    hero = it.hero ? { id: it.hero.id, url: it.hero.url } : null;
    thumb = it.thumb ? { id: it.thumb.id, url: it.thumb.url } : null;
    crop = it.thumb?.crop ? { ...it.thumb.crop } : { ...CROP_DEFAULT };
    // 예전 갤러리는 본문 끝의 사진 블록으로 옮긴다
    if (Array.isArray(it.gallery) && it.gallery.length) {
      const g = emptyBlock("image");
      g.images = it.gallery.map((m: any) =>
        newImage({ media_id: m.id, view_url: m.url, caption: m.link_caption ?? "" }),
      );
      blocks = [...blocks, g];
    }
  }

  function markSaved(it: any) {
    savedStatus = it.status;
    savedSlug = it.slug;
    savedKind = it.kind;
    savedSection = it.section ?? "";
    savedJson = JSON.stringify(payload());
  }

  async function loadRevisions() {
    if (!currentId) return;
    try {
      revisions = (await adminApi.revisions(type, currentId)).revisions;
    } catch {
      revisions = [];
    }
  }

  onMount(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as any).__jbAdminDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    adminApi
      .listTags()
      .then((r: any) => (allTags = r.items))
      .catch(() => (allTags = []));
    (async () => {
      if (currentId) {
        try {
          const it = (await adminApi.get(type, currentId)).item;
          fill(it);
          setBook(it);
          loading = false;
          markSaved(it);
          loadRevisions();
        } catch (e) {
          loadError = e instanceof Error ? e.message : "불러오기 실패";
          loading = false;
        }
      } else {
        // 책에 장 추가: 책의 분류·공개 상태를 따르고 순서는 맨 끝
        if (isArticle && parentId) {
          try {
            const b = (await adminApi.get("article", parentId)).item;
            book = { id: b.id, slug: b.slug, kind: b.kind, title: b.title, status: b.status };
            f.section = "library";
            f.kind = b.kind;
            f.status = b.status;
            f.sort_order = (b.chapters?.length ?? 0) + 1;
          } catch (e) {
            loadError = e instanceof Error ? e.message : "책을 불러오지 못했습니다";
          }
        }
        loading = false;
        savedJson = JSON.stringify(payload());
      }
    })();
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      (window as any).__jbAdminDirty = false;
    };
  });

  function slugify(s: string) {
    return s
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9가-힣_-]/g, "")
      .replace(/^[-_]+/, "")
      .slice(0, 80);
  }
  function onTitleInput() {
    if (!slugTouched) f.slug = slugify(f.title);
  }
  function setSection(v: string) {
    f.section = v;
    const keys = v === "library" ? categories.map((c) => c.key) : Object.keys(ABOUT_KINDS);
    if (!keys.includes(f.kind)) f.kind = "";
  }

  async function save() {
    msg = null;
    if (!f.title.trim())
      return (msg = { tone: "err", text: isArticle ? "제목을 입력해 주세요." : "이름을 입력해 주세요." });
    if (!f.kind) return (msg = { tone: "err", text: "종류를 골라 주세요." });
    if (!f.slug.trim()) return (msg = { tone: "err", text: "주소(slug)를 입력해 주세요." });
    saving = true;
    try {
      const body = payload();
      const it = currentId
        ? (await adminApi.update(type, currentId, body)).item
        : (await adminApi.create(type, body)).item;
      const created = !currentId;
      currentId = it.id;
      fill(it);
      setBook(it);
      markSaved(it);
      msg = {
        tone: "ok",
        text: `저장했습니다 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`,
      };
      loadRevisions();
      if (created) history.replaceState(null, "", `#${type}/${it.id}`);
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (
      !currentId ||
      !(await confirmDialog({
        title: "삭제",
        message: `"${f.title}"을(를) 삭제할까요? 방문자 화면에서 바로 사라집니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await adminApi.remove(type, currentId);
      (window as any).__jbAdminDirty = false;
      location.hash = backHref();
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "삭제 실패" };
    }
  }

  async function restore(rev: any) {
    if (
      !(await confirmDialog({
        title: "예전 내용 불러오기",
        message: `${fmtKst(rev.created_at)}에 저장되기 직전 내용을 편집 칸에 불러옵니다. 확인한 뒤 "저장"을 눌러야 반영됩니다.`,
        confirmText: "불러오기",
      }))
    )
      return;
    try {
      const snap = (await adminApi.revision(rev.id)).revision.snapshot;
      fill(snap);
      slugTouched = true;
      msg = { tone: "info", text: "예전 내용을 불러왔습니다. 확인 후 저장하면 되돌려집니다." };
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "불러오기 실패" };
    }
  }

  function backHref() {
    if (!isArticle) return "#jeongak";
    if (parentId) return `#article/${parentId}`;
    return (f.section || section) === "library" ? "#archive" : "#about";
  }
  function siteHref(preview: boolean) {
    const q = preview ? "?preview=1" : "";
    if (isArticle) {
      if (book) return `${chapterHref(book.kind, book.slug, savedSlug)}${q}`;
      return savedSection === "library"
        ? `${articleHref(savedKind, savedSlug)}${q}`
        : `/about/${savedSlug}/${q}`;
    }
    return savedKind === "jeongak" ? `/jeongak/${savedSlug}/${q}` : `/archive/places/${savedSlug}/${q}`;
  }
  function onPick(list: { id: string; url: string }[]) {
    const m = list[0];
    const v = m ? { id: m.id, url: m.url } : null;
    if (picking === "thumb") setThumb(v);
    else hero = v;
    picking = null;
  }

  const STATUSES = [
    { v: "draft", l: "작성 중", d: "사이트에서 운영자만 보임" },
    { v: "published", l: "공개", d: "방문자에게 보임" },
    { v: "hidden", l: "숨김", d: "사이트에서 내림" },
  ];
</script>

{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if loadError}
  <p class="err">{loadError}</p>
  <a href={backHref()}>← 목록으로</a>
{:else}
  <div class="top">
    <a href={backHref()}>← {isChapter && book ? book.title : "목록으로"}</a>
    <div class="actions">
      {#if currentId && savedSlug}
        <a class="btn btn-ghost" href={siteHref(savedStatus !== "published")} target="_blank" rel="noopener"
          >{savedStatus === "published" ? "사이트에서 보기" : "미리보기"}</a
        >
      {/if}
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}
        >{saving ? "저장 중…" : "저장"}</button
      >
    </div>
  </div>
  {#if dirty}<p class="dirty">저장하지 않은 변경이 있습니다.</p>{/if}
  {#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
  <div class="layout">
    <div class="main">
      <div class="grid2">
        <label
          ><span>{isArticle ? "제목" : "이름"} *</span>
          <input bind:value={f.title} oninput={onTitleInput} maxlength="200" /></label
        >
        <label><span>한자</span> <input bind:value={f.title_hanja} maxlength="100" /></label>
      </div>
      <label
        ><span>요약 <small>목록 카드와 제목 아래에 나오는 한두 문장</small></span>
        <textarea bind:value={f.summary} rows="2" maxlength="500"></textarea></label
      >
      <div class="body-head"><span>본문</span></div>
      <BlockEditor
        mode="admin"
        thumbId={thumb?.id ?? null}
        heroId={hero?.id ?? null}
        onrole={onRole}
        bind:blocks
      />
      {#if showToc}
        <section class="box">
          <div class="box-head">
            <strong>차례 <small>{chapters.length}장</small></strong>
            <a class="btn btn-ghost sm" href={`#article/new?section=library&parent=${currentId}`}
              >＋ 장 추가</a
            >
          </div>
          {#if chapters.length}
            <ol class="toc">
              {#each chapters as c, i (c.id)}
                <li>
                  <span class="no">{i + 1}</span>
                  <a href={`#article/${c.id}`}>{c.title}</a>
                  <button
                    type="button"
                    class="mv"
                    aria-label="위로"
                    disabled={i === 0 || ordering}
                    onclick={() => moveChapter(i, -1)}>↑</button
                  >
                  <button
                    type="button"
                    class="mv"
                    aria-label="아래로"
                    disabled={i === chapters.length - 1 || ordering}
                    onclick={() => moveChapter(i, 1)}>↓</button
                  >
                </li>
              {/each}
            </ol>
          {:else}
            <p class="dim">아직 장이 없습니다.</p>
          {/if}
        </section>
      {/if}
      {#if currentId}
        <section class="box">
          <strong>수정 이력</strong>
          {#if revisions.length}
            <ul class="revs">
              {#each revisions as rev (rev.id)}
                <li>
                  <span>{fmtKst(rev.created_at)}</span>
                  <span class="dim"
                    >{rev.editor ?? "?"} · {rev.action === "delete" ? "삭제 직전" : "저장 직전"}</span
                  >
                  <button type="button" class="link" onclick={() => restore(rev)}>이 내용 불러오기</button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="dim">아직 수정 이력이 없습니다. 저장할 때마다 직전 내용이 여기에 남습니다.</p>
          {/if}
        </section>
      {/if}
    </div>
    <aside class="side">
      {#if isChapter}
        <section class="box">
          <strong>공개 상태</strong>
          <span
            >{STATUSES.find((s) => s.v === (book?.status ?? f.status))?.l ?? f.status}
            <small>책을 따름</small></span
          >
          {#if book}<a href={`#article/${book.id}`}>{book.title}</a>{/if}
        </section>
      {:else}
        <section class="box">
          <strong
            >공개 상태{#if chapters.length}<small>장 {chapters.length}편도 함께</small>{/if}</strong
          >
          {#each STATUSES as s}
            <label class="check"
              ><input type="radio" name="status" value={s.v} bind:group={f.status} />
              {s.l} <small>{s.d}</small></label
            >
          {/each}
        </section>
      {/if}
      <section class="box">
        <strong>태그 <small>새 태그는 태그 탭에서</small></strong>
        {#if allTags.length}
          <div class="tagset" role="group" aria-label="태그">
            {#each allTags as tg (tg.id)}
              <button
                type="button"
                class="tg"
                class:on={f.tags.includes(tg.id)}
                aria-pressed={f.tags.includes(tg.id)}
                style:--c={tg.color}
                onclick={() => toggleTag(tg.id)}
                ><svg viewBox="0 -960 960 960" width="13" height="13" aria-hidden="true"
                  ><path fill="currentColor" d={iconPath(tg.icon)}></path></svg
                >
                {tg.name}</button
              >
            {/each}
          </div>
          <small
            >자료에 붙인 태그는 지도에 나오지 않습니다. 지도에 올리려면 본문에 지도 블록을 넣으세요.</small
          >
        {:else}
          <small>아직 태그가 없습니다. <a href="#tag/new">태그 만들기</a></small>
        {/if}
      </section>
      <section class="box">
        {#if isArticle && !isChapter}
          <label
            ><span>구분</span>
            <select value={f.section} onchange={(e) => setSection(e.currentTarget.value)}
              ><option value="about">소개</option><option value="library">자료실</option></select
            ></label
          >
        {/if}
        {#if (isArticle && !isChapter) || (!isArticle && f.kind !== "jeongak")}
          <div class="field">
            <span id="kind-label">종류 *</span>
            <SelectMenu groups={kindGroups} labelledby="kind-label" bind:value={f.kind} />
          </div>
        {/if}
        {#if !isArticle && f.kind === "branch"}
          <div class="field">
            <span id="branch-label">지부·분원</span>
            <SelectMenu
              groups={branchGroups}
              labelledby="branch-label"
              placeholder="선택 안 함"
              bind:value={f.branch_code}
            />
          </div>
        {/if}
        <label
          ><span>주소(slug) * <small>사이트 주소 끝부분</small></span>
          <input bind:value={f.slug} oninput={() => (slugTouched = true)} maxlength="80" /></label
        >
        {#if isArticle && f.section === "library" && !isChapter}
          <label class="check"
            ><input type="checkbox" bind:checked={f.pinned} /> 목록 맨 앞에 고정
            <small>나머지는 가나다순</small></label
          >
          <label class="check"
            ><input type="checkbox" bind:checked={f.featured} /> 주요 자료
            <small>자료실 오른쪽에 썸네일로</small></label
          >
        {/if}
        {#if !isChapter}
          <label
            ><span
              >순서 <small
                >{isArticle && f.section === "library"
                  ? "맨 앞 고정 글끼리, 작을수록 앞"
                  : "작을수록 앞"}</small
              ></span
            >
            <input type="number" step="1" bind:value={f.sort_order} /></label
          >
        {/if}
        {#if isArticle && f.kind === "person"}
          <label><span>생몰·생년</span><input bind:value={f.birth} maxlength="500" /></label>
        {/if}
        {#if isArticle && (f.kind === "person" || f.section === "library")}
          <label
            ><span>{f.kind === "person" ? "호·별칭" : "별칭"} <small>쉼표로 구분</small></span><input
              bind:value={f.aliases}
            /></label
          >
        {/if}
        {#if !isArticle}
          <label><span>건립 시기</span><input bind:value={f.built} maxlength="100" /></label>
        {/if}
      </section>
      <section class="box">
        <strong>사진</strong>
        <div class="pics">
          <div class="pic">
            <span class="pic-label">썸네일</span>
            {#if thumb}
              <div
                class="crop"
                style={`aspect-ratio:${ratio}`}
                title="끌어서 위치 맞추기"
                role="presentation"
                onpointerdown={cropDown}
                onpointermove={cropMove}
                onpointerup={cropUp}
                onpointercancel={cropUp}
              >
                <img src={thumb.url} alt="" draggable="false" style={cropStyle(crop)} />
              </div>
              <label class="zoom"
                ><span>확대</span><input
                  type="range"
                  min="1"
                  max="2.5"
                  step="0.05"
                  bind:value={crop.z}
                /></label
              >
            {:else}
              <span class="pic-empty" style={`aspect-ratio:${ratio}`}>없음</span>
            {/if}
            <div class="row">
              <button type="button" class="btn btn-ghost sm" onclick={() => (picking = "thumb")}
                >{thumb ? "바꾸기" : "고르기"}</button
              >
              {#if thumb}
                <button type="button" class="btn btn-ghost sm" onclick={() => (crop = { ...CROP_DEFAULT })}
                  >초기화</button
                >
                <button type="button" class="btn btn-ghost sm" onclick={() => setThumb(null)}>빼기</button>
              {/if}
            </div>
          </div>
          <div class="pic">
            <span class="pic-label">헤더 배경</span>
            {#if hero}<img src={hero.url} alt="" />{:else}<span class="pic-empty">없음</span>{/if}
            <div class="row">
              <button type="button" class="btn btn-ghost sm" onclick={() => (picking = "hero")}
                >{hero ? "바꾸기" : "고르기"}</button
              >
              {#if hero}<button type="button" class="btn btn-ghost sm" onclick={() => (hero = null)}
                  >빼기</button
                >{/if}
            </div>
          </div>
        </div>
      </section>
      {#if currentId}
        <button type="button" class="btn btn-ghost danger" onclick={remove}>삭제</button>
      {/if}
    </aside>
  </div>
{/if}
{#if picking}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="사진 고르기">
    <div class="sheet">
      <h3>{picking === "thumb" ? "썸네일" : "헤더 배경"} 사진 고르기</h3>
      <MediaLibrary mode="pick" onpick={onPick} oncancel={() => (picking = null)} />
    </div>
  </div>
{/if}

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 8px 0;
  }
  .actions,
  .row {
    display: flex;
    gap: 8px;
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 20px;
    align-items: start;
  }
  .main,
  .side {
    display: grid;
    gap: 14px;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
  }
  .grid2 {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }
  label,
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.86rem;
    font-weight: 600;
  }
  small {
    font-weight: 400;
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  input:not([type="checkbox"]):not([type="radio"]),
  textarea,
  select {
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    font: inherit;
    font-weight: 400;
    color: var(--color-fg);
    width: 100%;
    box-sizing: border-box;
  }
  .body-head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    font-size: 0.86rem;
    font-weight: 600;
    margin-bottom: -8px;
  }
  .preview {
    min-height: 320px;
    padding: 14px 18px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  .box {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .box-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
  }
  .pics {
    display: grid;
    gap: 14px;
  }
  .crop {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-sm);
    cursor: grab;
    touch-action: none;
    user-select: none;
    background: var(--color-surface-2);
  }
  .crop:active {
    cursor: grabbing;
  }
  .crop img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .zoom input {
    flex: 1;
    accent-color: var(--color-primary);
  }
  .pic {
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .pic .row {
    flex-wrap: wrap;
    gap: 4px;
  }
  .pic .row .btn {
    white-space: nowrap;
  }
  .pic-label {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .pic > img,
  .pic-empty {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .pic-empty {
    display: grid;
    place-items: center;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .revs {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.84rem;
    display: grid;
    gap: 6px;
  }
  .revs li {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .link {
    border: 0;
    background: none;
    color: var(--color-primary);
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    padding: 0;
  }
  .sm {
    padding: 5px 12px;
    font-size: 0.82rem;
  }
  .danger {
    color: var(--color-primary);
    justify-self: start;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.84rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  .dirty {
    margin: 0 0 6px;
    font-size: 0.82rem;
    color: var(--color-gold);
  }
  .msg {
    margin: 0 0 10px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }
  .msg.ok {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .msg.err {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .msg.info {
    background: var(--color-surface-2);
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--color-overlay);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 16px;
    overflow: auto;
  }
  .sheet {
    width: min(960px, 100%);
    background: var(--color-bg);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow-lg);
  }
  .sheet h3 {
    margin: 0 0 12px;
  }
  .prose :global(h1) {
    font-size: 1.4rem;
  }
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .tagset {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--c);
    border-radius: 999px;
    background: #fff;
    color: var(--c);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 400;
    cursor: pointer;
  }
  .tg.on {
    background: var(--c);
    color: #fff;
  }
  .toc {
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .box:has(.toc) {
    grid-template-columns: minmax(0, 1fr);
  }
  .toc li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 0;
    border-top: 1px solid var(--color-rule);
    font-size: 0.9rem;
  }
  .toc li:first-child {
    border-top: 0;
  }
  .toc .no {
    min-width: 1.8em;
    color: var(--color-muted);
    font-size: 0.8rem;
    text-align: right;
  }
  .toc a {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-fg);
  }
  .mv {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    color: var(--color-fg);
    cursor: pointer;
    flex: none;
  }
  .mv:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
