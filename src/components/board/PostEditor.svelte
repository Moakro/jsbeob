<script lang="ts">
  import { onMount } from "svelte";
  import { api, BOARDS, type MeUser, type PostAttachment } from "../../lib/api";

  // postId 가 있으면 수정 모드.
  let { board, postId = null }: { board: string; postId?: string | null } = $props();
  const meta = BOARDS[board];
  const editing = !!postId;

  let me = $state<MeUser | null>(null);
  let ready = $state(false);
  let title = $state("");
  let body = $state("");
  let youtubeUrl = $state("");
  let videos = $state<PostAttachment[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const canWrite = $derived(
    !!me && !!me.display_name && (me.level ?? 0) >= (meta?.writeLevel ?? 1),
  );

  onMount(async () => {
    try {
      me = (await api.me()).user;
    } catch {}
    if (editing && postId) {
      try {
        const p = (await api.getPost(postId)).post;
        title = p.title;
        body = p.body_md;
        videos = p.attachments.filter((a) => a.type === "video");
      } catch (e) {
        error = e instanceof Error ? e.message : "불러오기 실패";
      }
    }
    ready = true;
  });

  function addYoutube() {
    const url = youtubeUrl.trim();
    if (!url) return;
    videos = [...videos, { type: "video", url }];
    youtubeUrl = "";
  }
  function removeVideo(i: number) {
    videos = videos.filter((_, idx) => idx !== i);
  }

  async function save(e: Event) {
    e.preventDefault();
    error = null;
    if (!title.trim()) {
      error = "제목을 입력하세요.";
      return;
    }
    if (!body.trim() && videos.length === 0) {
      error = "본문 또는 첨부가 필요합니다.";
      return;
    }
    saving = true;
    try {
      const input = { title: title.trim(), body: body.trim(), attachments: videos };
      if (editing && postId) {
        await api.updatePost(postId, input);
        window.location.href = `/community/${board}/${postId}/`;
      } else {
        const r = await api.createPost({ board, ...input });
        window.location.href = `/community/${board}/${r.id}/`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "저장 실패";
      saving = false;
    }
  }
</script>

{#if !ready}
  <p class="state">불러오는 중…</p>
{:else if !me}
  <p class="state">
    글을 쓰려면 로그인하세요. <a href="/community/">← 돌아가기</a>
  </p>
{:else if !canWrite}
  <p class="state">
    {me.display_name ? "이 게시판에 글을 쓸 권한이 없습니다." : "먼저 닉네임을 설정하세요."}
    <a href={me.display_name ? `/community/${board}/` : "/account/nickname/"}>이동</a>
  </p>
{:else}
  <form class="editor" onsubmit={save}>
    <h1>{editing ? "글 수정" : `${meta?.label ?? ""} 글쓰기`}</h1>

    <label class="field">
      <span>제목</span>
      <input bind:value={title} maxlength="200" placeholder="제목" />
    </label>

    <label class="field">
      <span>내용</span>
      <textarea bind:value={body} rows="12" placeholder="내용을 입력하세요. (마크다운 지원)"></textarea>
    </label>

    <div class="field">
      <span>YouTube 영상 (선택)</span>
      <div class="yt-add">
        <input bind:value={youtubeUrl} placeholder="https://youtu.be/..." />
        <button type="button" class="btn btn-ghost" onclick={addYoutube}>추가</button>
      </div>
      {#if videos.length}
        <ul class="yt-list">
          {#each videos as v, i}
            <li>{v.url}<button type="button" onclick={() => removeVideo(i)}>✕</button></li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if error}<p class="err">{error}</p>{/if}

    <div class="buttons">
      <a class="btn btn-ghost" href={editing ? `/community/${board}/${postId}/` : `/community/${board}/`}>취소</a>
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
  .field input,
  .field textarea {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.98rem;
  }
  .field textarea {
    resize: vertical;
    line-height: 1.7;
  }
  .yt-add {
    display: flex;
    gap: 8px;
  }
  .yt-add input {
    flex: 1;
  }
  .yt-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yt-list li {
    display: flex;
    justify-content: space-between;
    background: var(--color-surface-2);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    word-break: break-all;
  }
  .yt-list button {
    border: none;
    background: none;
    color: var(--color-primary);
    cursor: pointer;
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
</style>
