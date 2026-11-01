// 썸네일 자르기(초점·확대) — 관리자 편집기(AdminApp)와 카드 썸네일(Thumb.astro)이 함께 쓴다.
// 복원: 추정 — 파일 위치·이름. 같은 코드가 서버 Thumb chunk와 클라이언트 AdminApp.*.js에 각각 인라인돼 있어
//        Thumb.astro·AdminApp 두 곳에서만 import하는 별도 모듈로 판단했다.

/** x·y: 초점 위치(%), z: 확대 배율 */
export interface Crop {
  x: number;
  y: number;
  z: number;
}

export const CROP_DEFAULT: Crop = { x: 50, y: 50, z: 1 };

/** <img style>에 넣는 object-position + scale */
export function cropStyle(c?: Crop | null): string {
  const { x, y, z } = c ?? CROP_DEFAULT;
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${z})`;
}
