"""
gemma4_tc_reviewer.py
tc_snapshot.json + tc_design.md를 읽어 gemma4로 TC 품질 리뷰 수행.
출력: 리뷰 MD 파일 (CRITICAL/HIGH/MEDIUM/LOW 이슈 목록)

사용법:
  python gemma4_tc_reviewer.py --snapshot <path> --design <path> --output <path>
  python gemma4_tc_reviewer.py --snapshot <path> --design <path> --output <path> --prev-review <path>
"""

import argparse
import json
import sys
import re
from pathlib import Path

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "gemma4:26b"
TIMEOUT = 1800
BATCH_SIZE = 40  # TC 배치당 처리 개수

REVIEW_RULES = """## TC 리뷰 규칙

심각도 기준:
  CRITICAL: TC 오작성으로 실제 버그를 놓칠 수 있는 수준 (검증 포인트 누락, 잘못된 대분류)
  HIGH: 재현스탭 추상 표현, 플랫폼 오분류, 검증단계 오분류
  MEDIUM: 소분류 명칭 불일치, 비고 누락, 사전조건 불명확
  LOW: 표현 개선, 오타, 일관성 문제

재현스탭 금지 표현 (HIGH 이슈):
  - "정상 동작", "올바르게", "정상적으로", "제대로"
  - "PC에서", "모바일에서" (플랫폼 중복 기재)
  - 1 TC에 복수 검증 포인트

설계 대비 누락 TC (CRITICAL):
  - tc_design.md의 소분류에 대응하는 TC가 없는 경우
  - 정상/부정/예외 중 하나라도 완전히 없는 소분류

출력 형식 (반드시 이 형식만 사용):
```
## 리뷰 결과 요약
CRITICAL: N건 / HIGH: N건 / MEDIUM: N건 / LOW: N건

## 이슈 목록

[CRITICAL] <이슈 제목>
TC ID: <ID 또는 "없음(누락)">
문제: <문제 설명>
수정: <구체적 수정 방향>

[HIGH] <이슈 제목>
TC ID: <ID>
문제: <문제 설명>
수정: <수정된 재현스탭 전체 내용>

[MEDIUM] <이슈 제목>
TC ID: <ID>
문제: <문제 설명>
수정: <수정 방향>

[LOW] <이슈 제목>
TC ID: <ID>
문제: <문제 설명>
수정: <수정 방향>
```

이슈가 없으면: "## 이슈 없음" 만 출력
"""

import urllib.request


def call_ollama(prompt):
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_predict": -1,
            "num_ctx": 32768,
            "temperature": 0.2,
        },
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read())
            return result["response"]
    except Exception as e:
        print(f"ERROR: Ollama 호출 실패 - {e}", file=sys.stderr)
        return None


def format_tc_rows(rows, headers):
    """TC 행 목록을 읽기 쉬운 텍스트로 변환"""
    lines = []
    col_names = ["TC ID", "대분류", "중분류", "소분류", "검증단계", "플랫폼", "재현스탭", "비고"]
    for row in rows:
        padded = list(row) + [""] * max(0, 8 - len(row))
        tc_id = padded[0] if padded[0] else "?"
        parts = []
        for i, name in enumerate(col_names):
            if i < len(padded) and padded[i]:
                parts.append(f"{name}: {padded[i]}")
        lines.append(f"[TC{tc_id}] " + " | ".join(parts[1:]))  # ID는 앞에
    return "\n".join(lines)


def review_batch(batch_rows, headers, design_text, batch_num, total_batches, feature_name, prev_review=""):
    """배치 단위로 Gemma4 리뷰 수행"""
    tc_text = format_tc_rows(batch_rows, headers)
    prev_section = f"\n## 이전 리뷰 (이미 수정된 이슈는 제외)\n{prev_review[:3000]}\n" if prev_review else ""

    prompt = f"""너는 게임 QA TC 리뷰 전문가야. 아래 TC 목록을 설계 문서와 대조해 품질 이슈를 찾아라.
반드시 한국어로 작성해.

{REVIEW_RULES}

## 기능명: {feature_name}
## 배치: {batch_num}/{total_batches}
{prev_section}

## TC 설계 문서 (기준)
{design_text[:8000]}

## 리뷰 대상 TC 목록 (행 {(batch_num-1)*BATCH_SIZE+1}~{batch_num*BATCH_SIZE})
{tc_text}

위 TC를 설계 문서와 대조해 이슈를 찾아라. 위 형식대로만 출력해라."""

    response = call_ollama(prompt)
    if response is None:
        return f"## 배치 {batch_num} 리뷰 실패\n\n"
    return response


