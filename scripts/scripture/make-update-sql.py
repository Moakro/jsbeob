#!/usr/bin/env python3
"""articles 장 글 본문 일괄 교체 SQL(적용·되돌리기) 만들기 (2026-11-28, 대순전경 구조화)

쓰는 법:
  python3 scripts/scripture/make-update-sql.py <원본 rows.json(운영)> <새 rows.json(로컬 import 결과)> <출력 폴더> [표식]

- 바꾸는 칸: body_md, body_html, body_blocks, meta, updated_at (제목·slug·status·sort_order·parent_id 는 그대로)
- D1 한 문장 길이 제한(100KB) 때문에 값을 임시 표(_scripture_stage)에 조각으로 이어 붙인 뒤,
  "조각이 다 들어왔는지(글자 수)"와 "운영 행이 그사이 바뀌지 않았는지(updated_at)"를 모두 확인한 행만 한 번에 바꾼다.
  중간에 끊겨도 원본 행은 그대로이고, 다시 실행하면 처음부터 새로 쌓는다.
- 되돌리기 SQL 은 원본 값으로 같은 방식으로 되돌린다(표식이 meta 에 있는 행만 = 이번 적용으로 바뀐 행).
"""
import json
import sys
from pathlib import Path

CHUNK = 15000  # 글자(한글 3바이트 → 약 45KB)


def load(p):
    raw = Path(p).read_text(encoding="utf-8")
    raw = raw[min(i for i in (raw.find("["), raw.find("{")) if i >= 0):]
    d = json.loads(raw)
    if isinstance(d, list) and d and "results" in d[0]:
        d = d[0]["results"]
    return {r["id"]: r for r in d}


def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def stage_sql(rows, guard_sql_for, title):
    out = [f"-- {title}", "DROP TABLE IF EXISTS _scripture_stage;",
           "CREATE TABLE _scripture_stage (id TEXT PRIMARY KEY, body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',"
           " body_blocks TEXT NOT NULL DEFAULT '', meta TEXT, updated_at TEXT, n_md INTEGER, n_html INTEGER, n_blocks INTEGER, guard TEXT);"]
    for r in rows:
        out.append(
            f"INSERT INTO _scripture_stage (id, meta, updated_at, n_md, n_html, n_blocks, guard) VALUES ({q(r['id'])}, {q(r['meta'])}, "
            f"{q(r.get('updated_at'))}, {len(r['body_md'] or '')}, {len(r['body_html'] or '')}, {len(r['body_blocks'] or '')}, {q(guard_sql_for(r))});")
        for col in ("body_md", "body_html", "body_blocks"):
            v = r[col] or ""
            for i in range(0, len(v), CHUNK):
                out.append(f"UPDATE _scripture_stage SET {col} = {col} || {q(v[i:i + CHUNK])} WHERE id={q(r['id'])};")
    return out


def finish_sql(where_extra, set_updated):
    upd = "datetime('now')" if set_updated else "(SELECT s.updated_at FROM _scripture_stage s WHERE s.id=articles.id)"
    return [
        "UPDATE articles SET",
        "  body_md=(SELECT s.body_md FROM _scripture_stage s WHERE s.id=articles.id),",
        "  body_html=(SELECT s.body_html FROM _scripture_stage s WHERE s.id=articles.id),",
        "  body_blocks=(SELECT s.body_blocks FROM _scripture_stage s WHERE s.id=articles.id),",
        "  meta=(SELECT s.meta FROM _scripture_stage s WHERE s.id=articles.id),",
        f"  updated_at={upd}",
        "WHERE id IN (SELECT s.id FROM _scripture_stage s JOIN articles a ON a.id=s.id",
        "  WHERE length(s.body_md)=s.n_md AND length(s.body_html)=s.n_html AND length(s.body_blocks)=s.n_blocks",
        f"  AND {where_extra});",
        "DROP TABLE _scripture_stage;",
    ]


def main():
    orig_p, new_p, out_dir = sys.argv[1:4]
    marker = sys.argv[4] if len(sys.argv) > 4 else "jsbooks-md 2026-11-28"
    orig, new = load(orig_p), load(new_p)
    ids = [i for i in new if i in orig]
    missing = [i for i in new if i not in orig]
    if missing:
        sys.exit(f"원본에 없는 id: {missing}")
    ids.sort(key=lambda i: orig[i]["sort_order"])
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    head = [f"-- 대상: articles {len(ids)}행 — " + ", ".join(orig[i]["slug"] for i in ids)]

    # 적용: 운영 행의 updated_at 이 원본 내려받을 때와 같을 때만(그사이 누가 고쳤으면 건너뜀)
    apply_rows = [{**new[i], "updated_at": orig[i]["updated_at"]} for i in ids]
    apply = head + stage_sql(apply_rows, lambda r: None, "적용: 구조화 본문으로 교체") + finish_sql(
        "a.updated_at=s.updated_at", set_updated=True)
    (out / "apply.sql").write_text("\n".join(apply) + "\n", encoding="utf-8")

    # 되돌리기: 이번 적용 표식이 meta 에 있는 행만 원본 값(updated_at 포함)으로
    back_rows = [orig[i] for i in ids]
    back = head + stage_sql(back_rows, lambda r: None, "되돌리기: 옛 게시판 본문으로") + finish_sql(
        f"a.meta LIKE {q('%' + marker + '%')}", set_updated=False)
    (out / "rollback.sql").write_text("\n".join(back) + "\n", encoding="utf-8")

    verify = [
        "SELECT slug, title, status, sort_order, length(body_md) AS md, length(body_html) AS html, length(body_blocks) AS blocks,",
        f"  (meta LIKE {q('%' + marker + '%')}) AS structured, updated_at FROM articles",
        "WHERE id IN (" + ", ".join(q(i) for i in ids) + ") ORDER BY sort_order;",
    ]
    (out / "verify.sql").write_text("\n".join(verify) + "\n", encoding="utf-8")
    exp = ["slug\tmd\thtml\tblocks (적용 후 기대값 / 되돌린 후 기대값)"]
    for i in ids:
        n, o = new[i], orig[i]
        exp.append(f"{o['slug']}\t{len(n['body_md'])}/{len(o['body_md'])}\t{len(n['body_html'])}/{len(o['body_html'])}\t"
                   f"{len(n['body_blocks'])}/{len(o['body_blocks'] or '')}")
    (out / "expected.tsv").write_text("\n".join(exp) + "\n", encoding="utf-8")
    for f in ("apply.sql", "rollback.sql"):
        p = out / f
        longest = max(len(l.encode()) for l in p.read_text(encoding="utf-8").splitlines())
        print(f"{p} {p.stat().st_size // 1024}KB, 가장 긴 문장 {longest // 1024}KB")


if __name__ == "__main__":
    main()
