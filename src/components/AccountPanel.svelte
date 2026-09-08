<script lang="ts">
  import { onMount } from "svelte";
  import { api, type MeUser } from "../lib/api";

  let me = $state<MeUser | null>(null);
  let ready = $state(false);

  const LEVELS: Record<number, string> = {
    0: "대기", 1: "일반", 2: "검증", 3: "큐레이터", 4: "운영자",
  };

  onMount(async () => {
    try {
      me = (await api.me()).user;
    } catch {}
    ready = true;
  });

  async function logout() {
    try { await api.logout(); } catch {}
    window.location.href = "/";
  }
</script>

{#if !ready}
  <p class="muted">불러오는 중…</p>
{:else if !me}
  <div class="login">
    <p>로그인이 필요합니다.</p>
    <a class="btn btn-primary" href="/login/?next=/account/">로그인</a>
  </div>
{:else}
  <div class="card">
    <div class="who">
      {#if me.avatar_url}<img src={me.avatar_url} alt="" />{/if}
      <div>
        <strong>{me.display_name ?? "(닉네임 미설정)"}</strong>
        <small>{me.affiliation ?? ""} · {LEVELS[me.level] ?? me.level}</small>
      </div>
    </div>
    <div class="links">
      <a href="/account/nickname/">닉네임 변경</a>
      {#if (me.level ?? 0) >= 4}<a href="/admin/">관리자</a>{/if}
      <button onclick={logout}>로그아웃</button>
    </div>
  </div>
{/if}

<style>
  .muted { color: var(--color-muted); }
  .login { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    padding: 22px;
  }
  .who { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; }
  .who img { width: 54px; height: 54px; border-radius: 50%; object-fit: cover; }
  .who strong { display: block; font-size: 1.15rem; }
  .who small { color: var(--color-muted); }
  .links { display: flex; gap: 16px; align-items: center; border-top: 1px solid var(--color-rule); padding-top: 16px; }
  .links a, .links button {
    background: none; border: none; padding: 0; color: var(--color-primary);
    font-size: 0.95rem; cursor: pointer; font-weight: 600;
  }
</style>
