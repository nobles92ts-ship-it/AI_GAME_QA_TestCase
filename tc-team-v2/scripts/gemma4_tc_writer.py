"""
gemma4_tc_writer_proposed_20260413.py
[변경안 — 실제 적용 금지]

핵심 변경:
  - 분류 그룹핑 트리에서 '→ 정상/부정/예외-N:' 케이스 목록을 파싱
  - Gemma4는 케이스 설명 1줄 → 재현스탭 문장 1줄만 생성 (케이스 추가 금지)
  - 케이스 없는 레거시 설계 파일: generate_tcs_for_group_legacy()로 자동 폴백

사용법 (기존과 동일):
  python gemma4_tc_writer_proposed_20260413.py --design <path> --output <path> [--feature <name>]
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from gemma4_utils import call_ollama, extract_json_array, GEMMA4_MODEL

_CLAUDE_HOME = os.environ.get("CLAUDE_HOME", "")
TC_RULES_PATH     = f"{_CLAUDE_HOME}/tc-team-v2/skills/tc-생성/tc-생성.md"
GEMMA4_RULES_PATH = f"{_CLAUDE_HOME}/tc-team-v2/skills/gemma4/gemma4-writer.md"

# 케이스 파싱 정규식
CASE_PATTERN = re.compile(r"→\s*(정상|부정|예외)-(\d+):\s*(.+)", re.IGNORECASE)
SUB_HEADER_PATTERN = re.compile(
    r"-\s+(.+?)\s+\[(HIGH|MEDIUM|LOW)\](?:\s+\[(PC(?:/모바일)?|모바일)\])?"
)
MID_HEADER_PATTERN = re.compile(r"(\d+\.\d+)\s+(.+?)(?:\s+\(중분류\))?$")


# ─────────────────────────────────────────
# 공통 유틸
# ─────────────────────────────────────────

def load_tc_rules():
    """tc-생성.md 전체 로드 (SSoT)"""
    p = Path(TC_RULES_PATH)
    if not p.exists():
        print(f"ERROR: TC 규칙 파일 없음: {TC_RULES_PATH}", file=sys.stderr)
        sys.exit(1)
    content = p.read_text(encoding="utf-8")
    content = re.sub(r"^---[\s\S]*?---\n", "", content).strip()
    print(f"  TC 규칙 로드 완료: {TC_RULES_PATH} ({len(content)}자)")
    return content


def load_gemma4_rules():
    """gemma4-writer.md 로드 (Gemma4 코더 규칙 SSoT)"""
    p = Path(GEMMA4_RULES_PATH)
    if not p.exists():
        print(f"  WARN: gemma4-writer.md 없음 — 내장 규칙 사용", file=sys.stderr)
        return ""
    content = p.read_text(encoding="utf-8")
    content = re.sub(r"^---[\s\S]*?---\n", "", content).strip()
    print(f"  Gemma4 규칙 로드 완료: {GEMMA4_RULES_PATH} ({len(content)}자)")
    return content


def load_tc_rules_brief(tc_rules_full):
    """tc-생성.md에서 재현스탭 규칙 섹션만 추출 (케이스→문장 변환 전용 prompt 경량화)"""
    lines = tc_rules_full.split("\n")
    result = []
    in_section = False
    for line in lines:
        if "## TC 작성 규칙" in line or "### 재현 스탭 형식" in line:
            in_section = True
        if in_section:
            result.append(line)
            if len(result) > 60:  # 재현스탭 규칙 섹션만 (약 60줄)
                break
    return "\n".join(result) if result else tc_rules_full[:2000]


def parse_and_validate(json_str, section_name):
    """JSON 파싱 및 행 검증"""
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  WARN [{section_name}] JSON 파싱 실패: {e}", file=sys.stderr)
        print(f"  응답 앞 300자: {json_str[:300]}", file=sys.stderr)
        return []

    if not isinstance(data, list):
        print(f"  WARN [{section_name}] 배열이 아님", file=sys.stderr)
        return []

    valid = []
    for row in data:
        if not isinstance(row, list) or len(row) < 6:
            continue
        while len(row) < 7:
            row.append("")
        row = [str(c) for c in row[:7]]

        if row[3] not in ("정상", "부정", "예외"):
            row[3] = "정상"

        if row[5] not in ("PC", "모바일", "PC/모바일"):
            if "모바일" in row[5] and "PC" in row[5]:
                row[5] = "PC/모바일"
            elif "모바일" in row[5]:
                row[5] = "모바일"
            else:
                row[5] = "PC/모바일"

        valid.append(row)
    return valid


# ─────────────────────────────────────────
# 기본기능 섹션 직접 파싱 (변경 없음)
# ─────────────────────────────────────────

def parse_basic_section(section_text):
    """기본기능 검증 항목 테이블을 TC JSON으로 직접 변환"""
    rows = []
    header_found = False
    for line in section_text.split("\n"):
        if "| # |" in line and "중분류" in line:
            header_found = True
            continue
        if "|---|" in line:
            continue
        if not header_found:
            continue
        if not line.strip().startswith("|"):
            continue

        parts = [p.strip() for p in line.split("|")]
        parts = [p for p in parts if p != ""]

        if len(parts) < 5:
            continue
        if not parts[0].isdigit():
            continue

        minor = parts[1] if len(parts) > 1 else ""
        sub = parts[2] if len(parts) > 2 else ""
        verif = parts[3] if len(parts) > 3 else "정상"
        content = parts[4] if len(parts) > 4 else ""
        platform_raw = parts[5] if len(parts) > 5 else "PC/모바일"

        if "모바일" in platform_raw and "PC" in platform_raw:
            platform = "PC/모바일"
        elif "모바일" in platform_raw:
            platform = "모바일"
        elif "PC" in platform_raw:
            platform = "PC"
        else:
            platform = "PC/모바일"

        if verif not in ("정상", "부정", "예외"):
            verif = "정상"

        rows.append(["기본기능", minor, sub, verif, content, platform, ""])

    print(f"  [기본기능] 테이블 파싱: {len(rows)}개 TC")
    return rows


# ─────────────────────────────────────────
# 분류 그룹 경계 파싱 (변경 없음)
# ─────────────────────────────────────────

def extract_groups_from_tree(section_text):
    """분류 그룹핑 트리에서 대분류별로 텍스트 추출"""
    groups = []
    current_name = None
    current_lines = []

    for line in section_text.split("\n"):
        m = re.match(r"^(?:#+\s*)?(\d+)\.\s+\*\*(.+?)\*\*\s+\(대분류", line.strip())
        if m:
            if current_name is not None:
                groups.append((current_name, "\n".join(current_lines)))
            current_name = m.group(2).strip()
            current_lines = [line]
        elif current_name is not None:
            current_lines.append(line)

    if current_name is not None:
        groups.append((current_name, "\n".join(current_lines)))

    return groups


# ─────────────────────────────────────────
# [신규] 케이스 파싱 — 소분류별 → 케이스 목록 추출
# ─────────────────────────────────────────

def extract_cases_from_group(group_name, group_text):
    """
    분류 그룹 텍스트에서 소분류별 케이스 목록 추출.

    대상 형식:
      - HUD 메뉴 진입 [LOW] [PC/모바일]
        → 정상-1: HUD 친구 버튼 클릭 시 친구 창이 열리는지
        → 부정-1: 친구 버튼 빠른 연속 클릭 시 창 중복 열림이 없는지

    반환:
      [
        {
          "대분류": str, "중분류": str, "소분류": str,
          "리스크": str, "플랫폼": str,
          "케이스": [{"검증단계": str, "번호": int, "설명": str}, ...]
        },
        ...
      ]
    """
    result = []
    current_minor = ""
    current_sub = None

    for line in group_text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        # 중분류 감지: "1.1 UI 진입" or "1.1 UI 진입 (중분류)"
        mid_m = MID_HEADER_PATTERN.match(stripped)
        if mid_m:
            current_minor = mid_m.group(2).strip().rstrip("(중분류)").strip()
            continue

        # 소분류 감지: "- HUD 메뉴 진입 [LOW] [PC/모바일]"
        sub_m = SUB_HEADER_PATTERN.match(stripped)
        if sub_m:
            if current_sub is not None and current_sub["케이스"]:
                result.append(current_sub)
            elif current_sub is not None:
                # 케이스 없는 소분류: 경고용으로 빈 케이스로 추가
                result.append(current_sub)
            platform_raw = sub_m.group(3) if sub_m.group(3) else "PC/모바일"
            current_sub = {
                "대분류": group_name,
                "중분류": current_minor,
                "소분류": sub_m.group(1).strip(),
                "리스크": sub_m.group(2),
                "플랫폼": platform_raw,
                "케이스": []
            }
            continue

        # 케이스 감지: "→ 정상-1: 설명"
        case_m = CASE_PATTERN.match(stripped)
        if case_m and current_sub is not None:
            verif = case_m.group(1)
            # 정규화: 소문자/혼용 방지
            if verif not in ("정상", "부정", "예외"):
                verif = "정상"
            current_sub["케이스"].append({
                "검증단계": verif,
                "번호": int(case_m.group(2)),
                "설명": case_m.group(3).strip()
            })

    # 마지막 소분류 저장
    if current_sub is not None:
        result.append(current_sub)

    return result


# ─────────────────────────────────────────
# [신규] 케이스 1개 → 재현스탭 1문장 생성
# ─────────────────────────────────────────

def generate_step_for_case(sub_info, case, feature_name, tc_rules_brief, gemma4_rules=""):
    """
    케이스 설명 1줄 → 재현스탭 문장 1줄 (Gemma4 최소 prompt).

    Gemma4 역할: 문장화만 담당 (케이스 추가/변경 금지).
    gemma4_rules: gemma4-writer.md 내용 (SSoT). 없으면 내장 규칙 사용.
    """
    verif = case["검증단계"]
    desc = case["설명"]
    sub = sub_info["소분류"]
    mid = sub_info["중분류"]
    major = sub_info["대분류"]
    platform = sub_info["플랫폼"]

    # gemma4-writer.md 규칙이 있으면 주입, 없으면 내장 규칙 사용
    if gemma4_rules:
        rules_block = gemma4_rules
    else:
        rules_block = (
            "재현스탭 필수 규칙:\n"
            "- 형식: [사전 상태]에서 [행동]하면 [구체적 결과]가 발생하는지 확인\n"
            "- 추상 표현 절대 금지: '정상 동작', '올바르게', '정상적으로', '제대로'\n"
            "- 플랫폼 중복 기재 금지: 'PC에서', '모바일에서' 시작 금지\n"
            "- 1 TC = 1 검증 포인트 (복수 검증 포함 금지)\n"
            "- 경계값은 구체적 수치 필수"
        )

    prompt = f"""{rules_block}

