// AI 부르기 — 오너 구독 Claude Code(`claude -p`) 비대화형 실행 (2026-11-27)
//
// 갈아 끼우는 자리: extract(ctx, opts) → { extracted, model, input_tokens, output_tokens }
//   ctx  = intake-draft.mjs 의 ctx (uploadedAt, hint, note, url, files:[{path, name, content_type}])
//   opts = { dir(파일을 받아 둔 임시 폴더), model, timeoutMs, log }
// 다른 방식(예: API 키로 Messages API 직접 호출)은 같은 모양의 모듈을 extractors/ 에 더하고
// INTAKE_EXTRACTOR 로 고르면 된다 — 지시문·답의 틀·조립·결과 쓰기는 그대로 공유한다.
//
// 안전장치
//   --restricted      명령 실행 도구·웹 가져오기를 빼고, 사용자·프로젝트 설정(훅 포함)을 읽지 않으며, 파일 도구를 작업 폴더(임시 폴더) 안으로 가둔다
//   --tools Read      쓸 수 있는 도구는 Read 하나 (+ 답을 내는 StructuredOutput)
//   --strict-mcp-config  MCP 서버를 하나도 붙이지 않는다
//   --permission-mode dontAsk --permission-prompts none  묻는 대신 거절
//   --no-session-persistence  대화 기록을 디스크에 남기지 않는다(공문 내용이 세션 기록에 쌓이지 않게)
//   --json-schema     답을 정해진 틀로 받는다(그래도 감시 서비스가 한 번 더 검사)
//   ANTHROPIC_API_KEY 는 넘기지 않는다 — 구독 로그인으로만 돈다
import { spawn } from "node:child_process";
import { EXTRACT_SCHEMA, buildSystemPrompt, buildUserPrompt } from "../../../jsbeob-api/intake-draft.mjs";

export const name = "claude-cli";

export async function extract(ctx, opts) {
  const bin = process.env.CLAUDE_BIN || "claude";
  const args = [
    "-p",
    "--restricted",
    "--tools", "Read",
    "--allowedTools", "Read",
    "--strict-mcp-config",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--output-format", "json",
    "--model", opts.model,
    "--system-prompt", buildSystemPrompt(ctx),
    "--json-schema", JSON.stringify(EXTRACT_SCHEMA),
  ];
  if (process.env.INTAKE_EFFORT) args.push("--effort", process.env.INTAKE_EFFORT);
  args.push(buildUserPrompt(ctx));

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const { code, stdout, stderr, timedOut } = await run(bin, args, { cwd: opts.dir, env, timeoutMs: opts.timeoutMs });
  if (timedOut) throw new ExtractError(`AI 읽기 시간 초과(${Math.round(opts.timeoutMs / 1000)}초)`);
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new ExtractError(`claude 출력이 JSON 이 아닙니다 (종료 코드 ${code}) ${tail(stderr || stdout)}`);
  }
  if (out.is_error || out.subtype !== "success") {
    throw new ExtractError(`claude 오류: ${out.subtype ?? ""} ${tail(out.result ?? out.api_error_status ?? stderr)}`);
  }
  if (!out.structured_output || typeof out.structured_output !== "object") {
    throw new ExtractError("claude 가 정해진 틀의 답(structured_output)을 내지 않았습니다");
  }
  const u = out.usage ?? {};
  return {
    extracted: out.structured_output,
    model: opts.model,
    input_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output_tokens: u.output_tokens ?? null,
    // 구독이라 실제 청구는 없지만, 같은 일을 API 키로 했을 때의 값(비교용)
    cost_usd: typeof out.total_cost_usd === "number" ? out.total_cost_usd : null,
    denied: (out.permission_denials ?? []).map((d) => d.tool_name),
  };
}

export class ExtractError extends Error {}

function run(bin, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // detached: 시간 초과 때 claude 가 띄운 하위 프로세스까지 프로세스 그룹째 끈다
    const p = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "", stderr = "", timedOut = false;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const kill = (sig) => {
      try {
        process.kill(-p.pid, sig);
      } catch {}
    };
    const t = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    run.current = () => kill("SIGTERM");
    p.on("error", (e) => {
      clearTimeout(t);
      reject(new ExtractError(`claude 를 실행하지 못했습니다: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      run.current = null;
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
/** 감시 서비스가 꺼질 때 돌고 있는 claude 도 끈다 */
export function stop() {
  run.current?.();
}

function tail(s) {
  return String(s ?? "").trim().slice(-300);
}
