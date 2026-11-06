// 주소 입력 도우미 — 카카오(다음) 우편번호 서비스로 주소를 고르고, 카카오 지도 SDK 로 좌표를 구한다.
// 우편번호 서비스는 키가 필요 없다. 좌표 변환은 PUBLIC_KAKAO_JS_KEY(지도와 같은 키)가 있어야 한다.
import { loadKakaoMaps } from "./kakao-maps";

const POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
let postcodePromise: Promise<any> | null = null;

function loadPostcode(): Promise<any> {
  const w = window as any;
  if (w.daum?.Postcode) return Promise.resolve(w.daum);
  if (postcodePromise) return postcodePromise;
  postcodePromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = POSTCODE_SRC;
    s.async = true;
    s.onload = () => resolve(w.daum);
    s.onerror = () => {
      postcodePromise = null;
      reject(new Error("우편번호 서비스를 불러오지 못했습니다"));
    };
    document.head.appendChild(s);
  });
  return postcodePromise;
}

export interface PickedAddress {
  postcode: string;
  /** 도로명 주소(없으면 지번) */
  address: string;
  /** 참고 항목: 건물명·법정동 — 상세 주소 칸 기본값으로 쓴다 */
  extra: string;
}

/** 우편번호 검색 창(팝업)을 띄워 주소 하나를 고른다. 닫으면 null. */
export async function pickAddress(): Promise<PickedAddress | null> {
  const daum = await loadPostcode();
  return new Promise((resolve) => {
    let done = false;
    new daum.Postcode({
      oncomplete(data: any) {
        done = true;
        const extra = [data.bname && /[동로가]$/.test(data.bname) ? data.bname : "", data.buildingName]
          .filter(Boolean)
          .join(", ");
        resolve({
          postcode: data.zonecode ?? "",
          address: data.roadAddress || data.jibunAddress || data.address,
          extra: extra ? `(${extra})` : "",
        });
      },
      onclose() {
        if (!done) resolve(null);
      },
    }).open();
  });
}

/** 주소 → 좌표. 못 찾으면 null. 키가 없으면 예외. */
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const kakao = await loadKakaoMaps();
  const geocoder = new kakao.maps.services.Geocoder();
  return new Promise((resolve) => {
    geocoder.addressSearch(address, (result: any[], status: string) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: Number(Number(result[0].y).toFixed(6)), lng: Number(Number(result[0].x).toFixed(6)) });
      } else resolve(null);
    });
  });
}
