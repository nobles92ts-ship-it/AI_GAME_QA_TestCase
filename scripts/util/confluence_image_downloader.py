"""
Confluence 이미지 다운로더
- Confluence 페이지 컨텐츠에서 이미지 URL을 추출하고 로컬에 저장
- 인증 정보는 claude_desktop_config.json에서 자동 읽기

사용법:
  python confluence_image_downloader.py --input <confluence_raw.md 경로> --output-dir <저장 디렉토리>

출력:
  저장된 이미지 경로 목록을 JSON으로 출력 (stdout)
  예: [{"url": "...", "local_path": "...", "context_before": "...", "context_after": "..."}]
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path


# Claude Desktop 의 MCP 설정 파일 경로. 환경마다 다르므로 env 로 덮어쓸 수 있게 한다.
CONFIG_PATH = os.environ.get(
    "CLAUDE_DESKTOP_CONFIG",
    os.path.expanduser("~/AppData/Roaming/Claude/claude_desktop_config.json"),
)


def load_confluence_credentials():
    """claude_desktop_config.json에서 Confluence 인증 정보 로드."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            config = json.load(f)
        mcp = config.get("mcpServers", {})
        atlassian = mcp.get("mcp-atlassian", {})
        env = atlassian.get("env", {})
        url = env.get("CONFLUENCE_URL", "").rstrip("/")
        username = env.get("CONFLUENCE_USERNAME", "")
        token = env.get("CONFLUENCE_API_TOKEN", "")
        if not all([url, username, token]):
            print("ERROR: Confluence 인증 정보 누락 (CONFLUENCE_URL/USERNAME/API_TOKEN)", file=sys.stderr)
            sys.exit(1)
        return url, username, token
    except Exception as e:
        print(f"ERROR: 설정 파일 읽기 실패 — {e}", file=sys.stderr)
        sys.exit(1)


def make_auth_header(username, token):
    """Basic Auth 헤더 생성."""
    creds = base64.b64encode(f"{username}:{token}".encode()).decode()
    return {"Authorization": f"Basic {creds}"}


def extract_images_with_context(content, context_chars=300):
    """
    마크다운에서 이미지 URL과 앞뒤 텍스트 컨텍스트 추출.
    반환: [{"url": str, "alt": str, "context_before": str, "context_after": str}]
    """
    results = []
    # 마크다운 이미지: ![alt](url)
    pattern = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
    for match in pattern.finditer(content):
        alt = match.group(1)
        url = match.group(2)
        start = match.start()
        end = match.end()
        context_before = content[max(0, start - context_chars):start].strip()
        context_after = content[end:end + context_chars].strip()
        results.append({
            "url": url,
            "alt": alt,
            "context_before": context_before,
            "context_after": context_after
        })
    return results


def download_image(url, output_dir, auth_headers, base_url):
    """
    이미지 URL을 로컬에 다운로드.
    상대 URL이면 base_url 앞에 붙임.
    반환: 로컬 파일 경로 (실패 시 None)
    """
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = base_url + url

    # 파일명 추출 (쿼리스트링 제거)
    filename = url.split("/")[-1].split("?")[0]
    if not filename or "." not in filename:
        filename = f"image_{abs(hash(url))}.png"

    local_path = Path(output_dir) / filename

    # 이미 다운로드된 경우 스킵
    if local_path.exists():
        return str(local_path)

    try:
        req = urllib.request.Request(url, headers=auth_headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        local_path.write_bytes(data)
        return str(local_path)
    except Exception as e:
        print(f"WARN: 이미지 다운로드 실패 {url} — {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Confluence 이미지 다운로더")
    parser.add_argument("--input", required=True, help="Confluence 페이지 마크다운 파일 경로")
    parser.add_argument("--output-dir", required=True, help="이미지 저장 디렉토리")
    args = parser.parse_args()

    content = Path(args.input).read_text(encoding="utf-8")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    base_url, username, token = load_confluence_credentials()
    auth_headers = make_auth_header(username, token)

    images = extract_images_with_context(content)
    if not images:
        print("[]")
        return

    results = []
    for img in images:
        local_path = download_image(img["url"], output_dir, auth_headers, base_url)
        if local_path:
            results.append({
                "url": img["url"],
                "alt": img["alt"],
                "local_path": local_path,
                "context_before": img["context_before"],
                "context_after": img["context_after"]
            })
            print(f"OK: {local_path}", file=sys.stderr)
        else:
            results.append({
                "url": img["url"],
                "alt": img["alt"],
                "local_path": None,
                "context_before": img["context_before"],
                "context_after": img["context_after"]
            })

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