def parse_issue_counts(text):
    """요약 라인에서 이슈 수 파싱"""
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    m = re.search(r"CRITICAL:\s*(\d+)", text)
    if m:
        counts["CRITICAL"] = int(m.group(1))
    m = re.search(r"HIGH:\s*(\d+)", text)
    if m:
        counts["HIGH"] = int(m.group(1))
    m = re.search(r"MEDIUM:\s*(\d+)", text)
    if m:
        counts["MEDIUM"] = int(m.group(1))
    m = re.search(r"LOW:\s*(\d+)", text)
    if m:
        counts["LOW"] = int(m.group(1))
    return counts


def main():
    parser = argparse.ArgumentParser(description="gemma4 TC 리뷰어")
    parser.add_argument("--snapshot", required=True, help="tc_snapshot.json 경로")
    parser.add_argument("--design", required=True, help="tc_design.md 경로")
    parser.add_argument("--output", required=True, help="출력 리뷰 MD 경로")
    parser.add_argument("--prev-review", default="", help="이전 리뷰 MD 경로 (2차 리뷰 시)")
    parser.add_argument("--feature", default="", help="기능명")
    args = parser.parse_args()

    snapshot_path = Path(args.snapshot)
    design_path = Path(args.design)

    if not snapshot_path.exists():
        print(f"ERROR: 스냅샷 파일 없음: {snapshot_path}", file=sys.stderr)
        sys.exit(1)
    if not design_path.exists():
        print(f"ERROR: 설계 파일 없음: {design_path}", file=sys.stderr)
        sys.exit(1)

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    design_text = design_path.read_text(encoding="utf-8")

    headers = snapshot.get("headers", [])
    rows = snapshot.get("rows", [])
    feature_name = args.feature or snapshot.get("sheetName", "unknown")

    prev_review = ""
    if args.prev_review:
        prev_path = Path(args.prev_review)
        if prev_path.exists():
            prev_review = prev_path.read_text(encoding="utf-8")

    print(f"=== gemma4 TC 리뷰 시작 ===")
    print(f"기능: {feature_name}")
    print(f"TC 수: {len(rows)}개")
    print(f"모델: {MODEL}")

    # 배치 분할
    batches = [rows[i:i+BATCH_SIZE] for i in range(0, len(rows), BATCH_SIZE)]
    total_batches = len(batches)
    print(f"배치 수: {total_batches} (배치당 {BATCH_SIZE}개)")

    all_reviews = []
    total_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}

    for i, batch in enumerate(batches, 1):
        print(f"\n  배치 {i}/{total_batches} 리뷰 중... ({len(batch)}개 TC)")
        result = review_batch(batch, headers, design_text, i, total_batches, feature_name, prev_review)
        all_reviews.append(result)

        counts = parse_issue_counts(result)
        for k in total_counts:
            total_counts[k] += counts[k]
        print(f"    → C:{counts['CRITICAL']} H:{counts['HIGH']} M:{counts['MEDIUM']} L:{counts['LOW']}")

    # 결과 통합
    total_issues = sum(total_counts.values())
    review_title = "2차 품질 리뷰" if args.prev_review else "1차 구조 리뷰"

    output_lines = [
        f"# TC 리뷰 보고서 — {feature_name} ({review_title})",
        f"",
        f"## 리뷰 결과 요약",
        f"CRITICAL: {total_counts['CRITICAL']}건 / HIGH: {total_counts['HIGH']}건 / MEDIUM: {total_counts['MEDIUM']}건 / LOW: {total_counts['LOW']}건",
        f"총 이슈: {total_issues}건",
        f"",
    ]

    if total_issues == 0:
        output_lines.append("## 이슈 없음\n")
    else:
        output_lines.append("## 이슈 목록\n")
        for i, review_text in enumerate(all_reviews, 1):
            # 요약 라인 제거하고 이슈 목록만 추출
            issue_section = re.sub(r"## 리뷰 결과 요약.*?\n.*?\n", "", review_text, flags=re.DOTALL)
            issue_section = issue_section.strip()
            if issue_section and "이슈 없음" not in issue_section:
                output_lines.append(f"### 배치 {i}\n")
                output_lines.append(issue_section)
                output_lines.append("")

    output_text = "\n".join(output_lines)
    Path(args.output).write_text(output_text, encoding="utf-8")

    print(f"\n=== 리뷰 완료 ===")
    print(f"총 이슈: {total_issues}건 (C:{total_counts['CRITICAL']} H:{total_counts['HIGH']} M:{total_counts['MEDIUM']} L:{total_counts['LOW']})")
    print(f"출력: {args.output}")


if __name__ == "__main__":
    main()
