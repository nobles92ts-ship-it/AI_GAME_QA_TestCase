#!/usr/bin/env python3
"""인수 게이트 — 서브에이전트 산출물이 '실재하는지'를 결정론으로 확인한다.

에이전트의 "완료했습니다" 보고는 증거가 아니다. 출력 토큰 상한을 소진하면
rc=0 으로 조용히 끝나며(tc-team 실사고: 88.3분 손실), 다음 단계는 잘린 입력을
정상으로 받는다. 이 스크립트는 그 사이에 들어가는 결정론 검사다.

사용:
  python handoff_gate.py md   <path> [--min-bytes N] [--require "문자열" ...]
  python handoff_gate.py json <path> [--require-key KEY ...]
  python handoff_gate.py html <path>
  python handoff_gate.py tree <dir> --glob "tests/test_*.py" [--min-count N]

종료코드: 0=통과, 1=FAIL(다음 단계 진입 금지), 2=사용법 오류
"""
import sys, json, glob as globmod, argparse
from pathlib import Path

# 이 환경은 산출물 경로가 전부 한글이다. 콘솔 기본 CP949로 두면 경로가 깨져
# "어느 파일이 실패했는지"를 못 읽는다 — 게이트의 존재 이유가 사라진다.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

MIN_BYTES_DEFAULT = 1024  # tc-team 자가검증 하한 이식. 실측 최소 실물 산출물 2,494B = 여유 2.4배

fails, warns = [], []


def check_common(p: Path, min_bytes: int) -> bytes | None:
    if not p.exists():
        fails.append(f"파일 없음: {p}")
        return None
    if p.is_dir():
        fails.append(f"파일이 아니라 디렉터리: {p}")
        return None
    raw = p.read_bytes()
    if len(raw) == 0:
        fails.append(f"0바이트: {p}")
        return None
    if len(raw) < min_bytes:
        fails.append(f"최소 크기 미달: {len(raw)}B < {min_bytes}B — {p}")
        return None
    return raw


def check_md(p: Path, min_bytes: int, require: list[str]) -> None:
    raw = check_common(p, min_bytes)
    if raw is None:
        return
    text = raw.decode("utf-8", errors="replace")

    # 절단 흔적 ① 코드펜스 홀수 = 열고 안 닫힘
    if text.count("```") % 2 != 0:
        fails.append(f"절단 흔적(코드펜스 홀수 {text.count('```')}개): {p}")

    lines = [ln for ln in text.splitlines() if ln.strip()]
    if lines:
        last = lines[-1].rstrip()
        # 절단 흔적 ② 표 행이 시작만 하고 안 닫힘
        if last.startswith("|") and not last.endswith("|"):
            fails.append(f"절단 흔적(표 행 미완결): {p} — {last[:60]!r}")
        # 절단 흔적 ③ 끝 개행 없음 = 쓰다 끊긴 정황 (경고)
        if not text.endswith("\n"):
            warns.append(f"끝 개행 없음(절단 가능): {p}")

    for token in require:
        if token not in text:
            fails.append(f"필수 마커 없음 {token!r}: {p}")


def check_json(p: Path, min_bytes: int, keys: list[str]) -> None:
    raw = check_common(p, min_bytes)
    if raw is None:
        return
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        fails.append(f"JSON 파싱 실패({e.__class__.__name__}: {e}): {p}")
        return
    if keys and not isinstance(data, dict):
        fails.append(f"최상위가 객체가 아님(키 검사 불가): {p}")
        return
    for k in keys:
        if k not in data:
            fails.append(f"필수 키 없음 {k!r}: {p}")


def check_html(p: Path, min_bytes: int) -> None:
    raw = check_common(p, min_bytes)
    if raw is None:
        return
    text = raw.decode("utf-8", errors="replace")
    if "</html>" not in text.lower():
        fails.append(f"절단 흔적(</html> 없음): {p}")


def check_tree(d: Path, pattern: str, min_count: int) -> None:
    if not d.is_dir():
        fails.append(f"디렉터리 없음: {d}")
        return
    hits = [Path(x) for x in globmod.glob(str(d / pattern), recursive=True)]
    nonempty = [h for h in hits if h.is_file() and h.stat().st_size > 0]
    if len(nonempty) < min_count:
        fails.append(
            f"산출 파일 부족: {pattern} 비어있지않은 {len(nonempty)}개 < {min_count}개 — {d}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("kind", choices=["md", "json", "html", "tree"])
    ap.add_argument("path")
    ap.add_argument("--min-bytes", type=int, default=MIN_BYTES_DEFAULT)
    ap.add_argument("--require", action="append", default=[])
    ap.add_argument("--require-key", action="append", default=[])
    ap.add_argument("--glob", default="**/*")
    ap.add_argument("--min-count", type=int, default=1)
    a = ap.parse_args()

    p = Path(a.path)
    if a.kind == "md":
        check_md(p, a.min_bytes, a.require)
    elif a.kind == "json":
        check_json(p, a.min_bytes, a.require_key)
    elif a.kind == "html":
        check_html(p, a.min_bytes)
    else:
        check_tree(p, a.glob, a.min_count)

    for w in warns:
        print(f"WARN  {w}")
    if fails:
        for f in fails:
            print(f"FAIL  {f}")
        print(f"\n인수 게이트 실패 {len(fails)}건 — 다음 단계 진입 금지.")
        print("조치: 해당 에이전트 1회 재호출 → 재실패 시 중단하고 사용자에게 보고.")
        return 1
    print(f"PASS  {a.kind}: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
