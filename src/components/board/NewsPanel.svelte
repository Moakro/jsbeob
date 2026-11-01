<script>
  // 도생광장 '소식' 탭 — 소식 목록에서 고르면 소식 모달을 연다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/NewsPanel.*.js) 기준. 원본은 runes 를 쓰지 않는(legacy) 컴포넌트였다.
  import NewsList from "./NewsList.svelte";
  import { NEWS_OPEN_EVENT } from "../../lib/api";
</script>

<NewsList onpick={(id) => window.dispatchEvent(new CustomEvent(NEWS_OPEN_EVENT, { detail: { id } }))} />
