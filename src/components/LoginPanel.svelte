<script lang="ts">
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/LoginPanel.*.js) 기준. 9월 버전에 next prop 추가.
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { SHOW_OLD_BADGE } from "../data/site-nav";

  /** 로그인 후 돌아갈 경로. 없으면 주소의 ?next= 를 쓴다. */
  let { next: nextProp = null }: { next?: string | null } = $props();

  let next = $state("/");

  onMount(() => {
    const p = nextProp ?? new URLSearchParams(window.location.search).get("next");
    if (p && p.startsWith("/")) next = p;
  });
</script>

<div class="login-panel">
  <a class="provider kakao" href={api.loginUrl("kakao", next)}>
    <span class="ico">💬</span> 카카오로 시작하기
  </a>
  <a class="provider google" href={api.loginUrl("google", next)}>
    <span class="ico">G</span> 구글로 시작하기
  </a>
  <p class="note">로그인하면 게시판에 글·댓글을 남길 수 있습니다.</p>
  <!-- 옛 홈페이지(jsbeob.com) 게시판 글 보관함 (2026-11-12) -->
  <a class="legacy" href="/legacy/"
    >{#if SHOW_OLD_BADGE}<span class="old-badge" aria-hidden="true">OLD</span>{/if}옛 홈페이지 보관함</a
  >
</div>

<style>
  .login-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .provider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 18px;
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: 1rem;
    border: 1px solid transparent;
  }
  .provider:hover {
    text-decoration: none;
    filter: brightness(0.97);
  }
  .kakao {
    background: #fee500;
    color: #191600;
  }
  .google {
    background: #fff;
    color: #1f1c1a;
    border-color: var(--color-rule);
  }
  .provider .ico {
    font-weight: 800;
  }
  .google .ico {
    color: #4285f4;
  }
  .note {
    color: var(--color-muted);
    font-size: 0.86rem;
    text-align: center;
    margin: 8px 0 0;
  }
  .legacy {
    align-self: center;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--color-rule);
    width: 100%;
    text-align: center;
    font-size: 0.88rem;
    color: var(--color-muted);
  }
  .legacy:hover {
    color: var(--color-primary);
  }
  .legacy :global(.old-badge) {
    margin-right: 6px;
  }
</style>
