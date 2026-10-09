#!/usr/bin/env python3
"""s0_prepare.py — tc-team S0(준비)를 LLM 없이 (2026-10-01, Loki Codex 이식).

Claude 경로의 S0 는 `claude -p` 한 턴이 MCP 로 Confluence·시트를 읽고 파일을 썼다.
여기는 같은 계약을 결정론으로 지킨다 — Codex 경로에 claude 가 남지 않게.

  1. Confluence 페이지 ID ← URL, 제목 ← REST (lib/confluence_fetch.py)
  2. 기능명 = 제목 스네이크케이스 ("인벤토리 1차 개선" → "인벤토리_1차_개선"), 또는 --feature
  3. 그 이름의 탭이 시트에 있으면 _v2, _v3 … (lib/list_tabs.js, 읽기 전용) — 탭을 못 읽으면 실패
  4. team/specs/<기능명>/ 에 confluence_raw.md(≥1KB) · sheet_info.txt(4필드)
  5. 마지막 줄: S0_DONE {"feature": ..., "sheet_id": ...}

--preflight 는 네트워크·쓰기 없이 입력 파싱과 의존(자격 로더·node·googleapis)만 확인한다.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]
LIB = PROJECT_ROOT / "tc-team" / "lib"
SPECS = PROJECT_ROOT / "team" / "specs"
sys.path.insert(0, str(LIB))

_SHEET_ID = re.compile(r"/spreadsheets/d/([A-Za-z0-9_-]+)")
_BAD = re.compile(r"[\\/:*?\"<>|\[\]\x00-\x1f]+")


def feature_name(title: str) -> str:
    name = _BAD.sub(" ", title or "").strip()
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_.")
    return name[:80]


def pick_versioned(base: str, tabs: list[str]) -> str:
    taken = {t.strip() for t in tabs}
    if base not in taken:
        return base
    n = 2
    while f"{base}_v{n}" in taken:
        n += 1
    return f"{base}_v{n}"


def list_tabs(sheet_id: str) -> list[str]:
    r = subprocess.run(["node", str(LIB / "list_tabs.js"), sheet_id],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "list_tabs 실패").strip()[:300])
    tabs = json.loads(r.stdout.strip().splitlines()[-1])
    if not isinstance(tabs, list):
        raise RuntimeError("list_tabs 출력이 배열이 아님")
    return [str(t) for t in tabs]


def write_sheet_info(spec_dir: Path, sheet_id: str, feature: str, conf_url: str) -> None:
    (spec_dir / "sheet_info.txt").write_text(
        f"SHEET_ID={sheet_id}\nTAB_NAME={feature}\n"
        f'CONFLUENCE_URL="{conf_url}"\nFEATURE_NAME={feature}\n', encoding="utf-8")


def preflight(sheet_url: str, conf_url: str) -> list[str]:
    problems = []
    import confluence_fetch
    if not _SHEET_ID.search(sheet_url or ""):
        problems.append("시트 URL 에서 ID 를 못 찾음")
    if not confluence_fetch.page_id_of(conf_url):
        problems.append("Confluence URL 에서 페이지 ID 를 못 찾음")
    if not confluence_fetch.CRED_MODULE.is_file():
        problems.append(f"자격 로더 없음: {confluence_fetch.CRED_MODULE}")
    r = subprocess.run(["node", "-e", "require.resolve('googleapis')"],
                       capture_output=True, text=True, cwd=str(LIB))
    if r.returncode != 0:
        problems.append("node googleapis 를 못 찾음")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-url", required=True)
    ap.add_argument("--conf-url", required=True)
    ap.add_argument("--feature", help="기능명 지정(없으면 Confluence 제목)")
    ap.add_argument("--preflight", action="store_true")
    a = ap.parse_args(argv)

    if a.preflight:
        problems = preflight(a.sheet_url, a.conf_url)
        print(json.dumps({"preflight": "ok" if not problems else "fail",
                          "problems": problems}, ensure_ascii=False))
        return 1 if problems else 0

    import confluence_fetch
    m = _SHEET_ID.search(a.sheet_url)
    page_id = confluence_fetch.page_id_of(a.conf_url)
    if not m or not page_id:
        print("S0_FAIL 입력 URL 파싱 실패", file=sys.stderr)
        return 1
    sheet_id = m.group(1)
    base = feature_name(a.feature) if a.feature else feature_name(confluence_fetch.title_of(page_id))
    if not base:
        print("S0_FAIL 기능명이 비었음", file=sys.stderr)
        return 1
    feature = pick_versioned(base, list_tabs(sheet_id))
    spec_dir = SPECS / feature
    meta = confluence_fetch.write_spec(page_id, spec_dir)
    if meta["body_bytes"] < confluence_fetch.MIN_RAW_BYTES:
        print(f"S0_FAIL confluence_raw.md {meta['body_bytes']}B < 1KB", file=sys.stderr)
        return 1
    write_sheet_info(spec_dir, sheet_id, feature, a.conf_url)
    print("S0_DONE " + json.dumps({"feature": feature, "sheet_id": sheet_id},
                                  ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
