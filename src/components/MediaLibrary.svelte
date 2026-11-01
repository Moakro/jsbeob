<script lang="ts">
  // 사진 창고 — 사진 올리기(끌어다 놓기)·찾기·정보 편집(mode="manage"), 본문에 넣을 사진 고르기(mode="pick").
  // 복원(2026-11-01): 배포본 _astro/BlockEditor.*.js 에 함께 묶인 컴포넌트(export M). 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi, resizeImage, fmtKst } from "../lib/blocks";
  import { confirmDialog } from "../lib/confirm";

  let {
    mode = "manage",
    multiple = false,
    onpick,
    oncancel,
  }: {
    mode?: "manage" | "pick";
    multiple?: boolean;
    onpick?: (items: any[]) => void;
    oncancel?: () => void;
  } = $props();

  const PAGE = 60;
  let media = $state<any[]>([]);
  let hasMore = $state(false);
  let loading = $state(false);
  let q = $state("");
  let error = $state<string | null>(null);
  /** 올리는 중인 파일 */
  let uploads = $state<{ name: string; state: "wait" | "up" | "done" | "fail"; msg?: string }[]>([]);
  let dragOver = $state(false);
  /** pick 모드 선택 */
  let picked = $state<any[]>([]);
  /** manage 모드 정보 패널 */
  let sel = $state<any>(null);
  let form = $state({ alt: "", caption: "", credit: "", taken_at: "", source_url: "" });
  let saving = $state(false);
  let msg = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load(reset = true) {
    loading = true;
    error = null;
    try {
      const r = await adminApi.listMedia({
        q: q.trim() || undefined,
        offset: reset ? 0 : media.length,
        limit: PAGE,
      });
      media = reset ? r.media : [...media, ...r.media];
      hasMore = r.has_more;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }

  onMount(() => load());

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  }

  async function upload(list: FileList | File[]) {
    const files = [...list].filter(
      (f) => /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name),
    );
    if (!files.length) {
      error = "사진 파일(jpg·png·webp)만 올릴 수 있습니다.";
      return;
    }
    const base = uploads.length;
    uploads = [...uploads, ...files.map((f) => ({ name: f.name, state: "wait" as const }))];
    const added: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const at = base + i;
      uploads[at].state = "up";
      try {
        const { blob, width, height } = await resizeImage(files[i]);
        const r = await adminApi.uploadMedia(blob, width, height);
        uploads[at].state = "done";
        uploads[at].msg = r.deduped ? "이미 있는 사진" : undefined;
        if (!added.some((m) => m.id === r.media.id)) added.push(r.media);
      } catch (e) {
        uploads[at].state = "fail";
        uploads[at].msg = e instanceof Error ? e.message : "실패";
      }
    }
    if (added.length) {
      const ids = new Set(added.map((m) => m.id));
      media = [...added, ...media.filter((m) => !ids.has(m.id))];
      // 고르기 모드면 방금 올린 사진을 바로 고른다
      if (mode === "pick")
        for (const m of added)
          if (!picked.some((p) => p.id === m.id)) picked = multiple ? [...picked, m] : [m];
    }
    // 끝난 줄은 잠시 뒤 지운다
    setTimeout(() => {
      uploads = uploads.filter((u) => u.state === "fail" || u.state === "up" || u.state === "wait");
    }, 4e3);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
  }

  function clickCell(m: any) {
    if (mode === "pick") {
      const on = picked.some((p) => p.id === m.id);
      if (multiple) picked = on ? picked.filter((p) => p.id !== m.id) : [...picked, m];
      else picked = on ? [] : [m];
      return;
    }
    select(m);
  }

  function select(m: any) {
    sel = m;
    msg = null;
    form = {
      alt: m.alt ?? "",
      caption: m.caption ?? "",
      credit: m.credit ?? "",
      taken_at: m.taken_at ?? "",
      source_url: m.source_url ?? "",
    };
  }

  async function save() {
    if (!sel) return;
    saving = true;
    msg = null;
    try {
      const r = await adminApi.updateMedia(sel.id, { ...form });
      media = media.map((m) => (m.id === r.media.id ? { ...m, ...r.media } : m));
      sel = { ...sel, ...r.media };
      msg = "저장했습니다.";
    } catch (e) {
      msg = e instanceof Error ? e.message : "저장 실패";
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (
      !sel ||
      !(await confirmDialog({
        title: "사진 삭제",
        message: "이 사진을 창고에서 지울까요?",
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await adminApi.deleteMedia(sel.id);
      media = media.filter((m) => m.id !== sel.id);
      sel = null;
    } catch (e: any) {
      const usage = e?.data?.usage;
      msg = usage?.length
        ? `사용 중이라 지울 수 없습니다: ${usage.map((u: any) => u.title).join(", ")}`
        : e instanceof Error
          ? e.message
          : "삭제 실패";
    }
  }

  const kb = (n?: number) => (n ? `${Math.round(n / 1024)}KB` : "");
</script>

<div class="lib" class:pick={mode === "pick"}>
  <div
    class="drop"
    class:on={dragOver}
    role="button"
    tabindex="0"
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
    onclick={() => fileInput?.click()}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && fileInput?.click()}
  >
    <strong>사진 올리기</strong>
    <span
      >여기로 끌어다 놓거나 눌러서 고르세요. 여러 장 가능. 긴 변 2400px로 줄이고 위치 정보는 지웁니다.</span
    >
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        const el = e.currentTarget;
        if (el.files?.length) upload(el.files);
        el.value = "";
      }}
    />
  </div>
  {#if uploads.length}
    <ul class="uploads">
      {#each uploads as u}
        <li class={u.state}>
          {u.name} — {u.state === "wait"
            ? "대기"
            : u.state === "up"
              ? "올리는 중…"
              : u.state === "done"
                ? "완료"
                : "실패"}{u.msg ? ` (${u.msg})` : ""}
        </li>
      {/each}
    </ul>
  {/if}
  <div class="bar">
    <input
      class="search"
      type="search"
      placeholder="설명·촬영자·시기로 찾기"
      bind:value={q}
      oninput={onSearch}
    />
    {#if mode === "pick"}
      <span class="picked">{picked.length}장 선택</span>
      <button type="button" class="btn btn-ghost" onclick={() => oncancel?.()}>취소</button>
      <button type="button" class="btn btn-primary" disabled={!picked.length} onclick={() => onpick?.(picked)}
        >선택 완료</button
      >
    {/if}
  </div>
  {#if error}<p class="err">{error}</p>{/if}
  <div class="body">
    <div class="grid">
      {#each media as m (m.id)}
        {@const on = picked.some((p) => p.id === m.id) || sel?.id === m.id}
        <button type="button" class="cell" class:on title={m.caption ?? ""} onclick={() => clickCell(m)}>
          <img src={m.url} alt={m.alt ?? ""} loading="lazy" />
          {#if m.caption}<span class="cap">{m.caption}</span>{/if}
          {#if mode === "manage" && m.usage}<span class="use">{m.usage}곳 사용</span>{/if}
        </button>
      {:else}
        {#if !loading}<p class="empty">{q ? "찾는 사진이 없습니다." : "아직 올린 사진이 없습니다."}</p>{/if}
      {/each}
    </div>
    {#if hasMore}
      <button type="button" class="btn btn-ghost more" disabled={loading} onclick={() => load(false)}
        >더 보기</button
      >
    {/if}
    {#if loading}<p class="state">불러오는 중…</p>{/if}
  </div>
  {#if mode === "manage" && sel}
    <aside class="panel">
      <div class="panel-head">
        <strong>사진 정보</strong>
        <button type="button" class="x" aria-label="닫기" onclick={() => (sel = null)}>×</button>
      </div>
      <a href={sel.url} target="_blank" rel="noopener"><img src={sel.url} alt="" /></a>
      <p class="dim">
        {sel.width}×{sel.height} · {kb(sel.size_bytes)} · {fmtKst(sel.created_at).slice(0, 10)}
      </p>
      <label>설명<input bind:value={form.caption} maxlength="500" /></label>
      <label>대체 텍스트(화면 낭독용)<input bind:value={form.alt} maxlength="300" /></label>
      <label>촬영자·출처<input bind:value={form.credit} maxlength="200" /></label>
      <label
        >촬영 시기<input bind:value={form.taken_at} maxlength="100" placeholder="예: 1985, 1990년대" /></label
      >
      <label
        >원본 주소<input
          bind:value={form.source_url}
          maxlength="1000"
          placeholder="구 사이트 등에서 옮겨온 경우"
        /></label
      >
      <div class="row">
        <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>저장</button>
        <button type="button" class="btn btn-ghost danger" onclick={remove}>삭제</button>
      </div>
      {#if msg}<p class="msg">{msg}</p>{/if}
    </aside>
  {/if}
</div>

<style>
  .lib {
    display: grid;
    gap: 12px;
  }
  .lib:has(.panel) {
    grid-template-columns: 1fr 300px;
  }
  .lib:has(.panel) > :not(.panel) {
    grid-column: 1;
  }
  .panel {
    grid-column: 2;
    grid-row: 1 / span 6;
    align-self: start;
    position: sticky;
    top: 80px;
    display: grid;
    gap: 8px;
    padding: 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .panel img {
    width: 100%;
    border-radius: var(--radius-sm);
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .x {
    border: 0;
    background: none;
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
  }
  label {
    display: grid;
    gap: 3px;
    font-size: 0.82rem;
    color: var(--color-muted);
  }
  input:not([type="checkbox"]):not([type="file"]) {
    padding: 7px 9px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    font: inherit;
    color: var(--color-fg);
  }
  .drop {
    display: grid;
    gap: 2px;
    padding: 16px;
    border: 2px dashed var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    text-align: center;
    cursor: pointer;
  }
  .drop.on {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .drop span {
    font-size: 0.82rem;
    color: var(--color-muted);
  }
  .uploads {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.82rem;
  }
  .uploads .fail {
    color: var(--color-primary);
  }
  .uploads .done {
    color: var(--color-secondary);
  }
  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
    min-width: 180px;
  }
  .picked {
    font-size: 0.88rem;
    color: var(--color-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .cell {
    position: relative;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    cursor: pointer;
    overflow: hidden;
    aspect-ratio: 1;
  }
  .cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cell.on {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-bg);
  }
  .cap,
  .use {
    position: absolute;
    left: 0;
    right: 0;
    padding: 2px 5px;
    font-size: 0.7rem;
    color: #fff;
    background: #140e0c99;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }
  .cap {
    bottom: 0;
  }
  .use {
    top: 0;
    right: auto;
    border-bottom-right-radius: 4px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .danger {
    color: var(--color-primary);
  }
  .more {
    margin-top: 10px;
  }
  .err,
  .msg {
    font-size: 0.85rem;
    color: var(--color-primary);
    margin: 0;
  }
  .msg {
    color: var(--color-muted);
  }
  .dim,
  .state,
  .empty {
    font-size: 0.8rem;
    color: var(--color-muted);
    margin: 0;
  }
  @media (max-width: 760px) {
    .lib:has(.panel) {
      grid-template-columns: 1fr;
    }
    .panel {
      grid-column: 1;
      grid-row: auto;
      position: static;
    }
  }
</style>
