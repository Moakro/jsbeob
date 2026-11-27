<script lang="ts">
  // 올림 한 건 (/editor/inbox/<id>/) — 왼쪽 원본(편집진만), 오른쪽 편집기로 '글로 옮기기' (2026-11-27 올림함 0단계)
  // 0단계는 메모·주소를 글 블록으로 미리 채운 편집기. 1단계에서 AI 초안(draft_blocks)이 이 자리에 들어온다.
  import { onMount } from "svelte";
  import { api, postHref, type BoardConfig } from "../../lib/api";
  import { confirmDialog } from "../../lib/confirm";
  import {
    HINT_LABEL,
    INBOX_PATH,
    INTAKE_CHANGED,
    INTAKE_LEVEL,
    STATUS_LABEL,
    fmtSize,
    fmtWhen,
    intakeApi,
    intakeStartBlocks,
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

  onMount(() => {
    (async () => {
      const me = (await api.me().catch(() => ({ user: null }))).user;
      allowed = !!me && (me.level ?? 0) >= INTAKE_LEVEL;
      if (!allowed) return;
      try {
        it = (await intakeApi.get(id)).intake;
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
          <span class={`st st-${it.status}`}>{STATUS_LABEL[it.status]}</span>
          {#if it.hint}<span class="hint">{HINT_LABEL[it.hint] ?? it.hint}</span>{/if}
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

        <footer>
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
          {#if boards.length > 1}
            <label class="bsel">
              <span>게시판</span>
              <select bind:value={board}>
                {#each boards as b}<option value={b.key}>{b.label}</option>{/each}
              </select>
            </label>
          {/if}
          {#key board}
            <PostEditor {board} intakeId={it.id} startBlocks={intakeStartBlocks(it)} startTitle={it.title ?? ""} backHref={`${INBOX_PATH}${it.id}/`} />
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
