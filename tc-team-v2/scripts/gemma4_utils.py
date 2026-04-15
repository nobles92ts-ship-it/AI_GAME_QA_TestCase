"""
gemma4_utils.py
Gemma4 공통 유틸리티 — Google AI Studio 또는 Ollama 백엔드 지원.
GEMMA4_BACKEND=google 시 Google AI Studio API 사용.
GEMMA4_BACKEND=ollama 시 로컬 Ollama 사용 (기본).
gemma4_tc_writer.py, gemma4_tc_fixer.py에서 임포트.

환경 변수:
  GEMMA4_BACKEND       — ollama (기본) | google
  GEMMA4_MODEL         — Ollama 모델명 (기본: gemma4:26b)
  GOOGLE_AI_API_KEY    — Google AI Studio API 키 (google 백엔드 필수)
                         발급: https://aistudio.google.com/app/apikey
  GOOGLE_AI_MODEL      — Google AI Studio 모델명 (기본: gemma-4-31b-it)
"""

import json
import os
import re
import ssl
import sys
import urllib.request

# 백엔드 설정
BACKEND = os.environ.get("GEMMA4_BACKEND", "ollama")
GOOGLE_AI_API_KEY = os.environ.get("GOOGLE_AI_API_KEY", "")
GOOGLE_AI_MODEL = os.environ.get("GOOGLE_AI_MODEL", "gemma-4-31b-it")
GOOGLE_AI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GOOGLE_AI_MODEL}:generateContent"

OLLAMA_URL = "http://localhost:11434/api/generate"
GEMMA4_MODEL = os.environ.get("GEMMA4_MODEL", "gemma4:26b")
DEFAULT_TIMEOUT = 120  # Google API는 2분이면 충분


def call_ollama(prompt, model=None, temperature=0.3, timeout=DEFAULT_TIMEOUT, num_ctx=32768):
    """Google AI Studio 또는 Ollama 호출. 실패 시 None 반환.

    Args:
        prompt: 전달할 프롬프트 문자열
        model: 사용할 모델명 (생략 시 백엔드 기본값 사용)
        temperature: 샘플링 온도 (낮을수록 일관성 증가)
        timeout: HTTP 요청 타임아웃 (초)
        num_ctx: 컨텍스트 윈도우 크기 (Ollama 전용)
    Returns:
        응답 문자열, 또는 실패 시 None
    """
    if BACKEND == "google":
        return _call_google(prompt, temperature, timeout)
    else:
        return _call_ollama_local(prompt, model or GEMMA4_MODEL, temperature, timeout, num_ctx)


def _call_google(prompt, temperature=0.3, timeout=120):
    """Google AI Studio API 호출."""
    if not GOOGLE_AI_API_KEY:
        print(
            "ERROR: GOOGLE_AI_API_KEY 환경 변수가 설정되지 않았습니다.\n"
            "       https://aistudio.google.com/app/apikey 에서 API 키를 발급받아\n"
            "       .env 또는 OS 환경 변수에 GOOGLE_AI_API_KEY 로 설정하세요.",
            file=sys.stderr,
        )
        return None

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 65536,
        }
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{GOOGLE_AI_URL}?key={GOOGLE_AI_API_KEY}",
        data=data,
        headers={"Content-Type": "application/json"}
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            result = json.loads(resp.read())
            if "error" in result:
                print(f"ERROR: Google AI Studio 오류 - {result['error']['message']}", file=sys.stderr)
                return None
            return result["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        print(f"ERROR: Google AI Studio 호출 실패 - {e}", file=sys.stderr)
        return None


def _call_ollama_local(prompt, model=GEMMA4_MODEL, temperature=0.3, timeout=1800, num_ctx=32768):
    """로컬 Ollama API 호출."""
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_predict": -1,
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