기능: {feature_name}
대분류: {major} / 중분류: {mid} / 소분류: {sub}
검증단계: {verif} / 플랫폼: {platform}

케이스 설명: {desc}

한 줄 재현스탭 문장만 출력 (따옴표/마크다운 없이):"""

    response = call_ollama(prompt, temperature=0.1)

    if not response:
        # Fallback: 케이스 설명을 그대로 반환
        print(f"  WARN Gemma4 응답 없음 — 케이스 설명 원문 사용: {desc[:50]}", file=sys.stderr)
        return desc

    # 첫 번째 실질적인 줄 추출
    for line in response.strip().split("\n"):
        line = line.strip().strip('"').strip("'").strip("。")
        if line and len(line) > 10:
            return line

    return desc


# ─────────────────────────────────────────
# [레거시 폴백] 케이스 없는 기존 설계 파일 대응
# ─────────────────────────────────────────

def generate_tcs_for_group_legacy(group_name, group_text, feature_name, tc_rules):
    """
    케이스(→) 없는 레거시 설계 파일 대응.
    기존 generate_tcs_for_group() 로직과 동일 — Gemma4가 케이스+재현스탭 모두 생성.
    신규 설계 파일에서는 호출되지 않아야 함.
    """
    print(f"  [레거시 모드] '{group_name}' — Gemma4가 케이스 자체 판단 (비결정적)")
    prompt = f"""너는 게임 QA TC 작성 전문가야. 아래 설계 항목을 기반으로 TC를 JSON 배열로 생성해라.
