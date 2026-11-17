<script lang="ts">
  // 관리 > 게시판 — 게시판 만들기·숨김·삭제, 게시판별 CRUD 권한(회원 등급), 블록별 권한 (2026-11-16 게시판 관리 1단계)
  // 등급 값은 src/data/levels.ts. 블록 등급 기본값 = 쓰기 등급(사용자 결정), 쓰기 등급보다 낮게 둘 수 없다.
  // 1단계에서 새로 만드는 게시판은 '게시글 저장 · 목록형 · 도생광장 아래'만. 문서·장소·SNS형은 다음 단계.
  import { onMount, tick } from "svelte";
  import { LEVEL, LEVEL_LABEL, LEVELS, type BoardConfig } from "../../lib/api";
  import { confirmDialog } from "../../lib/confirm";

  const GUEST = -1;
  const BLOCKS: { type: string; label: string }[] = [
    { type: "heading", label: "소제목" },
    { type: "text", label: "글" },
    { type: "quote", label: "인용" },
    { type: "image", label: "이미지" },
    { type: "imageref", label: "이미지 참조" },
    { type: "video", label: "영상" },
    { type: "link", label: "링크" },
    { type: "map", label: "지도" },
    { type: "schedule", label: "일정" },
  ];
  const VIEW_LABEL: Record<string, string> = { list: "목록형", feed: "SNS 피드", doc: "문서", book: "책" };
  const MENU_LABEL: Record<string, string> = { community: "도생광장", archive: "자료실", about: "소개", jeongak: "전각" };
  const lvName = (v: number | null) => (v === null ? "사용 안 함" : v === GUEST ? "비회원(누구나)" : (LEVEL_LABEL[v] ?? String(v)));
  const levelsFrom = (min: number) => LEVELS.filter((l) => l >= min);

  type Form = {
    key: string;
    label: string;
    description: string;
    read_level: number;
    read_scope: "all" | "own";
    create_level: number;
    edit_own: boolean;
    edit_level: number;
    delete_own: boolean;
    delete_level: number;
    comment_level: number | null;
    blocks: Record<string, number | null>;
    notice: boolean;
    title_optional: boolean;
    official: boolean;
    sort_order: number;
    status: "active" | "hidden";
  };

  let boards = $state<BoardConfig[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  /** 편집 중인 게시판 key, 새로 만들기면 "" */
  let editing = $state<string | null>(null);
  let form = $state<Form | null>(null);
  let saving = $state(false);
  let formError = $state<string | null>(null);
  /** 연 직후 form 값(저장 안 한 변경 확인용) */
  let initial = "";
  let formEl = $state<HTMLFormElement | null>(null);

  const current = $derived(editing ? (boards.find((b) => b.key === editing) ?? null) : null);
  const isFeed = $derived(current?.view === "feed");

  async function load() {
    loading = true;
    error = null;
    try {
      const r = await fetch("/api/boards", { credentials: "same-origin" }).then((res) => res.json());
      boards = r.boards ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function open(b: BoardConfig | null) {
    formError = null;
    notice = null;
    editing = b ? b.key : "";
    const create = b ? b.create_level : LEVEL.GENERAL;
    form = {
      key: b?.key ?? "",
      label: b?.label ?? "",
      description: b?.description ?? "",
      read_level: b?.read_level ?? GUEST,
      read_scope: b?.read_scope ?? "all",
      create_level: create,
      edit_own: b?.edit_own ?? true,
      edit_level: b?.edit_level ?? LEVEL.ADMIN,
      delete_own: b?.delete_own ?? true,
      delete_level: b?.delete_level ?? LEVEL.ADMIN,
      comment_level: b ? b.comment_level : LEVEL.PENDING,
      // 새 게시판: 일정 빼고 모두 쓰기 등급(기본값 = C)
      blocks: Object.fromEntries(
        BLOCKS.map((x) => [x.type, b ? (b.blocks[x.type] ?? null) : x.type === "schedule" ? null : create]),
      ),
      notice: !!b?.options?.notice,
      title_optional: !!b?.options?.title_optional,
      official: !!b?.options?.official,
      sort_order: b?.sort_order ?? 100,
      status: b?.status ?? "active",
    };
    initial = JSON.stringify(form);
  }
  function close() {
    editing = null;
    form = null;
  }

  /** 편집 중에도 다른 게시판 설정으로 바로 넘어간다. 고친 내용이 있으면 버릴지 먼저 묻는다. */
  async function switchTo(b: BoardConfig) {
    if (editing !== b.key) {
      if (
        form &&
        JSON.stringify(form) !== initial &&
        !(await confirmDialog({
          title: "저장하지 않은 변경",
          message: `${current?.label ?? "새 게시판"}에서 고친 내용이 저장되지 않았습니다. 버리고 '${b.label}' 설정으로 넘어갈까요?`,
          confirmText: "버리고 넘어가기",
          tone: "danger",
        }))
      )
        return;
      open(b);
    }
    await tick();
    formEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 쓰기 등급을 올리면 그보다 낮은 블록 등급도 같이 올린다 */
  function onCreateLevel() {
    if (!form) return;
    for (const k of Object.keys(form.blocks)) {
      const v = form.blocks[k];
      if (v !== null && v < form.create_level) form.blocks[k] = form.create_level;
    }
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!form) return;
    formError = null;
    saving = true;
    const body: any = {
      label: form.label,
      description: form.description,
      read_level: form.read_level,
      read_scope: form.read_scope,
      create_level: form.create_level,
      edit_own: form.edit_own,
      edit_level: form.edit_level,
      delete_own: form.delete_own,
      delete_level: form.delete_level,
      comment_level: form.comment_level,
      options: { notice: form.notice, title_optional: form.title_optional, official: form.official },
      sort_order: form.sort_order,
      status: form.status,
    };
    if (!isFeed) body.blocks = form.blocks;
    if (editing === "") body.key = form.key;
    try {
      const res = await fetch(editing ? `/api/admin/boards/${editing}` : "/api/admin/boards", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `저장 실패 (${res.status})`);
      notice = `${r.board.label} 저장됨`;
      close();
      await load();
    } catch (err) {
      formError = err instanceof Error ? err.message : "저장 실패";
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!current) return;
    if (
      !(await confirmDialog({
        title: "게시판 삭제",
        message: `'${current.label}' 게시판을 지울까요? 되돌릴 수 없습니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    const res = await fetch(`/api/admin/boards/${current.key}`, { method: "DELETE", credentials: "same-origin" });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      formError = r.error || "삭제 실패";
      return;
    }
    notice = `${current.label} 삭제됨`;
    close();
    await load();
  }

  const scheduleOn = $derived(!!form && form.blocks.schedule !== null && form.blocks.schedule !== undefined);
  const isPublic = $derived(!!form && form.read_level === GUEST && form.read_scope === "all");
</script>

<div class="head">
  <p class="dim">게시판 {boards.length}개 · 권한은 회원 등급 기준, 관리자는 언제나 모든 권한</p>
  {#if editing === null}
    <button type="button" class="btn btn-primary sm" onclick={() => open(null)}>＋ 새 게시판</button>
  {/if}
</div>
{#if notice}<p class="notice" role="status">{notice}</p>{/if}

<div class="split" class:open={!!form}>
<div class="side">
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else}
  <ul class="list">
    {#each boards as b (b.key)}
      <li class:hidden={b.status === "hidden"} class:active={editing === b.key}>
        <div class="who">
          <strong>{b.label}</strong>
          {#if b.builtin}<span class="tag">기본</span>{/if}
          {#if b.status === "hidden"}<span class="tag">숨김</span>{/if}
          <span class="sub">{b.key} · {VIEW_LABEL[b.view]} · {MENU_LABEL[b.menu]}</span>
        </div>
        <span class="meta">읽기 {lvName(b.read_level)}{b.read_scope === "own" ? " · 본인 글만" : ""}</span>
        <span class="meta">쓰기 {lvName(b.create_level)}</span>
        <span class="meta">글 {b.post_count ?? 0}</span>
        <button type="button" class="btn btn-ghost sm" aria-current={editing === b.key ? "true" : undefined} onclick={() => switchTo(b)}
          >{editing === b.key ? "편집 중" : "설정"}</button
        >
      </li>
    {/each}
  </ul>
{/if}
</div>

{#if form}
  <form class="panel" onsubmit={save} bind:this={formEl}>
    <h3>{editing ? `${current?.label ?? ""} 설정` : "새 게시판"}</h3>
    <div class="grid2">
      <label><span>이름 *</span><input bind:value={form.label} maxlength="50" required /></label>
      {#if editing === ""}
        <label
          ><span>주소 이름 * <small>/community/주소이름/ — 만든 뒤 못 바꿉니다</small></span><input
            bind:value={form.key}
            maxlength="30"
            pattern="[a-z][a-z0-9\-]+"
            placeholder="예: notice2"
            required
          /></label
        >
      {:else}
        <div class="field">
          <span>주소</span>
          <code>/community/{editing}/</code>
        </div>
      {/if}
    </div>
    <label><span>설명</span><input bind:value={form.description} maxlength="200" /></label>
    <p class="dim small">
      형식: {VIEW_LABEL[current?.view ?? "list"]} · 게시글 · {MENU_LABEL[current?.menu ?? "community"]}
      {#if editing === ""}<br />지금은 목록형 게시판만 만들 수 있습니다(SNS형·문서형은 다음 단계).{/if}
    </p>

    <h4>권한</h4>
    <div class="perm">
      <span class="pl">읽기</span>
      <div class="pc">
        <select bind:value={form.read_level}>
          {#each [GUEST, ...LEVELS] as l}<option value={l}>{lvName(l)}</option>{/each}
        </select>
        <select bind:value={form.read_scope}>
          <option value="all">모든 글</option>
          <option value="own">본인 글만(관리자는 전부)</option>
        </select>
      </div>
      <span class="pl">쓰기</span>
      <div class="pc">
        <select bind:value={form.create_level} onchange={onCreateLevel}>
          {#each LEVELS as l}<option value={l}>{lvName(l)} 이상</option>{/each}
        </select>
      </div>
      <span class="pl">수정</span>
      <div class="pc">
        <label class="chk"><input type="checkbox" bind:checked={form.edit_own} /> 본인 글</label>
        <span class="dim">남의 글</span>
        <select bind:value={form.edit_level}>
          {#each LEVELS as l}<option value={l}>{lvName(l)} 이상</option>{/each}
        </select>
      </div>
      <span class="pl">삭제</span>
      <div class="pc">
        <label class="chk"><input type="checkbox" bind:checked={form.delete_own} /> 본인 글</label>
        <span class="dim">남의 글</span>
        <select bind:value={form.delete_level}>
          {#each LEVELS as l}<option value={l}>{lvName(l)} 이상</option>{/each}
        </select>
      </div>
      <span class="pl">댓글</span>
      <div class="pc">
        <select bind:value={form.comment_level}>
          <option value={null}>사용 안 함</option>
          {#each LEVELS as l}<option value={l}>{lvName(l)} 이상</option>{/each}
        </select>
      </div>
    </div>

    <h4>블록 <small>기본값 = 쓰기 등급 · 쓰기 등급보다 낮게 둘 수 없음</small></h4>
    {#if isFeed}
      <p class="dim small">SNS 피드 게시판은 블록을 쓰지 않습니다(글·사진·유튜브 입력창).</p>
    {:else}
      <div class="blocks">
        {#each BLOCKS as x (x.type)}
          <label class="blk"
            ><span>{x.label}</span>
            <select bind:value={form.blocks[x.type]}>
              <option value={null}>사용 안 함</option>
              {#each levelsFrom(form.create_level) as l}<option value={l}>{lvName(l)} 이상</option>{/each}
            </select></label
          >
        {/each}
      </div>
      {#if scheduleOn}
        <p class="warn small">
          일정 블록을 켜면 이 게시판 글의 일정이 달력에 나옵니다.
          {isPublic ? "" : "읽기가 제한된 게시판이어도 일정 이름과 날짜는 달력에 보입니다."}
        </p>
      {/if}
    {/if}

    <h4>기타</h4>
    <div class="opts">
      <label class="chk"><input type="checkbox" bind:checked={form.notice} /> 공지 고정 쓰기(목록 맨 위)</label>
      <label class="chk"><input type="checkbox" bind:checked={form.title_optional} /> 제목 생략 가능</label>
      <label class="chk"
        ><input type="checkbox" bind:checked={form.official} /> 공식 콘텐츠 — 글쓴이를 JSBeob로 표시(실제 등록자는 남의 글 수정 권한자에게만)</label
      >
      <label class="inline"
        >순서 <input type="number" step="1" bind:value={form.sort_order} class="num" /></label
      >
      <label class="inline"
        >상태
        <select bind:value={form.status}>
          <option value="active">공개</option>
          <option value="hidden">숨김(관리자만)</option>
        </select></label
      >
    </div>

    {#if formError}<p class="err">{formError}</p>{/if}
    <div class="buttons">
      {#if current && !current.builtin}
        <button
          type="button"
          class="btn btn-ghost danger"
          disabled={(current.post_count ?? 0) > 0}
          title={(current.post_count ?? 0) > 0 ? "글이 있는 게시판은 숨김만 할 수 있습니다" : ""}
          onclick={remove}>삭제</button
        >
      {/if}
      <span class="sp"></span>
      <button type="button" class="btn btn-ghost" onclick={close}>취소</button>
      <button class="btn btn-primary" disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
    </div>
  </form>
{/if}
</div>

<style>
  .split.open {
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .split.open .side {
    position: sticky;
    top: 12px;
  }
  .split.open .panel {
    margin-bottom: 0;
  }
  .split.open .list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .split.open .list li .meta {
    display: none;
  }
  @media (max-width: 900px) {
    .split.open {
      grid-template-columns: 1fr;
    }
    .split.open .side {
      position: static;
      order: 2;
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .dim {
    color: var(--color-muted);
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .notice {
    margin: 0 0 10px;
    font-size: 0.88rem;
    color: var(--color-secondary);
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 8px 12px;
    border-radius: var(--radius-md);
  }
  .warn {
    margin: 8px 0 0;
    color: #8a5a00;
  }
  .panel {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;
    padding: 16px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .panel h3 {
    margin: 0;
    font-size: 1.1rem;
  }
  .panel h4 {
    margin: 8px 0 0;
    font-size: 0.95rem;
  }
  .panel h4 small {
    font-weight: 400;
    color: var(--color-muted);
  }
  .panel label > span,
  .field > span {
    display: block;
    font-weight: 600;
    font-size: 0.88rem;
    margin-bottom: 4px;
  }
  .panel label > span small {
    font-weight: 400;
    color: var(--color-muted);
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 10px 16px;
  }
  input:not([type="checkbox"]),
  select {
    padding: 7px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 0.92rem;
  }
  .panel > label input,
  .grid2 input {
    width: 100%;
    box-sizing: border-box;
  }
  .num {
    width: 80px;
  }
  .perm {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 8px 12px;
    align-items: center;
  }
  .pl {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .pc {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
  }
  .blocks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px 14px;
  }
  .blk {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .blk > span {
    margin: 0 !important;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    align-items: center;
  }
  .buttons {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .sp {
    flex: 1;
  }
  .danger {
    color: var(--color-primary);
  }
  .list .btn {
    white-space: nowrap;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .list li {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) 60px 88px;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-rule);
  }
  .list li:first-child {
    border-top: 0;
  }
  .list li.hidden {
    opacity: 0.6;
  }
  .list li > .btn {
    justify-self: end;
  }
  .list li.active {
    background: var(--color-surface-2);
    box-shadow: inset 3px 0 0 var(--color-primary);
  }
  .who strong {
    font-size: 0.98rem;
  }
  .sub {
    display: block;
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .tag {
    margin-left: 4px;
    padding: 0 6px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font-size: 0.72rem;
    color: var(--color-muted);
  }
  .meta {
    font-size: 0.85rem;
    color: var(--color-muted);
  }
  @media (max-width: 720px) {
    .list li {
      grid-template-columns: 1fr auto;
    }
    .list li .meta {
      display: none;
    }
  }
</style>
