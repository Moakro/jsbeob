// 음성 입력(Web Speech API) — 모바일(터치)에서만 쓴다. 치명적인 오류가 한 번 나면 이번 방문 동안 끈다.
// 복원(2026-11-01): 배포본 _astro/AiChatDrawer.*.js 에 인라인된 모듈. 파일 이름·함수 이름은 추정.

let disabled = false;

function Recognition(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** 음성 입력을 보여 줄지 — 지원 브라우저 + 보안 출처 + 터치 기기 */
export function canUseVoice(): boolean {
  if (disabled || !Recognition() || window.isSecureContext === false) return false;
  return !!window.matchMedia?.("(pointer: coarse)").matches;
}

function disableVoice() {
  disabled = true;
}

const FATAL: Record<string, string> = {
  "not-allowed": "마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.",
  "service-not-allowed": "이 브라우저에서는 음성 입력을 쓸 수 없습니다.",
  "audio-capture": "마이크를 찾지 못했습니다.",
};

export interface VoiceHandlers {
  /** 지금까지 인식한 글(확정 + 임시) */
  onText?: (text: string) => void;
  /** 끝남 — 확정된 글(취소면 "") */
  onEnd: (finalText: string) => void;
  /** 다시 쓸 수 없는 오류 */
  onFatal?: (message: string) => void;
}

/** 한 번 듣기 시작. 시작하지 못하면 null. */
export function startVoice(h: VoiceHandlers): { stop(): void; abort(): void } | null {
  const R = Recognition();
  if (!R) return null;
  let rec: any;
  try {
    rec = new R();
  } catch {
    disableVoice();
    h.onFatal?.("음성 입력을 쓸 수 없습니다.");
    return null;
  }
  rec.lang = "ko-KR";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let live = true;
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    h.onText?.(finalText + interim);
  };
  rec.onerror = (e: any) => {
    const code = e?.error;
    if (!code || code === "aborted" || code === "no-speech") return;
    if (FATAL[code]) {
      disableVoice();
      h.onFatal?.(FATAL[code]);
    }
  };
  rec.onend = () => {
    if (live) {
      live = false;
      h.onEnd(finalText.trim());
    }
  };
  try {
    rec.start();
  } catch {
    live = false;
    disableVoice();
    h.onFatal?.("음성 입력을 쓸 수 없습니다.");
    return null;
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {}
    },
    abort() {
      live = false;
      rec.onresult = rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {}
      h.onEnd("");
    },
  };
}
