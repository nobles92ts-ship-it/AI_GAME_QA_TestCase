"""
gemma4_utils.py
Gemma4/Ollama 공통 유틸리티 — H-1: call_ollama, extract_json_array 공유 모듈.
gemma4_tc_writer.py, gemma4_tc_fixer.py에서 임포트.
"""

import json
import re
import sys
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
GEMMA4_MODEL = "gemma4:26b"
DEFAULT_TIMEOUT = 1800


def call_ollama(prompt, model=GEMMA4_MODEL, temperature=0.3, timeout=DEFAULT_TIMEOUT, num_ctx=32768):
    """Ollama /api/generate 호출. 실패 시 None 반환 (종료하지 않음).

    Args:
        prompt: 전달할 프롬프트 문자열
        model: 사용할 모델명 (기본: gemma4:26b)
        temperature: 샘플링 온도 (낮을수록 일관성 증가)
        timeout: HTTP 요청 타임아웃 (초)
        num_ctx: 컨텍스트 윈도우 크기
    Returns:
        응답 문자열, 또는 실패 시 None
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_predict": -1,   # 출력 토큰 무제한
            "num_ctx": num_ctx,
            "temperature": temperature,
        },
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read())
            return result["response"]
    except Exception as e:
        print(f"ERROR: Ollama 호출 실패 - {e}", file=sys.stderr)
        return None


def extract_json_array(text):
    """응답에서 가장 바깥쪽 JSON 배열을 추출해 문자열로 반환.

    우선순위:
      1. ```json ... ``` 코드블록
      2. ``` ... ``` 코드블록 (배열로 시작하는 경우)
      3. [ ... ] 직접 탐색 (가장 바깥 배열)
    없으면 '[]' 반환.
    """
    # ```json ... ``` 코드블록
    m = re.search(r"```json\s*([\s\S]*?)\s*```", text)
    if m:
        return m.group(1).strip()
    # ``` ... ``` 코드블록 (배열로 시작하는 경우)
    m = re.search(r"```\s*([\s\S]*?)\s*```", text)
    if m:
        candidate = m.group(1).strip()
        if candidate.startswith("["):
            return candidate
    # [ ... ] 직접 탐색 (가장 바깥 배열)
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "[":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0 and start != -1:
                return text[start:i + 1]
    return "[]"
