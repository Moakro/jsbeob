<script lang="ts">
  // 글 보기 제목 줄 아래 공개·비공개 버튼 — 관리자·글쓴이에게만 (2026-11-28 오너 결정)
  // 비공개 = 글 상태 'hidden'(신고 숨김과 같은 상태). 신고로 숨긴 글은 관리자만 공개한다.
  // 대기(pending) 글도 is_hidden 으로 와서 '공개하기' 하나만 보인다.
  import { LEVEL } from "../../data/levels";
  import { api, type MeUser, type PostDetail } from "../../lib/api";

  let {
    post,
    me,
    onchange,
    style = "",
  }: { post: PostDetail; me: MeUser | null; onchange: (hidden: boolean) => void; style?: string } = $props();

  const admin = $derived((me?.level ?? 0) >= LEVEL.ADMIN);
  const show = $derived(!!me && (admin || (me.id === post.author_id && !post.report_hidden)));
  let busy = $state(false);

  async function toggle() {
    busy = true;
    try {
      const r = await api.setPostStatus(post.id, post.is_hidden ? "published" : "hidden");
      onchange(r.status === "hidden");
    } catch (e) {
      alert(e instanceof Error ? e.message : "바꾸지 못했습니다");
    } finally {
      busy = false;
    }
  }
</script>

{#if show}
  <div class="pub" {style}>
    <button type="button" class="btn btn-ghost" disabled={busy} onclick={toggle}
      >{post.is_hidden ? "공개하기" : "비공개로"}</button
    >
  </div>
{/if}

<style>
  .pub {
    margin: 0 0 14px;
  }
  .pub .btn {
    padding: 6px 14px;
    font-size: 0.88rem;
  }
</style>
