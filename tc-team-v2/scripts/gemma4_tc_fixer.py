"""
gemma4_tc_fixer.py (v2 — 처방 기반)
리뷰 보고서의 '처방:' 필드를 파싱하여 fix JSON 생성.
Gemma4는 재현스탭 초안→완성 문장 변환만 담당. 판단 없음.

사용법:
  python gemma4_tc_fixer.py --review <path> --snapshot <path> --output <path>
"""

import argparse
import json
import re
import sys
from pathlib import Path

from gemma4_utils import call_ollama, GEMMA4_MODEL

GEMMA4_RULES_PATH = os.environ.get('CLAUDE_HOME', '') + '/tc-team-v2/skills/gemma4/gemma4-fixer.md'


def load_gemma4_rules():
    """gemma4-fixer.md 로드 (Gemma4 코더 규칙 SSoT)"""
    import re
    p = Path(GEMMA4_RULES_PATH)
    if not p.exists():
        print(f"  WARN: gemma4-fixer.md 없음 — 내장 규칙 사용", file=sys.stderr)
        return ""
    content = p.read_text(encoding="utf-8")
    content = re.sub(r"^---[\s\S]*?---\n", "", content).strip()
    print(f"  Gemma4 규칙 로드 완료: {GEMMA4_RULES_PATH} ({len(content)}자)")
    return content

# 열 이름 → field 이름 매핑 (apply_gemma4_fixes.js 호환)
FIELD_MAP = {
    "B열": "대분류",
    "C열": "중분류",
    "D열": "소분류",
    "E열": "검증단계",
    "F열": "재현스탭",
    "G열": "플랫폼",
    "H열": "PC결과",
    "I열": "모바일결과",
    "J열": "비고",
}


def parse_prescriptions(review_text):
    """리뷰 보고서에서 '처방:' 줄을 모두 추출."""
    prescriptions = []
    for line in review_text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("처방:"):
            p = stripped[3:].strip()
            if p:
                prescriptions.append(p)
    return prescriptions


_gemma4_rules_cache = None

def complete_step_with_gemma4(draft, context=""):
    """재현스탭 초안 1줄 → [사전조건]+[행동]+[기대결과] 완성 문장 1줄."""
    global _gemma4_rules_cache
    if _gemma4_rules_cache is None:
        _gemma4_rules_cache = load_gemma4_rules()

    if _gemma4_rules_cache:
        rules_block = _gemma4_rules_cache
    else:
        rules_block = (
            "규칙:\n"
            "- 추상 표현('정상 동작', '올바르게', '제대로' 등) 절대 금지\n"
            "- 플랫폼 언급('PC에서', '모바일에서' 시작) 금지\n"
            "- 1문장만 출력 (따옴표/마크다운 없이)\n"
            "- 형식: ~상태에서 ~하면 ~가 발생하는지 확인"
        )

    prompt = (
        f"{rules_block}\n\n"
        f"초안: {draft}\n"
        + (f"컨텍스트: {context}\n" if context else "")
        + "\n한 줄 완성 문장만 출력:"
    )
    response = call_ollama(prompt, temperature=0.1)
    if response is None:
        print("  WARN: Gemma4 호출 실패 — 초안 그대로 사용", file=sys.stderr)
        return draft
    return response.strip().strip('"').strip("'")


