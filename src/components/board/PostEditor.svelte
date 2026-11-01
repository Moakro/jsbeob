<script lang="ts">
  // 게시글 쓰기·수정 — 블록 본문(BlockEditor). 자료실 게시판은 분류·시리즈, 소식은 공지·기간(달력 일정).
  // 복원(2026-11-01): 배포본 클라이언트(_astro/PostEditor.*.js) 기준.
  import { onMount } from "svelte";
  import { api, BOARDS, boardBase, postHref, type MeUser } from "../../lib/api";
  import BlockEditor from "../BlockEditor.svelte";
  import SelectMenu from "../SelectMenu.svelte";
  import { fromApi, toApi, type EditBlock } from "../../lib/blocks";
  import { LIBRARY_BOARD, library } from "../../lib/library";

  let {
    board,
    postId = null,
    category: initialCategory = null,
  }: { board: string; postId?: string | null; category?: string | null } = $props();

  const meta = BOARDS[board];
  const editing = !!postId;
  const isLibrary = board === LIBRARY_BOARD;
  let category = $state(initialCategory ?? LIBRARY_BOARD);
  let seriesId = $state("");
  const isNews = board === "news";
  let notice = $state(false);
  let pStart = $state("");
  let pEnd = $state("");
  let newSeries = $state("");
  let categories = $state<any[]>([]);
  let seriesList = $state<any[]>([]);

  const categoryGroups = $derived([{ options: categories.map((c) => ({ value: c.key, label: c.label })) }]);
  const seriesGroups = $derived([
    { options: [{ value: "", label: "시리즈 없음" }] },
    ...(seriesList.length
      ? [
          {
            label: "기존 시리즈",
            options: seriesList.map((s) => ({ value: s.id, label: `${s.title} (${s.count}편)` })),
          },
        ]
      : []),
    { options: [{ value: "__new", label: "＋ 새 시리즈 만들기" }] },
  ]);

  let me = $state<MeUser | null>(null);
  let ready = $state(false);
  let title = $state("");
  let blocks = $state<EditBlock[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);
  /** 저장 안 한 변경 감지용 처음 상태 */
  let initial = $state("");
  let leaving = false;

  const canWrite = $derived(!!me && !!me.display_name && (me.level ?? 0) >= (meta?.writeLevel ?? 1));

  const snapshot = () =>
    JSON.stringify({ title, blocks: toApi(blocks), category, seriesId, notice, pStart, pEnd });

  onMount(() => {
    (async () => {
      try {
        me = (await api.me()).user;
      } catch {}
      if (editing && postId) {
        try {
          const p = (await api.getPost(postId)).post as any;
          title = p.title;
          blocks = fromApi(p.blocks);
          if (isLibrary) {
            category = p.category ?? category;
            seriesId = p.series_id ?? "";
          }
          if (isNews) {
            notice = !!p.is_pinned;
            pStart = p.period?.start ?? "";
            pEnd = p.period?.end ?? "";
          }
        } catch (e) {
          error = e instanceof Error ? e.message : "불러오기 실패";
        }
      }
      if (isLibrary && canWrite) {
        try {
          categories = (await library.categories()).categories.filter((c: any) => c.type === "post");
          seriesList = (await library.series()).series;
        } catch {}
      }
      ready = true;
      queueMicrotask(() => (initial = snapshot()));
    })();
    // 저장하지 않고 나가려 하면 브라우저 확인
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!leaving && ready && initial && snapshot() !== initial) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  async function save(e: Event) {
    e.preventDefault();
    error = null;
    if (!title.trim()) {
      error = "제목을 입력하세요.";
      return;
    }
    const body = toApi(blocks);
    if (!body.length) {
      error = "본문이 비어 있습니다. 블록을 하나 이상 채워 주세요.";
      return;
    }
    if (isNews && pEnd && !pStart) {
      error = "기간의 시작일을 넣어 주세요.";
      return;
    }
    if (isNews && pStart && pEnd && pEnd < pStart) {
      error = "끝나는 날이 시작하는 날보다 앞입니다.";
      return;
    }
    if (isLibrary && seriesId === "__new" && !newSeries.trim()) {
      error = "새 시리즈 이름을 입력하세요.";
      return;
    }
    saving = true;
    try {
      let lib = {};
      if (isLibrary) {
        let sid: string | null = seriesId || null;
        if (sid === "__new") {
          sid = (await library.createSeries(newSeries.trim())).series.id;
          seriesId = sid!;
          newSeries = "";
        }
        lib = { category, series_id: sid };
      }
      const news = isNews ? { notice, period: pStart ? { start: pStart, end: pEnd || null } : null } : {};
      const input = { title: title.trim(), blocks: body, ...lib, ...news };
      leaving = true;
      if (editing && postId) {
        await api.updatePost(postId, input);
        window.location.href = postHref(board, postId, isLibrary ? category : null);
      } else {
        const r = await api.createPost({ board, ...input });
        window.location.href = postHref(board, r.id, isLibrary ? category : null);
      }
    } catch (err) {
      leaving = false;
      error = err instanceof Error ? err.message : "저장 실패";
      saving = false;
    }
  }

  const heading = $derived(
    editing
      ? "글 수정"
      : `${isLibrary ? (categories.find((c) => c.key === category)?.label ?? meta?.label ?? "") : (meta?.label ?? "")} 글쓰기`,
  );
  const cancelHref = $derived(
    editing ? postHref(board, postId!, isLibrary ? category : null) : `${boardBase(board, category)}/`,
  );
</script>

{#if !ready}
  <p class="state">불러오는 중…</p>
{:else if !me}
  <p class="state">글을 쓰려면 로그인하세요. <a href={`${boardBase(board, category)}/`}>← 돌아가기</a></p>
{:else if !canWrite}
  <p class="state">
    {me.display_name ? "이 게시판에 글을 쓸 권한이 없습니다." : "먼저 닉네임을 설정하세요."}
    <a href={me.display_name ? `${boardBase(board, category)}/` : "/account/nickname/"}>이동</a>
  </p>
{:else}
  <form class="editor" onsubmit={save}>
    <h1>{heading}</h1>
    {#if isLibrary}
      <div class="lib-fields">
        {#if categories.length > 1}
          <div class="field">
            <span id="pe-cat">분류</span>
            <SelectMenu groups={categoryGroups} labelledby="pe-cat" bind:value={category} />
          </div>
        {/if}
        <div class="field">
          <span id="pe-series">시리즈</span>
          <SelectMenu
            groups={seriesGroups}
            labelledby="pe-series"
            placeholder="시리즈 없음"
            bind:value={seriesId}
          />
          {#if seriesId === "__new"}
            <input class="new-series" bind:value={newSeries} maxlength="100" placeholder="새 시리즈 이름" />
          {/if}
        </div>
      </div>
    {/if}
    <label class="field">
      <span>제목</span>
      <input bind:value={title} maxlength="200" placeholder="제목" />
    </label>
    {#if isNews}
      <div class="news-fields">
        <label class="chk"><input type="checkbox" bind:checked={notice} /> 공지(목록 맨 위)</label>
        <div class="period">
          <span>기간</span>
          <input type="date" bind:value={pStart} aria-label="시작일" />
          <span aria-hidden="true">~</span>
          <input type="date" bind:value={pEnd} min={pStart || undefined} aria-label="종료일(선택)" />
          {#if pStart || pEnd}
            <button type="button" class="clear" onclick={() => ((pStart = ""), (pEnd = ""))}>지우기</button>
          {/if}
        </div>
        <small>기간을 넣으면 일정으로 달력에 함께 표시됩니다.</small>
      </div>
    {/if}
    <div class="field">
      <span>본문</span>
      <BlockEditor mode="member" bind:blocks />
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="buttons">
      <a class="btn btn-ghost" href={cancelHref}>취소</a>
      <button class="btn btn-primary" disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
    </div>
  </form>
{/if}

<style>
  .state {
    color: var(--color-muted);
    text-align: center;
    padding: 40px 0;
  }
  .editor {
    max-width: 720px;
    margin-inline: auto;
  }
  .editor h1 {
    font-size: 1.6rem;
    margin-bottom: 20px;
  }
  .field {
    display: block;
    margin-bottom: 18px;
  }
  .field > span {
    display: block;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 6px;
  }
  .field input {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.98rem;
  }
  .lib-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 16px;
  }
  .new-series {
    margin-top: 8px;
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 10px 14px;
    border-radius: var(--radius-md);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
  }
  .news-fields {
    display: grid;
    gap: 8px;
    margin: 0 0 16px;
  }
  .news-fields .chk {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .period {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .period > span:first-child {
    font-weight: 600;
    margin-right: 4px;
  }
  .period input {
    padding: 6px 8px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font: inherit;
  }
  .period .clear {
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .news-fields small {
    color: var(--color-muted);
    font-size: 0.82rem;
  }
</style>
