<script lang="ts">
  // 헤더 계정 버튼 — 로그인 시 프로필 이미지 + 메뉴(내 정보·사이트 관리·로그아웃), 아니면 로그인 링크.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/AuthLink.*.js) 기준.
  import { onMount } from "svelte";
  import { api, type MeUser } from "../lib/api";
  import { confirmDialog } from "../lib/confirm";

  let user = $state<MeUser | null>(null);
  let loaded = $state(false);
  let open = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  let buttonEl = $state<HTMLButtonElement | null>(null);

  onMount(() => {
    (async () => {
      try {
        user = (await api.me()).user;
      } catch {
        user = null;
      } finally {
        loaded = true;
      }
    })();
    // 메뉴 바깥 클릭·Esc 로 닫기
    const onDocClick = (e: MouseEvent) => {
      if (open && menuEl && !menuEl.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") {
        open = false;
        buttonEl?.focus();
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });

  function loginHref(): string {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return `/login/?next=${encodeURIComponent(next)}`;
  }

  async function logout() {
    open = false;
    if (
      !(await confirmDialog({
        title: "로그아웃",
        message: "로그아웃 하시겠습니까?",
        confirmText: "로그아웃",
      }))
    ) {
      buttonEl?.focus();
      return;
    }
    try {
      await api.logout();
    } catch {}
    window.location.reload();
  }
</script>

{#if !loaded}
  <span class="auth-skel" aria-hidden="true"></span>
{:else if user}
  <div class="auth-menu" bind:this={menuEl}>
    <button
      type="button"
      class="auth-avatar"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="내 계정 메뉴"
      bind:this={buttonEl}
      onclick={() => (open = !open)}
    >
      {#if user.avatar_url}
        <img src={user.avatar_url} alt="" />
      {:else}
        <span class="fallback">{(user.display_name ?? "회").slice(0, 1)}</span>
      {/if}
    </button>
    {#if open}
      <div class="auth-dropdown" role="menu">
        <a role="menuitem" href="/account/" onclick={() => (open = false)}>내 정보</a>
        {#if (user.level ?? 0) >= 4}
          <a role="menuitem" href="/admin/" onclick={() => (open = false)}>사이트 관리</a>
        {/if}
        <button type="button" role="menuitem" onclick={logout}>로그아웃</button>
      </div>
    {/if}
  </div>
{:else}
  <a class="login-link" href={loginHref()} aria-label="로그인" title="로그인">
    <svg class="login-ico" viewBox="0 -960 960 960" aria-hidden="true"
      ><path
        d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"
      ></path></svg
    >
    <span class="login-text">로그인</span>
  </a>
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
    border-radius: var(--radius-md);
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
  .login-link {
    display: inline-flex;
    align-items: center;
  }
  .login-ico {
    display: none;
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  @media (max-width: 450px) {
    .login-link {
      width: 34px;
      height: 34px;
      padding: 0;
      justify-content: center;
    }
    .login-ico {
      display: block;
    }
    .login-text {
      display: none;
    }
  }
  .auth-menu {
    position: relative;
  }
  .auth-avatar {
    display: inline-flex;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--color-rule);
    background: none;
    cursor: pointer;
  }
  .auth-avatar:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
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
  .auth-dropdown {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 60;
    min-width: 140px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }
  .auth-dropdown a,
  .auth-dropdown button {
    display: block;
    width: 100%;
    padding: 9px 12px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    text-align: left;
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--color-fg);
    white-space: nowrap;
    cursor: pointer;
  }
  .auth-dropdown a:hover,
  .auth-dropdown button:hover,
  .auth-dropdown a:focus-visible,
  .auth-dropdown button:focus-visible {
    background: var(--color-primary-bg);
    color: var(--color-primary);
    text-decoration: none;
    outline: none;
  }
</style>
