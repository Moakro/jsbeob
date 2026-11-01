<script lang="ts">
  // 관리자 — 회원 목록·검색·등급 변경. 내 등급은 바꿀 수 없다.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { adminApi, fmtKst } from "../../lib/blocks";
  import { LEVEL_LABEL } from "../../lib/api";
  import { branchName } from "../../data/branches";
  import { confirmDialog } from "../../lib/confirm";
  import SelectMenu from "../SelectMenu.svelte";

  let { meId }: { meId?: string | null } = $props();

  let users = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let filter = $state("all");
  let q = $state("");

  const LEVELS = [0, 1, 2, 3, 4];
  const levelGroups = [{ options: LEVELS.map((l) => ({ value: String(l), label: LEVEL_LABEL[l] })) }];
  const PROVIDERS: Record<string, string> = { kakao: "카카오", google: "구글" };

  $effect(() => {
    adminApi
      .listUsers()
      .then((r: any) => (users = r.users))
      .catch((e: any) => (error = e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => (loading = false));
  });

  const chips = $derived([
    { key: "all", label: "전체", n: users.length },
    ...LEVELS.map((l) => ({
      key: `lv:${l}`,
      label: LEVEL_LABEL[l],
      n: users.filter((u) => u.level === l).length,
    })),
    { key: "member", label: "교인 정보", n: users.filter((u) => u.member_branch).length },
  ]);
  const shown = $derived.by(() => {
    const k = q.trim().toLowerCase();
    return users.filter((u) => {
      if (
        (filter === "member" && !u.member_branch) ||
        (filter.startsWith("lv:") && u.level !== Number(filter.slice(3)))
      )
        return false;
      return k
        ? [u.display_name, u.email, u.member_real_name, branchName(u.member_branch)].some(
            (s) => s && s.toLowerCase().includes(k),
          )
        : true;
    });
  });
  const nick = (u: any) => u.display_name || "닉네임 없음";
  const day = (s: string) => fmtKst(s).slice(0, 10);
  /** 받침에 맞춘 조사 '로/으로' (ㄹ 받침은 '로') */
  function ro(w: string) {
    const c = w.charCodeAt(w.length - 1) - 44032;
    const jong = c >= 0 && c < 11172 ? c % 28 : 0;
    return w + (jong === 0 || jong === 8 ? "로" : "으로");
  }

  async function setLevel(u: any, level: number) {
    if (level === u.level || busy) return;
    const risky = level === 4 || u.level === 4;
    if (
      !(await confirmDialog({
        title: "등급 변경",
        message: `${nick(u)} 님의 등급을 ${LEVEL_LABEL[u.level]} → ${ro(LEVEL_LABEL[level])} 바꿀까요?${level === 4 ? " 운영자는 사이트 관리 전체를 쓸 수 있습니다." : ""}`,
        confirmText: "바꾸기",
        tone: risky ? "danger" : "default",
      }))
    )
      return;
    busy = u.id;
    notice = null;
    try {
      await adminApi.updateUserLevel(u.id, level);
      users = users.map((x) => (x.id === u.id ? { ...x, level } : x));
      notice = `${nick(u)} 님 → ${LEVEL_LABEL[level]}`;
    } catch (e) {
      notice = e instanceof Error ? e.message : "등급 변경 실패";
    } finally {
      busy = null;
    }
  }
</script>

<div class="head">
  <p class="dim">회원 {users.length}명</p>
  <input class="search" type="search" bind:value={q} placeholder="닉네임·이메일·실명·지부로 찾기" />
</div>
<div class="chips" role="group" aria-label="회원 걸러 보기">
  {#each chips as c (c.key)}
    <button
      type="button"
      aria-pressed={filter === c.key}
      class:on={filter === c.key}
      onclick={() => (filter = c.key)}>{c.label} <small>{c.n}</small></button
    >
  {/each}
</div>
{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if !users.length}
  <p class="dim">아직 회원이 없습니다.</p>
{:else if shown.length}
  <ul>
    {#each shown as u (u.id)}
      <li>
        <span class="av"
          >{#if u.avatar_url}<img
              src={u.avatar_url}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />{/if}</span
        >
        <div class="who">
          <span class="t" class:none={!u.display_name}
            >{nick(u)}
            {#if u.id === meId}<span class="tag">나</span>{/if}
            {#if u.is_seed}<span class="tag">시드</span>{/if}</span
          >
          <span class="sub"
            >{[u.provider ? (PROVIDERS[u.provider] ?? u.provider) : null, u.email]
              .filter(Boolean)
              .join(" · ")}</span
          >
        </div>
        <span class="member" class:none={!u.member_branch}
          >{u.member_branch
            ? [branchName(u.member_branch) ?? u.member_branch, u.member_real_name].filter(Boolean).join(" · ")
            : "교인 정보 없음"}</span
        >
        <span class="meta stats"
          >글 {u.posts_count} · 댓글 {u.comments_count}
          {#if u.flags_received}<b>· 신고 {u.flags_received}</b>{/if}</span
        >
        <span
          class="meta dates"
          title={`가입 ${fmtKst(u.created_at)}${u.last_seen_at ? ` · 최근 접속 ${fmtKst(u.last_seen_at)}` : ""}`}
          ><span>가입 {day(u.created_at)}</span>{#if u.last_seen_at}<span>접속 {day(u.last_seen_at)}</span
            >{/if}</span
        >
        <div class="lv">
          {#if u.id === meId}
            <span class="lv-fixed">{LEVEL_LABEL[u.level] ?? u.level}</span>
          {:else}
            <SelectMenu
              bind:value={() => String(u.level), (v) => setLevel(u, Number(v))}
              groups={levelGroups}
            />
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{:else}
  <p class="dim">맞는 회원이 없습니다.</p>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .search {
    flex: 0 1 300px;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 0.9rem;
  }
  .search:focus {
    outline: none;
    border-color: var(--color-primary);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .chips button {
    padding: 5px 12px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-surface);
    color: var(--color-muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .chips button:hover {
    color: var(--color-fg);
  }
  .chips button.on {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .chips small {
    font-weight: 500;
    opacity: 0.8;
  }
  .notice {
    margin: 0 0 10px;
    font-size: 0.88rem;
    color: var(--color-secondary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  li {
    display: grid;
    grid-template-columns: 36px minmax(0, 1.5fr) minmax(0, 1fr) 130px 96px 120px;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-rule);
  }
  li:first-child {
    border-top: 0;
  }
  .av {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--color-surface-2);
  }
  .av img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .who {
    min-width: 0;
  }
  .t,
  .sub {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t {
    font-weight: 600;
    color: var(--color-fg);
  }
  .t.none {
    color: var(--color-muted);
    font-weight: 500;
  }
  .tag {
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.72rem;
    font-weight: 600;
    vertical-align: 1px;
  }
  .sub {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .member {
    font-size: 0.85rem;
    color: var(--color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member.none {
    color: var(--color-faint);
  }
  .meta {
    font-size: 0.78rem;
    color: var(--color-muted);
    line-height: 1.45;
  }
  .dates span {
    display: block;
  }
  .meta b {
    color: var(--color-primary);
    font-weight: 600;
  }
  .lv :global(.sm-btn) {
    padding: 6px 10px;
    font-size: 0.88rem;
  }
  .lv-fixed {
    display: block;
    padding: 6px 10px;
    font-size: 0.88rem;
    color: var(--color-muted);
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.88rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  @media (max-width: 760px) {
    .search {
      flex: 1 1 100%;
    }
    li {
      grid-template-columns: 36px minmax(0, 1fr) 112px;
      grid-template-areas: "av who lv" ". member member" ". stats stats" ". dates dates";
      row-gap: 3px;
    }
    .av {
      grid-area: av;
    }
    .who {
      grid-area: who;
    }
    .lv {
      grid-area: lv;
    }
    .member {
      grid-area: member;
    }
    .stats {
      grid-area: stats;
    }
    .dates {
      grid-area: dates;
    }
    .member.none {
      display: none;
    }
    .dates span {
      display: inline;
    }
    .dates span + span:before {
      content: " · ";
    }
  }
</style>
