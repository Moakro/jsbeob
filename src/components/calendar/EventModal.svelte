<script lang="ts">
  // 일정 추가·수정 모달(<dialog>) — 기념일은 연례·음력, 그 밖은 공개 여부.
  // jsbooks 의 EventModal 에서 출발. 복원(2026-11-01): 배포본(_astro/MemorialList.*.js 에 함께 묶인 컴포넌트) 기준.
  import { tick } from "svelte";
  import type { CalendarEvent, EventCategory } from "../../lib/calendar-events";
  import { getLunar, formatLunarShort, lunarToSolar } from "../../lib/date";
  import { confirmDialog } from "../../lib/confirm";

  interface Props {
    open: boolean;
    /** 편집 모드면 기존 이벤트, 아니면 null. */
    event?: CalendarEvent | null;
    /** 새 일정 추가 시 기본 시작일 (YYYY-MM-DD). */
    defaultDate?: string;
    onClose: () => void;
    /** 저장 또는 삭제 성공 후 호출. */
    onSaved: () => void;
  }

  let { open = $bindable(), event = null, defaultDate, onClose, onSaved }: Props = $props();

  const CATEGORIES: EventCategory[] = ["기념일", "일정", "기타"];

  let title = $state("");
  let startDate = $state("");
  let hasEndDate = $state(false);
  let endDate = $state("");
  let category = $state<EventCategory>("기념일");
  let isAnnual = $state(false);
  let isLunar = $state(false);
  let isPublic = $state(true);
  let memo = $state("");
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let titleInputEl = $state<HTMLInputElement | undefined>();
  let dialogEl = $state<HTMLDialogElement | undefined>();

  const isEditMode = $derived(!!event);

  // 연례·음력은 기념일에만
  $effect(() => {
    if (category !== "기념일") {
      isAnnual = false;
      isLunar = false;
    }
  });

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      fill();
      dialogEl.showModal();
      tick().then(() => titleInputEl?.focus());
    } else if (!open && dialogEl.open) dialogEl.close();
  });

  function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fill() {
    if (event) {
      title = event.title;
      // 음력 일정은 입력칸에 양력으로 보여 준다
      if (event.is_lunar === 1) {
        const [y, m, d] = event.start_date.split("-").map(Number);
        const solar = lunarToSolar(y, m, d, false);
        startDate = solar ? ymd(solar) : event.start_date;
      } else startDate = event.start_date;
      hasEndDate = !!event.end_date && event.end_date !== event.start_date;
      endDate = event.end_date ?? "";
      const c = (event.category ?? "기념일") as EventCategory;
      category = CATEGORIES.includes(c) ? c : "기념일";
      isAnnual = event.is_annual === 1;
      isLunar = event.is_lunar === 1;
      isPublic = event.is_public === 1;
      memo = event.memo ?? "";
    } else {
      title = "";
      startDate = defaultDate || ymd(new Date());
      hasEndDate = false;
      endDate = "";
      category = "기념일";
      isAnnual = false;
      isLunar = false;
      isPublic = true;
      memo = "";
    }
    errorMessage = null;
  }

  /** 입력한 양력 날짜의 음력 표기 */
  const lunarHint = $derived.by(() => {
    const [y, m, d] = startDate.split("-").map(Number);
    if (!y || !m || !d) return null;
    const l = getLunar(new Date(y, m - 1, d));
    return l ? formatLunarShort(l.month, l.day, l.intercalation) : null;
  });

  function close() {
    if (isSubmitting) return;
    open = false;
    onClose();
  }

  async function submit() {
    const t = title.trim();
    if (!t) return void (errorMessage = "제목을 입력해주세요.");
    if (!startDate) return void (errorMessage = "일자를 선택해주세요.");
    if (hasEndDate && endDate && endDate < startDate)
      return void (errorMessage = "종료일은 시작일 이후여야 합니다.");
    isSubmitting = true;
    errorMessage = null;
    try {
      let start = startDate;
      // 음력 기념일: 입력한 양력 날짜를 음력으로 바꿔 저장
      if (category === "기념일" && isLunar) {
        const [y, m, d] = startDate.split("-").map(Number);
        const l = getLunar(new Date(y, m - 1, d));
        if (l) start = `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}`;
      }
      const body = {
        title: t,
        start_date: start,
        end_date: hasEndDate && endDate ? endDate : null,
        category,
        is_annual: category === "기념일" && isAnnual ? 1 : 0,
        is_lunar: category === "기념일" && isLunar ? 1 : 0,
        is_public: category === "기념일" || isPublic ? 1 : 0,
        memo: memo.trim() || null,
      };
      const res = await fetch(isEditMode && event ? `/api/events/${event.id}` : "/api/events", {
        method: isEditMode ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return void (errorMessage = "로그인이 필요합니다.");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return void (errorMessage = d.error ?? "일정 저장에 실패했습니다.");
      }
      open = false;
      onSaved();
      onClose();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "일정 저장에 실패했습니다.";
    } finally {
      isSubmitting = false;
    }
  }

  async function remove() {
    if (
      !event ||
      !(await confirmDialog({
        title: "일정 삭제",
        message: `'${event.title}' 일정을 삭제할까요?`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    isSubmitting = true;
    errorMessage = null;
    try {
      const res = await fetch(`/api/events/${event.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return void (errorMessage = d.error ?? "삭제에 실패했습니다.");
      }
      open = false;
      onSaved();
      onClose();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "삭제에 실패했습니다.";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  class="em-dialog"
  aria-labelledby="em-title"
  bind:this={dialogEl}
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onclick={(e) => {
    if (e.target === dialogEl) close();
  }}
>
  <div class="em-head">
    <h2 id="em-title">{isEditMode ? "일정 수정" : "일정 추가"}</h2>
    <button type="button" class="em-x" aria-label="닫기" onclick={close}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
    </button>
  </div>
  <form
    class="em-body"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <div class="em-field">
      <label for="em-input-title">제목</label>
      <input
        id="em-input-title"
        type="text"
        bind:value={title}
        bind:this={titleInputEl}
        placeholder="일정 제목"
        maxlength="200"
        required
      />
    </div>
    <div class="em-field">
      <label for="em-cat">카테고리</label>
      <select id="em-cat" bind:value={category}>
        {#each CATEGORIES as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
    </div>
    {#if category === "기념일"}
      <div class="em-checkgroup">
        <label
          ><input type="checkbox" bind:checked={isAnnual} /><span>연례 <small>(매년 같은 날)</small></span
          ></label
        >
        <label
          ><input type="checkbox" bind:checked={isLunar} /><span
            >음력 <small>(입력일을 음력 기준으로)</small></span
          ></label
        >
      </div>
      <p class="em-lunar-note">
        연례 체크 시 시작 연도를 기준으로 입력하세요. 음력 기념일은 <strong
          >양력 날짜 입력 후 음력 체크</strong
        >
        — 저장 시 자동으로 음력으로 변환됩니다.<br />
        <small>예: 천강절 = 1871년 11월 1일 입력 + 음력 체크 (= 음력 1871.9.19)</small>
      </p>
    {:else}
      <div class="em-checkgroup">
        <label
          ><input type="checkbox" bind:checked={isPublic} /><span
            >공개 <small>(전체 방문자에게 노출)</small></span
          ></label
        >
      </div>
    {/if}
    <div class="em-field">
      <label for="em-start"
        >일자 {#if lunarHint}<span class="em-lunar-hint">({lunarHint})</span>{/if}</label
      >
      <input id="em-start" type="date" bind:value={startDate} required />
    </div>
    <div class="em-checkbox">
      <label><input type="checkbox" bind:checked={hasEndDate} /><span>기간 있음</span></label>
    </div>
    {#if hasEndDate}
      <div class="em-field">
        <label for="em-end">종료일</label>
        <input id="em-end" type="date" bind:value={endDate} min={startDate} />
      </div>
    {/if}
    <div class="em-field">
      <label for="em-memo">메모</label>
      <textarea id="em-memo" bind:value={memo} rows="3" placeholder="메모 (선택)" maxlength="2000"></textarea>
    </div>
    {#if errorMessage}<div class="em-error" role="alert">{errorMessage}</div>{/if}
    <div class="em-actions">
      {#if isEditMode}
        <button type="button" class="em-btn em-delete" disabled={isSubmitting} onclick={remove}>삭제</button>
      {/if}
      <button type="button" class="em-btn em-cancel" disabled={isSubmitting} onclick={close}>취소</button>
      <button type="submit" class="em-btn em-submit" disabled={isSubmitting}
        >{isSubmitting ? "저장 중…" : "저장"}</button
      >
    </div>
  </form>
</dialog>

<style>
  .em-dialog {
    width: min(460px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-fg);
    box-shadow: 0 24px 60px #0000004d;
  }
  .em-dialog::backdrop {
    background: #14100d73;
  }
  .em-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-rule);
  }
  .em-head h2 {
    margin: 0;
    font-size: 1.08rem;
  }
  .em-x {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  .em-x:hover {
    background: var(--color-surface-2);
  }
  .em-x svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .em-body {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 18px 20px 20px;
  }
  .em-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .em-field label {
    font-size: 0.82rem;
    color: var(--color-muted);
    font-weight: 600;
  }
  .em-lunar-hint {
    margin-left: 0.4rem;
    font-weight: 500;
    color: var(--color-secondary);
    font-size: 0.78rem;
  }
  .em-lunar-note {
    margin: 0 0 0.2rem;
    font-size: 0.78rem;
    color: var(--color-muted);
    background: color-mix(in srgb, var(--color-primary) 4%, transparent);
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-md);
    border-left: 2px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  }
  .em-field input[type="text"],
  .em-field input[type="date"],
  .em-field select,
  .em-field textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font: inherit;
    font-size: 16px;
    background: var(--color-surface);
    color: var(--color-fg);
    outline: none;
  }
  .em-field input:focus,
  .em-field select:focus,
  .em-field textarea:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
  .em-field textarea {
    resize: vertical;
    min-height: 70px;
  }
  .em-checkbox label,
  .em-checkgroup label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.92rem;
  }
  .em-checkgroup {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.1rem;
    padding: 0.3rem 0.1rem;
  }
  .em-checkgroup small {
    color: var(--color-muted);
    font-weight: 400;
    margin-left: 0.15rem;
  }
  .em-checkbox input[type="checkbox"],
  .em-checkgroup input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--color-primary);
  }
  .em-error {
    padding: 0.45rem 0.65rem;
    background: color-mix(in srgb, #d92d20 14%, transparent);
    color: #962014;
    border-radius: var(--radius-md);
    font-size: 0.86rem;
  }
  .em-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--color-rule);
    margin-top: 0.35rem;
  }
  .em-btn {
    padding: 0.5rem 1.05rem;
    border-radius: var(--radius-md);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
  }
  .em-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .em-cancel {
    background: var(--color-surface);
    color: var(--color-fg);
    border: 1px solid var(--color-rule);
  }
  .em-cancel:hover:not(:disabled) {
    background: var(--color-bg);
  }
  .em-submit {
    background: var(--color-primary);
    color: #fff;
    border: 1px solid var(--color-primary);
  }
  .em-submit:hover:not(:disabled) {
    background: var(--color-primary-deep);
  }
  .em-delete {
    margin-right: auto;
    background: var(--color-surface);
    color: #962014;
    border: 1px solid color-mix(in srgb, #962014 40%, var(--color-rule));
  }
  .em-delete:hover:not(:disabled) {
    background: color-mix(in srgb, #962014 8%, var(--color-surface));
  }
</style>