def prescription_to_fix(prescription, existing_tc_ids):
    """처방 문장 1줄 → fix dict (파싱 불가 시 None)."""

    # ── TC-XXX 삭제 ──────────────────────────────────────────
    m = re.match(r"TC-?(\d+)\s+삭제", prescription)
    if m:
        tc_id = m.group(1).zfill(3)
        if tc_id not in existing_tc_ids:
            print(f"  SKIP: TC ID {tc_id} 없음", file=sys.stderr)
            return None
        return {"action": "delete", "tc_id": tc_id}

    # ── TC-XXX [열] 수정 — '[현재]' → '[새값/초안]' ───────────
    m = re.match(
        r"TC-?(\d+)\s+([A-J]열)\s+수정\s+[—\-]+\s*'[^']*'\s*→\s*'([^']+)'",
        prescription,
    )
    if m:
        tc_id = m.group(1).zfill(3)
        col = m.group(2)
        new_val = m.group(3).strip()
        field = FIELD_MAP.get(col)
        if not field:
            print(f"  SKIP: 알 수 없는 열 '{col}'", file=sys.stderr)
            return None
        if tc_id not in existing_tc_ids:
            print(f"  SKIP: TC ID {tc_id} 없음", file=sys.stderr)
            return None
        # F열(재현스탭) → Gemma4로 초안 완성
        if col == "F열":
            new_val = complete_step_with_gemma4(new_val, f"TC-{tc_id}")
        return {"action": "update", "tc_id": tc_id, "field": field, "value": new_val}

    # ── TC-XXX [열] 추가 — '[값]' ─────────────────────────────
    m = re.match(
        r"TC-?(\d+)\s+([A-J]열)\s+추가\s+[—\-]+\s*'([^']+)'",
        prescription,
    )
    if m:
        tc_id = m.group(1).zfill(3)
        col = m.group(2)
        val = m.group(3).strip()
        field = FIELD_MAP.get(col)
        if not field:
            return None
        if tc_id not in existing_tc_ids:
            print(f"  SKIP: TC ID {tc_id} 없음", file=sys.stderr)
            return None
        return {"action": "update", "tc_id": tc_id, "field": field, "value": val}

    # ── '[소분류]' 소분류에 신규 TC 추가 ─────────────────────────
    m = re.match(
        r"'([^']+)'\s+소분류에\s+신규\s+TC\s+추가\s+[—\-]+\s*"
        r"검증단계:\s*(\S+)[,\s]+플랫폼:\s*([^,\n]+)[,\s]+재현스탭\s*초안:\s*'([^']+)'",
        prescription,
    )
    if m:
        sub = m.group(1).strip()
        stage = m.group(2).strip().rstrip(",")
        platform = m.group(3).strip().rstrip(",")
        draft = m.group(4).strip()
        completed = complete_step_with_gemma4(draft, f"소분류: {sub}, 검증단계: {stage}")
        return {
            "action": "add",
            "after_tc_id": "last",
            "sub_category": sub,          # apply_gemma4_fixes.js가 삽입 위치 탐색에 사용
            "data": ["", "", sub, stage, platform, completed, ""],
        }

    print(f"  SKIP: 처방 형식 인식 불가 — {prescription[:80]}", file=sys.stderr)
    return None


def main():
    parser = argparse.ArgumentParser(description="처방 기반 TC 수정 지시 생성기 v2")
    parser.add_argument("--review", required=True, help="리뷰 MD 파일 경로")
    parser.add_argument("--snapshot", required=True, help="tc_snapshot.json 경로")
    parser.add_argument("--output", required=True, help="출력 JSON 경로")
    parser.add_argument("--feature", default="", help="기능명")
    args = parser.parse_args()

    review_path = Path(args.review)
    snapshot_path = Path(args.snapshot)

    if not review_path.exists():
        print(f"ERROR: 리뷰 파일 없음: {review_path}", file=sys.stderr)
        sys.exit(1)
    if not snapshot_path.exists():
        print(f"ERROR: 스냅샷 파일 없음: {snapshot_path}", file=sys.stderr)
        sys.exit(1)

    review_text = review_path.read_text(encoding="utf-8")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = snapshot.get("rows", [])
    feature_name = args.feature or snapshot.get("sheetName", "unknown")

    # 기존 TC ID 목록
    existing_tc_ids = {str(row[0]).strip().zfill(3) for row in rows if row and row[0]}

    print(f"=== 처방 기반 TC 수정 지시 생성 v2 ===")
    print(f"기능: {feature_name} / 기존 TC: {len(rows)}개 / 모델: {GEMMA4_MODEL}")

    prescriptions = parse_prescriptions(review_text)
    print(f"처방 파싱: {len(prescriptions)}건")

    if not prescriptions:
        print("처방 없음 — 수정 지시 없음 (리뷰 보고서에 처방: 필드 확인 필요)")
        Path(args.output).write_text("[]", encoding="utf-8")
        return

    fixes = []
    skipped = 0
    for i, p in enumerate(prescriptions, 1):
        print(f"  [{i}/{len(prescriptions)}] {p[:70]}...")
        fix = prescription_to_fix(p, existing_tc_ids)
        if fix:
            fixes.append(fix)
        else:
            skipped += 1

    # 삭제 작업은 마지막에 실행
    non_delete = [f for f in fixes if f.get("action") != "delete"]
    deletes = [f for f in fixes if f.get("action") == "delete"]
    sorted_fixes = non_delete + deletes

    Path(args.output).write_text(
        json.dumps(sorted_fixes, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    update_count = sum(1 for f in sorted_fixes if f.get("action") == "update")
    add_count = sum(1 for f in sorted_fixes if f.get("action") == "add")
    delete_count = sum(1 for f in sorted_fixes if f.get("action") == "delete")

    print(f"\n=== 완료 ===")
    print(f"처방: {len(prescriptions)}건 → 실행: {len(sorted_fixes)}건 (스킵: {skipped}건)")
    print(f"내역: update:{update_count} add:{add_count} delete:{delete_count}")
    print(f"출력: {args.output}")


if __name__ == "__main__":
    main()
