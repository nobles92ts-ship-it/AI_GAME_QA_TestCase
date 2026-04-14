"""
gemma4 로컬 분석 헬퍼 — Ollama API를 통해 gemma4에게 텍스트/이미지 분석을 위임.
TC 파이프라인에서 초벌 분석 및 수정 코드 생성에 사용.

사용법:
  python gemma4_analyze.py --mode analyze --input <파일경로> [--prompt <추가지시>] [--output <출력경로>]
  python gemma4_analyze.py --mode fix --input <리뷰파일> --tc <TC파일> [--output <출력경로>]
  python gemma4_analyze.py --mode image --input <이미지경로> [--prompt <추가지시>] [--output <출력경로>]
"""

import argparse
import json
import sys
import base64
import urllib.request
from pathlib import Path

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
MODEL = "gemma4:latest"
TIMEOUT = 1800


def call_ollama(prompt, images=None):
    """Ollama API 호출. images는 base64 인코딩된 이미지 리스트."""
    if images:
        payload = {
            "model": MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": images
                }
            ],
            "stream": False
        }
        url = OLLAMA_CHAT_URL
    else:
        payload = {
            "model": MODEL,
            "prompt": prompt,
            "stream": False
        }
        url = OLLAMA_URL

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read())
            if images:
                return result["message"]["content"]
            return result["response"]
    except Exception as e:
        print(f"ERROR: Ollama 호출 실패 — {e}", file=sys.stderr)
        sys.exit(1)


def mode_analyze(input_path, extra_prompt, output_path):
    """기획서 초벌 분석 모드."""
    content = Path(input_path).read_text(encoding="utf-8")

    prompt = f"""너는 게임 QA 기획서 분석 전문가야. 아래 기획서를 분석해서 다음 항목을 정리해라.
반드시 한국어로 작성해.

## 분석 항목
1. **기능 목록**: 기획서에 명시된 모든 기능을 나열
2. **예외 케이스**: 각 기능별 예외/에러 상황
3. **검증 포인트**: QA 테스트 시 확인해야 할 핵심 포인트
4. **UI 요소**: 버튼, 팝업, 입력란 등 UI 컴포넌트 목록
5. **GlobalDefine 키**: 기획서에 언급된 설정값/키 (있는 경우)
6. **플랫폼 고려사항**: PC/모바일 분기가 필요한 항목

{extra_prompt if extra_prompt else ''}

---
## 기획서 원문

{content}
"""

    result = call_ollama(prompt)
    write_output(result, output_path)


def mode_fix(review_path, tc_path, output_path):
    """리뷰 기반 수정 코드 생성 모드."""
    review = Path(review_path).read_text(encoding="utf-8")
    tc_data = Path(tc_path).read_text(encoding="utf-8")

    prompt = f"""너는 Google Sheets TC 수정 코드 생성 전문가야.
아래 리뷰 보고서의 이슈 목록을 읽고, TC 데이터를 수정하기 위한 JavaScript 코드(Node.js)를 생성해라.

## 규칙
- CRITICAL → HIGH → MEDIUM → LOW 순서로 처리
- 각 수정 사항에 대해 Google Sheets API batchUpdate 요청 배열을 생성
- 셀 주소는 행/열 인덱스 기반
- 출력은 실행 가능한 JS 코드만 (설명 불필요)
- 반드시 한국어 주석

## 리뷰 보고서

{review}

## 현재 TC 데이터 (JSON)

{tc_data[:30000]}
"""

    result = call_ollama(prompt)
    write_output(result, output_path)


def mode_image(image_path, extra_prompt, output_path):
    """이미지 분석 모드."""
    img_bytes = Path(image_path).read_bytes()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    prompt = f"""이 이미지를 분석해서 다음을 정리해라. 반드시 한국어로 작성해.

1. 화면에 보이는 UI 요소 (버튼, 텍스트, 입력란 등)
2. 레이아웃 구조
3. 사용자 인터랙션 포인트
4. QA 테스트 시 확인해야 할 항목

{extra_prompt if extra_prompt else ''}
"""

    result = call_ollama(prompt, images=[img_b64])
    write_output(result, output_path)


def write_output(text, output_path):
    """결과 출력."""
    if output_path:
        Path(output_path).write_text(text, encoding="utf-8")
        print(f"OK: {output_path}")
    else:
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")


def main():
    parser = argparse.ArgumentParser(description="gemma4 로컬 분석 헬퍼")
    parser.add_argument("--mode", required=True, choices=["analyze", "fix", "image"])
    parser.add_argument("--input", required=True, help="입력 파일 경로")
    parser.add_argument("--tc", help="TC 데이터 파일 (fix 모드)")
    parser.add_argument("--prompt", default="", help="추가 프롬프트")
    parser.add_argument("--output", help="출력 파일 경로")
    args = parser.parse_args()

    if args.mode == "analyze":
        mode_analyze(args.input, args.prompt, args.output)
    elif args.mode == "fix":
        if not args.tc:
            print("ERROR: fix 모드에는 --tc 필수", file=sys.stderr)
            sys.exit(1)
        mode_fix(args.input, args.tc, args.output)
    elif args.mode == "image":
        mode_image(args.input, args.prompt, args.output)


if __name__ == "__main__":
    main()