반드시 아래 TC 작성 규칙을 전부 준수해라.

{tc_rules}

---
출력 형식: JSON 배열. 각 원소는 7개 문자열 배열:
["대분류", "중분류", "소분류", "검증단계", "재현스탭", "플랫폼", "비고"]
출력: JSON 배열만 (설명, 주석, 마크다운 없이)
---

## 대분류: {group_name}
## 기능: {feature_name}

아래 설계 항목의 각 소분류 항목에 대해 TC를 작성해라.
- [HIGH] 태그 = 정상+부정+예외 최소 3개 이상
- [MEDIUM] 태그 = 정상+부정+예외 각 1개씩
- [LOW] 태그 = 정상 1~2개 위주

## 설계 항목
{group_text}

위 설계 항목을 기반으로 TC JSON 배열을 생성해라. JSON만 출력해라."""

    response = call_ollama(prompt)
    if response is None:
        print(f"  WARN [{group_name}] gemma4 호출 실패", file=sys.stderr)
        return []

    json_str = extract_json_array(response)
    tcs = parse_and_validate(json_str, group_name)
    for row in tcs:
        row[0] = group_name
    return tcs


# ─────────────────────────────────────────
# 섹션 분리 (변경 없음)
# ─────────────────────────────────────────

def split_sections(content):
    """## 헤더로 섹션 분리"""
    sections = {}
    current_key = None
    current_lines = []

    for line in content.split("\n"):
        if line.startswith("## "):
            if current_key is not None:
                sections[current_key] = "\n".join(current_lines)
            current_key = line[3:].strip()
            current_lines = []
        else:
            if current_key is not None:
                current_lines.append(line)

    if current_key is not None:
        sections[current_key] = "\n".join(current_lines)

    return sections


