#!/usr/bin/env python3
"""crossref_source_gate.py — 대조 착수 전 '뇌 색인이 실제로 보이는가'를 결정론 확인한다.

왜 있나 (2026-08-23 진단):
  context-mode 지식베이스는 프로젝트 디렉터리마다 갈린다 —
      ~/.claude/context-mode/content/<sha256(projectDir.replace('\\','/'))[:16]>.db
  체인은 대조 에이전트를 {PROJECT_ROOT} 에서 돌리는데 뇌(brain-corpus-D)는
  {WORK_ROOT} KB 에만 색인돼 있었다. 그래서 질의가 아무리 정확해도 전량 "No results found" 였고,
  그 결과가 §1.6 의 정상 경로인 '무적중 → 전 항목 keep' 과 **같은 출력으로 뭉개져** 1년 가까이 안 보였다.
  이 게이트는 그 둘을 갈라놓는다: "찾아봤는데 없다"(정상) vs "찾아볼 곳이 없었다"(결함).

  ⚠ 이 게이트가 없으면 A(양쪽 색인)를 해도 다음에 KB가 갈리는 순간 똑같이 조용히 0이 된다.

usage:
  python crossref_source_gate.py --project-dir <dir> --source <label> [--bundle <path>] [--json <out>]

exit code:
  0  OK        — 색인 존재 + (번들 대비) 최신
  3  MISSING   — 그 KB 에 해당 source 없음
  4  STALE     — 번들이 색인보다 새로움(재색인 필요)
  5  NO_KB     — KB 파일 자체가 없음
  1  오류
"""
import argparse
import datetime
import hashlib
import json
import os
import sqlite3
import sys

CONTENT_DIR = os.path.join(
    os.path.expanduser("~"), ".claude", "context-mode", "content")


def kb_hash(project_dir: str) -> str:
    """context-mode 와 동일 산식: 역슬래시 정규화 후 sha256 앞 16자."""
    norm = project_dir.replace("\\", "/")
    return hashlib.sha256(norm.encode()).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-dir", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--bundle", default="")
    ap.add_argument("--json", dest="json_out", default="")
    a = ap.parse_args()

    h = kb_hash(a.project_dir)
    db = os.path.join(CONTENT_DIR, f"{h}.db")
    out = {
        "project_dir": a.project_dir,
        "kb_hash": h,
        "kb_path": db,
        "source": a.source,
        "status": None,
        "source_id": None,
        "chunk_count": 0,
        "indexed_at": None,
        "bundle": a.bundle,
        "bundle_mtime": None,
    }

    def finish(status, code):
        out["status"] = status
        if a.json_out:
            with open(a.json_out, "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
        print(json.dumps(out, ensure_ascii=False))
        return code

    if not os.path.exists(db):
        return finish("NO_KB", 5)

    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        # source 는 부분일치로 찾는다 — ctx_search 의 source 필터와 같은 관용
        row = con.execute(
            "SELECT id, chunk_count, indexed_at FROM sources "
            "WHERE label = ? OR label LIKE ? ORDER BY chunk_count DESC LIMIT 1",
            (a.source, f"%{a.source}%"),
        ).fetchone()
        con.close()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({**out, "status": "ERROR", "error": str(e)}, ensure_ascii=False))
        return 1

    if not row:
        return finish("MISSING", 3)

    out["source_id"], out["chunk_count"], out["indexed_at"] = row

    if a.bundle and os.path.exists(a.bundle):
        bm = datetime.datetime.fromtimestamp(os.path.getmtime(a.bundle))
        out["bundle_mtime"] = bm.strftime("%Y-%m-%d %H:%M:%S")
        try:
            # context-mode 는 sources.indexed_at 을 UTC 로 적는다. 번들 mtime 은 로컬시라
            # 그대로 비교하면 KST(UTC+9) 만큼 색인이 과거로 보여 재색인 직후에도 STALE 이
            # 된다 — 즉 번들을 9시간 안에 재생성하면 대조가 영구히 꺼진다(2026-08-25 실측:
            # 재색인 성공 직후 indexed_at=08-24 16:07 vs bundle_mtime=08-25 00:53 → STALE).
            # 비교는 UTC 로 맞추고, 출력용 bundle_mtime 은 사람이 읽는 로컬시로 유지한다.
            bm_utc = datetime.datetime.utcfromtimestamp(os.path.getmtime(a.bundle))
            idx = datetime.datetime.strptime(str(row[2])[:19], "%Y-%m-%d %H:%M:%S")
            if bm_utc > idx:
                return finish("STALE", 4)
        except ValueError:
            pass  # 시각 파싱 실패는 신선도 판정 포기(비차단)

    return finish("OK", 0)


if __name__ == "__main__":
    sys.exit(main())
