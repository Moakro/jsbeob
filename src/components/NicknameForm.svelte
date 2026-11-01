<script lang="ts">
  // 정보 설정 — 닉네임 + (교인이면) 실명·지부/분원.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/NicknameForm.*.js) 기준.
  import { onMount } from "svelte";
  import { api, type MeUser } from "../lib/api";
  import { BRANCHES } from "../data/branches";
  import SelectMenu from "./SelectMenu.svelte";

  let me = $state<MeUser | null>(null);
  let nickname = $state("");
  let isMember = $state(false);
  let realName = $state("");
  let branch = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let ready = $state(false);

  const branchGroups = ["지부", "분원"].map((kind) => ({
    label: kind,
    options: BRANCHES.filter((b) => b.kind === kind).map((b) => ({ value: b.code, label: b.name })),
  }));

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
        isMember = !!me.member;
        realName = me.member?.real_name ?? "";
        branch = me.member?.branch ?? "";
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
    const rn = realName.trim().replace(/\s+/g, " ");
    if (isMember && (rn.length < 2 || rn.length > 20)) {
      error = "실명을 입력해 주세요.";
      return;
    }
    if (isMember && !branch) {
      error = "지부/분원을 선택해 주세요.";
      return;
    }
    saving = true;
    try {
      await api.setNickname(n, me?.affiliation ?? (null as any), isMember ? { real_name: rn, branch } : null);
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
    <label class="check">
      <input type="checkbox" bind:checked={isMember} />
      <span>법종교 교인이세요?</span>
    </label>
    {#if isMember}
      <fieldset class="member">
        <legend>교인 정보</legend>
        <label class="field">
          <span>실명</span>
          <input bind:value={realName} maxlength="20" autocomplete="name" />
        </label>
        <div class="field">
          <span id="branch-label">지부/분원</span>
          <SelectMenu groups={branchGroups} labelledby="branch-label" bind:value={branch} />
        </div>
        <p class="note">교인 정보는 게시판 등 다른 회원에게 표시되지 않습니다.</p>
      </fieldset>
    {/if}
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
    background: var(--color-surface);
    color: var(--color-fg);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 16px;
    font-weight: 600;
    cursor: pointer;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--color-primary);
  }
  .member {
    margin: 0 0 16px;
    padding: 16px 16px 4px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .member legend {
    padding: 0 6px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--color-primary);
  }
  .note {
    margin: -6px 0 12px;
    color: var(--color-muted);
    font-size: 0.82rem;
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 10px 14px;
    border-radius: var(--radius-md);
  }
</style>
