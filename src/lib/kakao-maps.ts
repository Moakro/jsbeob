/**
 * Kakao Maps JS SDK 싱글톤 로더.
 *
 * - SDK 스크립트를 페이지당 1회만 동적 삽입하고 promise를 캐시.
 * - 키는 client 노출용 `PUBLIC_KAKAO_JS_KEY` (Astro 규칙: import.meta.env.PUBLIC_*).
 * - 키 미설정/로드 실패는 reject로 던지므로 caller가 안내 메시지로 처리한다.
 *
 * 입력(admin)·표시(public) 두 곳이 공유한다. 배포본은 `libraries=services`(장소 검색/지오코더)를 함께 로드한다.
 */
// 복원(2026-11-01): 배포본 _astro/kakao-maps.*.js 기준. 배포 빌드에는 키가 들어 있어 hasKakaoKey()가 true 로 접혀 있었다.

// 최소 타입 — 전역 kakao 객체는 any로 취급
export type KakaoNamespace = any;

let loadPromise: Promise<KakaoNamespace> | null = null;

/** PUBLIC_KAKAO_JS_KEY 가 설정돼 있는지 (안내 분기용). */
export function hasKakaoKey(): boolean {
  return Boolean(import.meta.env.PUBLIC_KAKAO_JS_KEY);
}

export function loadKakaoMaps(): Promise<KakaoNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SSR 환경에서는 카카오맵을 로드할 수 없습니다."));
  }
  const w = window as any;
  if (w.kakao?.maps) return Promise.resolve(w.kakao);
  if (loadPromise) return loadPromise;

  const key = import.meta.env.PUBLIC_KAKAO_JS_KEY;
  loadPromise = new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error("PUBLIC_KAKAO_JS_KEY 가 설정되지 않았습니다."));
      return;
    }
    // 이미 삽입된 스크립트가 있으면 재사용 (autoload=false 이므로 load 콜백만 다시 건다)
    const existing = document.getElementById("kakao-maps-sdk") as HTMLScriptElement | null;
    const onReady = () => {
      try {
        w.kakao.maps.load(() => resolve(w.kakao));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    if (existing) {
      if (w.kakao?.maps?.load) onReady();
      else existing.addEventListener("load", onReady, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.id = "kakao-maps-sdk";
    s.async = true;
    s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    s.onload = onReady;
    s.onerror = () => reject(new Error("카카오맵 SDK 로드에 실패했습니다."));
    document.head.appendChild(s);
  });
  return loadPromise;
}
