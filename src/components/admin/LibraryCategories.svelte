<script lang="ts">
  // 관리자 — 자료실 분류 관리(이름·정렬·한 권으로 보기·첫 화면 자리·소개, 순서 바꾸기, 추가·삭제).
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { library, catHref, type LibraryCategory } from "../../lib/library";
  import { confirmDialog } from "../../lib/confirm";

  const ORDERS = [
    { v: "alpha", l: "고정 → 가나다" },
    { v: "toc", l: "순서 값(차례)" },
    { v: "recent", l: "최신순" },
  ];
  const TYPES: Record<string, string> = { article: "정형 자료", post: "게시물" };
  const PLACES = [
    { v: "main", l: "왼쪽 상자" },
    { v: "side", l: "오른쪽 가이드" },
  ];

  let rows = $state<any[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let adding = $state(false);

  const EMPTY: Required<Pick<LibraryCategory, "key" | "label" | "type" | "list_order" | "as_book" | "place">> & {
    intro: string;
  } = {
    key: "",
    label: "",
    type: "post",
    list_order: "recent",
    as_book: true,
    place: "main",
    intro: "",
  };
  let draft = $state({ ...EMPTY });

  /** 편집용 사본(_로 시작하는 칸)을 붙인다 */
  const withEdit = (list: any[]) =>
    list.map((c) => ({
      ...c,
      _label: c.label,
      _order: c.list_order,
      _book: c.as_book,
      _place: c.place,
      _intro: c.intro ?? "",
    }));
  const changed = (c: any) =>
    c._label !== c.label ||
    c._order !== c.list_order ||
    c._book !== c.as_book ||
    c._place !== c.place ||
    c._intro.trim() !== (c.intro ?? "");

  async function load() {
    try {
      rows = withEdit((await library.categories()).categories);
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    }
  }
  onMount(load);

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await fn();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "저장 실패";
    } finally {
      busy = false;
    }
  }

  const save = (c: any) =>
    run(() =>
      library.updateCategory(c.key, {
        label: c._label.trim(),
        list_order: c._order,
        as_book: c._book,
        place: c._place,
        intro: c._intro.trim(),
      }),
    );

  const move = (i: number, d: number) => {
    const keys = rows.map((c) => c.key);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    run(() => library.orderCategories(keys));
  };

  async function remove(c: any) {
    if (
      await confirmDialog({
        title: "분류 삭제",
        message: `'${c.label}' 분류를 지울까요? 글이 남아 있으면 지워지지 않습니다.`,
        confirmText: "삭제",
        tone: "danger",
      })
    )
      run(() => library.deleteCategory(c.key));
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    run(async () => {
      await library.createCategory({
        ...draft,
        key: draft.key.trim().toLowerCase(),
        label: draft.label.trim(),
        intro: draft.intro.trim(),
      });
      draft = { ...EMPTY };
      adding = false;
    });
  }
</script>

