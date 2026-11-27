<script lang="ts">
  // 공유 아이콘 — 점 세 개를 선으로 이은 표준 'share' 모양(Material share와 같은 꼴), 선 아이콘 (2026-11-27)
  let { size = 18 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
  ><circle cx="18" cy="5" r="2.6"></circle><circle cx="6" cy="12" r="2.6"></circle><circle cx="18" cy="19" r="2.6"
  ></circle><path d="M8.3 13.3l7.4 4.4M15.7 6.3l-7.4 4.4"></path></svg
>
