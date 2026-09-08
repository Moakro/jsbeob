<script lang="ts">
  import { onMount } from "svelte";
  import { api, type MeUser } from "../lib/api";

  let me = $state<MeUser | null>(null);
  let nickname = $state("");
  let affiliation = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let ready = $state(false);

  function nextParam(): string {
    if (typeof window === "undefined") return "/";
    return new URLSearchParams(window.location.search).get("next") || "/";
  }

  onMount(async () => {
    try {
      const r = await api.me();
      me = r.user;
      if (me) {
        nickname = me.display_name ?? "";
        affiliation = me.affiliation ?? "";
      }
    } catch {}
    ready = true;
  });

  async function save(e: Event) {
    e.preventDefault();
    error = null;
    const n = nickname.trim();
    if (n.length < 2 || n.length > 24) {
      error = "닉네임은 2~24자여야 합니다.";
      return;
    }
    saving = true;
    try {
      await api.setNickname(n, affiliation.trim() || undefined);
      window.location.href = nextParam();
    } catch (err) {
      error = err instanceof Error ? err.message : "저장 실패";
      saving = false;
    }
  }
</script>

{#if !ready}
  <p class="state">불러오는 중…</p>
{:else if !me}
  <div class="state">
    <p>로그인이 필요합니다.</p>
    <a class="btn btn-primary" href="/login/?next=/account/nickname/">로그인</a>
  </div>
{:else}
  <form class="nick" onsubmit={save}>
    <label class="field">
      <span>닉네임 <em>(2~24자)</em></span>
      <input bind:value={nickname} maxlength="24" placeholder="표시할 이름" />
    </label>
    <label class="field">
      <span>소속 <em>(선택)</em></span>
      <input bind:value={affiliation} maxlength="40" placeholder="예: ○○지부" />
    </label>
    <p class="hint">운영자·단체명·교리적 권위를 유추할 수 있는 이름은 사용할 수 없습니다.</p>
    {#if error}<p class="err">{error}</p>{/if}
    <button class="btn btn-primary" disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
  </form>
{/if}

<style>
  .state {
    text-align: center;
    color: var(--color-muted);
    padding: 30px 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }
  .nick {
    max-width: 440px;
  }
  .field {
    display: block;
    margin-bottom: 16px;
  }
  .field span {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .field em {
    color: var(--color-muted);
    font-style: normal;
    font-weight: 400;
    font-size: 0.85rem;
  }
  .field input {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-size: 1rem;
  }
  .hint {
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 10px 14px;
    border-radius: var(--radius-md);
  }
</style>