<section class="lc">
  <div class="lc-head">
    <strong>분류</strong>
    <button type="button" class="btn btn-ghost sm" onclick={() => (adding = !adding)}
      >{adding ? "닫기" : "＋ 분류 추가"}</button
    >
  </div>
  {#if error}<p class="err">{error}</p>{/if}
  <table>
    <thead
      ><tr
        ><th>순서</th><th>이름</th><th>주소</th><th>종류</th><th>정렬</th><th>한 권으로 보기</th><th
          >첫 화면 자리</th
        ><th></th></tr
      ></thead
    ><tbody>
      {#each rows as c, i (c.key)}
        <tr
          ><td class="ord"
            ><button type="button" aria-label="위로" disabled={busy || i === 0} onclick={() => move(i, -1)}
              >↑</button
            >
            <button
              type="button"
              aria-label="아래로"
              disabled={busy || i === rows.length - 1}
              onclick={() => move(i, 1)}>↓</button
            ></td
          ><td><input bind:value={c._label} maxlength="40" aria-label="분류 이름" /></td><td
            ><a href={catHref(c.key)} target="_blank" rel="noopener">/archive/{c.key}/</a></td
          ><td>{TYPES[c.type]}</td><td
            ><select bind:value={c._order} aria-label="정렬 방식"
              >{#each ORDERS as o}<option value={o.v}>{o.l}</option>{/each}</select
            ></td
          ><td class="chk"><input type="checkbox" bind:checked={c._book} aria-label="한 권으로 보기" /></td
          ><td
            ><select bind:value={c._place} aria-label="첫 화면 자리"
              >{#each PLACES as o}<option value={o.v}>{o.l}</option>{/each}</select
            ></td
          ><td class="act"
            ><button
              type="button"
              class="btn btn-primary sm"
              disabled={busy || !changed(c) || !c._label.trim()}
              onclick={() => save(c)}>저장</button
            >
            <button type="button" class="btn btn-ghost sm danger" disabled={busy} onclick={() => remove(c)}
              >삭제</button
            ></td
          ></tr
        >
        {#if c._place === "side"}
          <tr class="intro-row"
            ><td></td><td colspan="7"
              ><label class="intro"
                ><span>소개</span><input
                  bind:value={c._intro}
                  maxlength="200"
                  placeholder="오른쪽 칸 머리 아래 한 줄 소개(비우면 안 보임)"
                  aria-label="소개 문구"
                /></label
              ></td
            ></tr
          >
        {/if}
      {/each}
    </tbody>
  </table>
  {#if adding}
    <form class="lc-add" onsubmit={add}>
      <label
        ><span>이름</span><input
          bind:value={draft.label}
          maxlength="40"
          placeholder="예: 가사"
          required
        /></label
      >
      <label
        ><span>주소 이름 <small>영문 소문자·숫자·-</small></span><input
          bind:value={draft.key}
          maxlength="30"
          placeholder="예: gasa"
          required
        /></label
      >
      <label
        ><span>종류</span>
        <select bind:value={draft.type}
          ><option value="post">게시물</option><option value="article">정형 자료</option></select
        ></label
      >
      <label
        ><span>정렬</span>
        <select bind:value={draft.list_order}
          >{#each ORDERS as o}<option value={o.v}>{o.l}</option>{/each}</select
        ></label
      >
      <label class="chk"><input type="checkbox" bind:checked={draft.as_book} /> 한 권으로 보기</label>
      <label
        ><span>첫 화면 자리</span>
        <select bind:value={draft.place}
          >{#each PLACES as o}<option value={o.v}>{o.l}</option>{/each}</select
        ></label
      >
      {#if draft.place === "side"}
        <label><span>소개</span><input bind:value={draft.intro} maxlength="200" /></label>
      {/if}
      <button class="btn btn-primary sm" disabled={busy}>추가</button>
    </form>
  {/if}
</section>

<style>
  .lc {
    margin-bottom: 22px;
    padding: 14px 16px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .lc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 6px;
    border-bottom: 1px solid var(--color-rule);
    text-align: left;
    vertical-align: middle;
  }
  th {
    color: var(--color-muted);
    font-weight: 500;
    font-size: 0.8rem;
  }
  td input:not([type="checkbox"]),
  td select,
  .lc-add input:not([type="checkbox"]),
  .lc-add select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font: inherit;
    background: var(--color-bg);
  }
  .ord button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    cursor: pointer;
  }
  .ord button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .chk {
    text-align: center;
  }
  .act {
    white-space: nowrap;
  }
  .sm {
    padding: 4px 10px;
    font-size: 0.82rem;
  }
  .danger {
    color: var(--color-primary);
  }
  tr:has(+ .intro-row) td {
    border-bottom: 0;
  }
  .intro {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .intro span {
    flex: none;
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .act button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
  }
  .lc-add {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    align-items: end;
    margin-top: 12px;
  }
  .lc-add label {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .lc-add label.chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
