<script lang="ts">
  // 로그인 모달 — /login 링크 클릭과 window 'jb:login' 이벤트를 가로채 페이지 이동 없이 띄운다.
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/LoginModal.*.js) 기준.
  import { onMount } from "svelte";
  import ModalFrame from "./ModalFrame.svelte";
  import LoginPanel from "./LoginPanel.svelte";

  let open = $state(false);
  let next = $state("/");

  const here = () => location.pathname + location.search + location.hash;
  /** 이 페이지 경로 — /login?next= 가 현재 페이지와 같으면 기본값(here)을 쓴다. */
  let pagePath = "";

  function show(n?: string | null) {
    next = n && n.startsWith("/") ? n : here();
    open = true;
  }

  onMount(() => {
    if (location.pathname.startsWith("/login")) return;
    pagePath = location.pathname + location.search;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !/^\/login\/?$/.test(url.pathname)) return;
      e.preventDefault();
      const n = url.searchParams.get("next");
      show(n && n !== pagePath ? n : null);
    };
    const onLogin = (e: Event) => show((e as CustomEvent).detail?.next);
    document.addEventListener("click", onClick, true);
    window.addEventListener("jb:login", onLogin);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("jb:login", onLogin);
    };
  });
</script>

<ModalFrame {open} onclose={() => (open = false)} label="로그인" title="로그인">
  <div class="lm">
    <p class="sub">카카오 또는 구글 계정으로 로그인하세요.</p>
    {#key next}
      <LoginPanel {next} />
    {/key}
  </div>
</ModalFrame>

<style>
  .lm {
    width: min(360px, 100%);
    margin: 0 auto;
    padding: 18px 20px 22px;
    text-align: center;
  }
  .sub {
    margin: 0 0 14px;
    color: var(--color-muted);
    font-size: 0.92rem;
  }
</style>
