<script lang="ts">
  // 올림 한 건 (/editor/inbox/<id>/) — 왼쪽 원본(편집진만), 오른쪽 편집기로 '글로 옮기기' (2026-11-27 올림함 0단계)
  // 1단계(AI 초안): 감시 서비스가 만든 초안(draft_blocks·제목)이 채워진 채 편집기가 열린다. 처리 중이면 몇 초마다 다시 묻고,
  // 초안이 도착하면 '초안으로 채우기'로 편집기를 다시 연다(이미 쓴 내용을 몰래 덮지 않게). 확인 필요·뺀 내용은 편집기 위 안내 상자에.
  import { onMount } from "svelte";
  import { api, postHref, type BoardConfig } from "../../lib/api";
  import { confirmDialog } from "../../lib/confirm";
  import {
    EXCLUDED_LABEL,
    HINT_LABEL,
    INBOX_PATH,
    INTAKE_CHANGED,
    INTAKE_LEVEL,
    KIND_LABEL,
    checkCount,
    fmtSize,
    fmtWhen,
    intakeApi,
    intakeStartBlocks,
    isProcessing,
    statusLabel,
    type Intake,
  } from "../../lib/intake";
  import PostEditor from "../board/PostEditor.svelte";

  let { id }: { id: string } = $props();

  let allowed = $state<boolean | null>(null);
  let it = $state<Intake | null>(null);
  let error = $state<string | null>(null);
  let boards = $state<BoardConfig[]>([]);
  let board = $state("news");
  let writing = $state(true);
  let sel = $state(0);
  let busy = $state(false);
  /** 편집기에 넣은 올림 상태(초안이 나중에 오면 다시 넣을 수 있게) */
  let shown = $state<Intake | null>(null);
  let editorKey = $state(0);
  let retrying = $state(false);

  onMount(() => {
    (async () => {
      const me = (await api.me().catch(() => ({ user: null }))).user;
      allowed = !!me && (me.level ?? 0) >= INTAKE_LEVEL;
      if (!allowed) return;
      try {
        it = (await intakeApi.get(id)).intake;
        shown = it;
      } catch (e) {
        error = e instanceof Error ? e.message : "불러오기 실패";
        return;
      }
      try {
        // 이 사람이 쓸 수 있는 블록 게시판(피드형 제외) — 소식이 기본
        boards = (await api.boards()).boards.filter(
          (b) => b.storage === "post" && b.view !== "feed" && b.status === "active" && !b.options?.plain_editor && (me!.level ?? 0) >= b.create_level,
        );
        if (!boards.some((b) => b.key === "news") && boards[0]) board = boards[0].key;
      } catch {}
    })();
  });

  // AI 처리 중이면 5초마다 다시 묻는다(화면이 보일 때만)
  $effect(() => {
    if (!it || !isProcessing(it)) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = (await intakeApi.get(id)).intake;
        if (next.status !== it?.status || next.updated_at !== it?.updated_at) {
          it = next;
          window.dispatchEvent(new CustomEvent(INTAKE_CHANGED));
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  });
  /** 편집기를 연 뒤에 초안이 도착함 */
  const draftArrived = $derived(!!it && !!shown && it.status === "ready" && it.updated_at !== shown.updated_at && it.draft_blocks.length > 0);
  function useDraft() {
    if (!it) return;
    shown = it;
    editorKey++;
  }
  async function retry() {
    if (!it || retrying) return;
    retrying = true;
    error = null;
    try {
      it = (await intakeApi.extract(it.id)).intake;
      window.dispatchEvent(new CustomEvent(INTAKE_CHANGED));
    } catch (e) {
      error = e instanceof Error ? e.message : "다시 시도 실패";
    } finally {
      retrying = false;
    }
  }
  const checks = $derived((it?.warnings ?? []).filter((w) => w.level !== "info"));
  const infos = $derived((it?.warnings ?? []).filter((w) => w.level === "info"));

  const file = $derived(it?.files[sel] ?? null);
  const kind = (ct: string) =>
    /^image\/(jpeg|png|webp)$/.test(ct) ? "img" : ct === "application/pdf" ? "pdf" : ct.startsWith("image/") ? "heic" : "doc";
  const open = $derived(!!it && !["published", "discarded"].includes(it.status));

  async function discard() {
    if (!it || busy) return;
    const ok = await confirmDialog({
      title: "올림 버리기",
      message: "이 올림을 버릴까요? 올린 원본 파일도 함께 지워지며 되돌릴 수 없습니다.",
      confirmText: "버리기",
      cancelText: "취소",
      tone: "danger",
    });
    if (!ok) return;
    busy = true;
    try {
      await intakeApi.discard(it.id);
      window.dispatchEvent(new CustomEvent(INTAKE_CHANGED));
      location.href = INBOX_PATH;
    } catch (e) {
      error = e instanceof Error ? e.message : "버리기 실패";
      busy = false;
    }
  }
</script>

{#if allowed === null || (allowed && !it && !error)}
  <p class="state">불러오는 중…</p>
{:else if !allowed}
  <p class="state">편집진만 볼 수 있는 화면입니다.</p>
{:else if !it}
  <p class="state">{error} <a href={INBOX_PATH}>올림함으로</a></p>
{:else}
  <div class="ii">
    <nav class="crumb"><a href={INBOX_PATH}>← 올림함</a></nav>
    <div class="cols" class:single={!open || !writing}>
      <section class="src" aria-label="올린 원본">
        <header>
          <span class={`st st-${it.status}`} class:busy={isProcessing(it)}>{statusLabel(it)}</span>
          {#if it.kind}<span class="hint">{KIND_LABEL[it.kind] ?? it.kind}{it.doc_type ? ` · ${it.doc_type}` : ""}</span>
          {:else if it.hint}<span class="hint">{HINT_LABEL[it.hint] ?? it.hint}</span>{/if}
          <span class="who">{it.user.name ?? "알 수 없음"} · {fmtWhen(it.created_at)}</span>
        </header>

        {#if it.files.length}
          {#if it.files.length > 1}
            <div class="tabs" role="tablist" aria-label="원본 파일">
              {#each it.files as f, i}
                <button type="button" role="tab" aria-selected={sel === i} class:on={sel === i} onclick={() => (sel = i)}>{i + 1}</button>
              {/each}
            </div>
          {/if}
          {#if file}
            <div class="view">
              {#if !file.file_url}
                <p class="gone">원본이 지워졌습니다{it.purged_at ? ` (${fmtWhen(it.purged_at)})` : ""}.</p>
              {:else if kind(file.content_type) === "img"}
                <a href={file.file_url} target="_blank" rel="noopener"><img src={file.file_url} alt={file.name} /></a>
              {:else if kind(file.content_type) === "pdf"}
                <iframe src={file.file_url} title={file.name}></iframe>
              {:else}
                <p class="gone">
                  {kind(file.content_type) === "heic" ? "HEIC 사진은 이 브라우저에서 미리 볼 수 없습니다." : "이 문서는 미리 볼 수 없습니다(0단계는 보관만)."}
                </p>
              {/if}
            </div>
            <p class="fmeta">
              {file.name} · {fmtSize(file.size)}
              {#if file.file_url}· <a href={`${file.file_url}?download=1`}>내려받기</a>{/if}
            </p>
          {/if}
        {/if}

        {#if it.note}
          <div class="note">
            <h3>메모</h3>
            <p>{it.note}</p>
          </div>
        {/if}
        {#if it.url}
          <div class="note">
            <h3>인터넷 주소</h3>
            <p><a href={it.url} target="_blank" rel="noopener noreferrer nofollow">{it.url}</a></p>
          </div>
        {/if}

        {#if it.status === "published"}
          <p class="done">
            {it.handled_by?.name ?? ""} 님이 글로 옮겼습니다:
            {#if it.post}<a href={postHref(it.post.board, it.post.id)}>{it.post.title}</a>{:else}(글이 지워짐){/if}
          </p>
        {:else if it.status === "discarded"}
          <p class="done">{it.handled_by?.name ?? ""} 님이 버렸습니다.</p>
        {/if}

        {#if open && !it.ai_readable && !it.draft_blocks.length}
          <p class="aibox muted">AI 가 아직 못 읽는 형식입니다(HEIC·한글·워드). 직접 작성해 주세요 — 사진은 JPG 로, 한글 문서는 PDF 로 저장해 올리면 AI 초안이 만들어집니다.</p>
        {/if}

        <footer>
          {#if open && it.ai_readable && (it.status === "ready" || it.status === "failed")}
            <button type="button" class="btn btn-ghost" disabled={retrying} onclick={retry}>{it.status === "failed" ? "다시 시도" : "AI 다시 읽기"}</button>
          {/if}
          {#if open && !writing}
            <button type="button" class="btn btn-primary" onclick={() => (writing = true)}>글로 옮기기</button>
          {/if}
          {#if it.status !== "discarded"}
            <button type="button" class="btn btn-ghost danger" disabled={busy} onclick={discard}>버리기</button>
          {/if}
          {#if it.purge_after && !it.purged_at}<small>원본 자동 삭제: {it.purge_after.slice(0, 10)}</small>{/if}
        </footer>
      </section>

      {#if open && writing}
        <section class="draft" aria-label="글로 옮기기">
          {#if isProcessing(it)}
            <div class="aibox wait" role="status">
              <span class="dot"></span>
              {it.status === "extracting" ? "AI 가 원본을 읽고 초안을 만드는 중입니다" : "AI 처리를 기다리는 중입니다"} — 보통 1~2분. 끝나면 여기에 알려 드립니다.
            </div>
          {:else if it.status === "failed"}
            <div class="aibox fail" role="alert">
              <strong>AI 초안을 만들지 못했습니다</strong>
              <p>{it.error ?? "알 수 없는 오류"}</p>
              <div class="row">
                {#if it.ai_readable}<button type="button" class="btn btn-primary" disabled={retrying} onclick={retry}>{retrying ? "요청 중…" : "다시 시도"}</button>{/if}
                <small>아래 편집기에서 직접 작성할 수도 있습니다.</small>
              </div>
            </div>
          {/if}
          {#if draftArrived}
            <div class="aibox ready" role="status">
              AI 초안이 준비됐습니다.
              <button type="button" class="btn btn-primary" onclick={useDraft}>초안으로 채우기</button>
              <small>편집기에 쓴 내용은 초안으로 바뀝니다.</small>
            </div>
          {/if}
          {#if shown?.status === "ready" && !draftArrived && (checks.length || infos.length || it.excluded.length)}
            <div class="aibox notes">
              {#if checks.length}
                <h3>확인 필요 {checks.length}</h3>
                <ul class="checks">
                  {#each checks as w}<li>{w.text}</li>{/each}
                </ul>
              {/if}
              {#if infos.length}
                <ul class="infos">
                  {#each infos as w}<li>{w.text}</li>{/each}
                </ul>
              {/if}
              {#if it.excluded.length}
                <details>
                  <summary>글에서 뺀 내용 {it.excluded.length} <small>(편집진만 봄 — 필요하면 본문에 직접 넣으세요)</small></summary>
                  <ul class="excl">
                    {#each it.excluded as x}
                      <li><span class="tag">{EXCLUDED_LABEL[x.kind] ?? x.kind}</span> {x.text}{#if x.reason}<small> — {x.reason}</small>{/if}</li>
                    {/each}
                  </ul>
                </details>
              {/if}
              <p class="by">AI 초안({it.model ?? "AI"})입니다. 원본과 대조해 고친 뒤 게시해 주세요.</p>
            </div>
          {/if}
          {#if boards.length > 1}
            <label class="bsel">
              <span>게시판</span>
              <select bind:value={board}>
                {#each boards as b}<option value={b.key}>{b.label}</option>{/each}
              </select>
            </label>
          {/if}
          {#key `${board}:${editorKey}`}
            <PostEditor
              {board}
              intakeId={it.id}
              startBlocks={intakeStartBlocks(shown ?? it)}
              startTitle={(shown ?? it).title ?? ""}
              backHref={`${INBOX_PATH}${it.id}/`}
            />
          {/key}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .state {
    color: var(--color-muted);
    text-align: center;
    padding: 40px 0;
  }
  .ii {
    max-width: 1280px;
    margin-inline: auto;
  }
  .crumb {
    margin-bottom: 12px;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 28px;
    align-items: start;
  }
  .cols.single {
    grid-template-columns: minmax(0, 760px);
    justify-content: center;
  }
  .src {
    position: sticky;
    top: 80px;
    display: grid;
    gap: 12px;
  }
  .cols.single .src {
    position: static;
  }
  .src header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .who {
    color: var(--color-muted);
    font-size: 0.88rem;
  }
  .hint {
    color: var(--color-secondary);
    font-weight: 600;
    font-size: 0.88rem;
  }
  .st {
    font-size: 0.8rem;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .st-uploaded {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .st.busy {
    background: var(--color-surface-2);
    color: var(--color-gold);
  }
  .st-ready {
    background: var(--color-secondary);
    color: #fff;
  }
  .st-failed {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .aibox {
    margin: 0 0 14px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--color-rule);
    background: var(--color-surface);
    font-size: 0.92rem;
  }
  .aibox.muted {
    color: var(--color-muted);
    margin: 0;
  }
  .aibox.wait {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-fg);
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-gold);
    animation: blink 1.2s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .aibox.fail {
    border-color: var(--color-primary-soft);
    background: var(--color-primary-bg);
  }
  .aibox.fail strong {
    color: var(--color-primary);
  }
  .aibox.fail p {
    margin: 6px 0 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .aibox .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .aibox small {
    color: var(--color-muted);
  }
  .aibox.ready {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    border-color: var(--color-secondary);
    background: var(--color-secondary-bg);
    font-weight: 600;
  }
  .aibox.notes {
    border: 2px solid var(--color-gold-soft);
    background: #fdf6e3;
  }
  .aibox.notes h3 {
    margin: 0 0 6px;
    font-size: 0.95rem;
    color: #8a5a00;
  }
  .aibox ul {
    margin: 0 0 8px;
    padding-left: 20px;
  }
  .checks li {
    font-weight: 600;
    color: #6b4400;
    margin: 3px 0;
  }
  .infos li {
    color: var(--color-muted);
    margin: 2px 0;
  }
  .aibox details summary {
    cursor: pointer;
    font-weight: 600;
    margin: 4px 0;
  }
  .excl li {
    margin: 3px 0;
    word-break: break-word;
  }
  .tag {
    display: inline-block;
    font-size: 0.75rem;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .aibox .by {
    margin: 6px 0 0;
    font-size: 0.82rem;
    color: var(--color-muted);
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tabs button {
    min-width: 34px;
    height: 34px;
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    background: var(--color-surface);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.on {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
  .view {
    border: 1px solid var(--color-rule);
    border-radius: 10px;
    background: var(--color-surface-2);
    overflow: hidden;
    display: grid;
    place-items: center;
    min-height: 200px;
  }
  .view img {
    display: block;
    max-width: 100%;
    max-height: 72vh;
    object-fit: contain;
  }
  .view iframe {
    width: 100%;
    height: 72vh;
    border: 0;
    background: #fff;
  }
  .gone {
    color: var(--color-muted);
    padding: 24px;
    text-align: center;
  }
  .fmeta {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.85rem;
    word-break: break-all;
  }
  .note {
    padding: 12px 14px;
    border: 1px solid var(--color-rule);
    border-radius: 10px;
    background: var(--color-surface);
  }
  .note h3 {
    margin: 0 0 6px;
    font-size: 0.85rem;
    color: var(--color-muted);
  }
  .note p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .done {
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--color-secondary-bg);
    margin: 0;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  footer small {
    margin-left: auto;
    color: var(--color-muted);
  }
  .danger {
    color: var(--color-primary);
  }
  .bsel {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .bsel select {
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font: inherit;
  }
  .draft :global(.editor h1) {
    font-size: 1.3rem;
  }
  @media (max-width: 960px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
    .src {
      position: static;
    }
    .view img,
    .view iframe {
      max-height: 60vh;
    }
    .view iframe {
      height: 60vh;
    }
  }
</style>