# ─────────────────────────────────────────
# main
# ─────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="gemma4 TC 작성기 [케이스 기반 v2]")
    parser.add_argument("--design", required=True, help="tc_design.md 경로")
    parser.add_argument("--output", required=True, help="출력 JSON 경로")
    parser.add_argument("--feature", default="", help="기능명 (기본: 부모 폴더명)")
    args = parser.parse_args()

    design_path = Path(args.design)
    if not design_path.exists():
        print(f"ERROR: 설계 파일 없음: {design_path}", file=sys.stderr)
        sys.exit(1)

    feature_name = args.feature or design_path.parent.name
    content = design_path.read_text(encoding="utf-8")

    print(f"=== gemma4 TC 작성 시작 [케이스 기반 v2] ===")
    print(f"기능: {feature_name}")
    print(f"모델: {GEMMA4_MODEL}")

    tc_rules = load_tc_rules()
    tc_rules_brief = load_tc_rules_brief(tc_rules)
    gemma4_rules = load_gemma4_rules()

    sections = split_sections(content)
    print(f"섹션 수: {len(sections)} ({', '.join(sections.keys())})")

    all_tcs = []
    legacy_fallback_used = False

    # 1. 기본기능 섹션 직접 파싱 (변경 없음)
    for key, text in sections.items():
        if "기본기능" in key:
            print(f"\n[기본기능 테이블 직접 파싱]")
            basic_tcs = parse_basic_section(text)
            all_tcs.extend(basic_tcs)
            break

    # 2. 분류 그룹핑 트리 → 케이스 파싱 → 재현스탭만 생성
    for key, text in sections.items():
        if "그룹핑 트리" in key or ("분류" in key and "트리" in key and "그룹핑" in key):
            print(f"\n[분류 트리 케이스 파싱 모드]")
            groups = extract_groups_from_tree(text)
            print(f"  대분류 그룹 수: {len(groups)}")

            for i, (group_name, group_text) in enumerate(groups):
                # 추후 구현 그룹: 직접 처리
                if "추후" in group_name:
                    print(f"  [{i+1}/{len(groups)}] '{group_name}' → 추후 구현 TC (직접 생성)")
                    for line in group_text.split("\n"):
                        m = re.search(r"-\s+(.+?)\s+\[", line.strip())
                        if m:
                            item = m.group(1).strip()
                            plat_m = re.search(r"\[(PC(?:/모바일)?|모바일)\]", line)
                            plat = plat_m.group(1) if plat_m else "PC/모바일"
                            all_tcs.append([
                                group_name, "추후 구현", item, "정상",
                                f"{item} 기능이 구현된 상태에서 정상 동작하는지 확인",
                                plat,
                                "추후 구현"
                            ])
                    continue

                print(f"  [{i+1}/{len(groups)}] '{group_name}' → 케이스 파싱 중...")
                sub_infos = extract_cases_from_group(group_name, group_text)

                # 케이스 없는 소분류 확인
                has_any_case = any(s["케이스"] for s in sub_infos)

                if not sub_infos or not has_any_case:
                    print(f"  WARN '{group_name}': 케이스(→) 없음 — 레거시 모드 폴백", file=sys.stderr)
                    legacy_fallback_used = True
                    tcs = generate_tcs_for_group_legacy(group_name, group_text, feature_name, tc_rules)
                    all_tcs.extend(tcs)
                    continue

                total_cases = sum(len(s["케이스"]) for s in sub_infos)
                sub_no_cases = [s["소분류"] for s in sub_infos if not s["케이스"]]
                if sub_no_cases:
                    print(f"  WARN 케이스 없는 소분류: {sub_no_cases} — 해당 소분류 건너뜀", file=sys.stderr)

                print(f"    소분류 {len(sub_infos)}개 / 케이스 {total_cases}개 → 재현스탭 생성 중...")

                for sub_info in sub_infos:
                    if not sub_info["케이스"]:
                        continue
                    for case in sub_info["케이스"]:
                        step = generate_step_for_case(sub_info, case, feature_name, tc_rules_brief, gemma4_rules)
                        tc_row = [
                            sub_info["대분류"],
                            sub_info["중분류"],
                            sub_info["소분류"],
                            case["검증단계"],
                            step,
                            sub_info["플랫폼"],
                            ""
                        ]
                        all_tcs.append(tc_row)

                print(f"    → {sum(len(s['케이스']) for s in sub_infos)}개 TC 생성")

            break

    # 3. 결과 저장
    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(all_tcs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n=== 완료 ===")
    print(f"총 TC: {len(all_tcs)}개")
    if legacy_fallback_used:
        print(f"  WARN: 레거시 폴백 사용됨 — 설계 파일에 케이스(→) 추가 권장")

    # 검증단계 분포
    cnt = {"정상": 0, "부정": 0, "예외": 0}
    for row in all_tcs:
        if row[3] in cnt:
            cnt[row[3]] += 1
    total = sum(cnt.values()) or 1
    print(f"검증단계 분포: 정상 {cnt['정상']}({cnt['정상']/total*100:.0f}%) / "
          f"부정 {cnt['부정']}({cnt['부정']/total*100:.0f}%) / "
          f"예외 {cnt['예외']}({cnt['예외']/total*100:.0f}%)")
    neg_exc_pct = (cnt['부정'] + cnt['예외']) / total * 100
    if neg_exc_pct < 49:
        print(f"  WARN: 부정+예외 {neg_exc_pct:.0f}% < 49% — 설계 단계에서 부정/예외 케이스 보강 필요")
    elif neg_exc_pct > 60:
        print(f"  WARN: 부정+예외 {neg_exc_pct:.0f}% > 60% — 설계 단계에서 정상 케이스 보강 필요")
    else:
        print(f"  OK: 부정+예외 {neg_exc_pct:.0f}% (49~60% 범위 내)")

    print(f"출력: {output_path}")


if __name__ == "__main__":
    main()
