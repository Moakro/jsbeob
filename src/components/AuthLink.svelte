<script lang="ts">
  import { onMount } from "svelte";
  import { api, type MeUser } from "../lib/api";

  let user = $state<MeUser | null>(null);
  let loaded = $state(false);

  onMount(async () => {
    try {
      user = (await api.me()).user;
    } catch {
      user = null;
    } finally {
      loaded = true;
    }
  });

  function loginHref(): string {
    const next =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/";
    return `/login/?next=${encodeURIComponent(next)}`;
  }
</script>

{#if !loaded}
  <span class="auth-skel" aria-hidden="true"></span>
{:else if user}
  <!-- 로그인 시: 프로필 이미지만. 클릭 → 개인설정. -->
  <a class="auth-avatar" href="/account/" title="내 계정" aria-label="내 계정">
    {#if user.avatar_url}
      <img src={user.avatar_url} alt="" />
    {:else}
      <span class="fallback">{(user.display_name ?? "회").slice(0, 1)}</span>
    {/if}
  </a>
{:else}
  <a class="login-link" href={loginHref()}>로그인</a>
{/if}

<style>
  .auth-skel {
    display: inline-block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-surface-2);
  }
  .login-link {
    border: 1px solid var(--color-primary);
    color: var(--color-primary);
    border-radius: 8px;
    padding: 6px 14px;
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .login-link:hover {
    background: var(--color-primary);
    color: #fff;
    text-decoration: none;
  }
  .auth-avatar {
    display: inline-flex;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--color-rule);
  }
  .auth-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .auth-avatar .fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    background: var(--color-secondary);
    color: #fff;
    font-weight: 700;
  }
</style>
