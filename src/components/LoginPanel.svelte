<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  let next = $state("/");

  onMount(() => {
    const p = new URLSearchParams(window.location.search).get("next");
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
    border-radius: 10px;
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
</style>
