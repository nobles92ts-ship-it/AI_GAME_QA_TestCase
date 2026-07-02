"""
Confluence 이미지 다운로더
- Confluence 페이지 컨텐츠에서 이미지 URL을 추출하고 로컬에 저장
- 인증: 환경변수(CONFLUENCE_URL/CONFLUENCE_USERNAME/CONFLUENCE_API_TOKEN) 우선,
  없으면 claude_desktop_config.json (mcp-atlassian env 블록)
- blob:/무스킴 참조는 페이지 첨부 목록(REST)에서 파일명 매칭으로 해석해 다운로드

사용법:
  python confluence_image_downloader.py --input <confluence_raw.md 경로> --output-dir <저장 디렉토리> [--page-id <ID>]

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
import urllib.parse
import urllib.request
from pathlib import Path


# Claude Desktop 의 MCP 설정 파일 경로. 환경마다 다르므로 env 로 덮어쓸 수 있게 한다.
CONFIG_PATH = os.environ.get(
    "CLAUDE_DESKTOP_CONFIG",
    os.path.expanduser("~/AppData/Roaming/Claude/claude_desktop_config.json"),
)


def load_confluence_credentials():
    """Confluence 인증 로드 — 환경변수 우선, 폴백은 claude_desktop_config.json."""
    # 1) 환경변수 (Claude Desktop 없이도 동작 — mcp-atlassian 과 동일 키)
    url = os.environ.get("CONFLUENCE_URL", "").rstrip("/")
    username = os.environ.get("CONFLUENCE_USERNAME", "")
    token = os.environ.get("CONFLUENCE_API_TOKEN", "")
    if all([url, username, token]):
        return url, username, token

    # 2) claude_desktop_config.json 의 mcpServers.mcp-atlassian.env
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            config = json.load(f)
        env = config.get("mcpServers", {}).get("mcp-atlassian", {}).get("env", {})
        url = env.get("CONFLUENCE_URL", "").rstrip("/")
        username = env.get("CONFLUENCE_USERNAME", "")
        token = env.get("CONFLUENCE_API_TOKEN", "")
        if all([url, username, token]):
            return url, username, token
    except Exception as e:
        print(f"WARN: 설정 파일 읽기 실패({CONFIG_PATH}) — {e}", file=sys.stderr)

    print(
        "ERROR: Confluence 인증 정보 없음. 다음 중 한 가지로 설정하세요:\n"
        "  ① 환경변수: CONFLUENCE_URL(예: https://YOUR_SITE.atlassian.net/wiki) + CONFLUENCE_USERNAME(이메일) + CONFLUENCE_API_TOKEN\n"
        "  ② claude_desktop_config.json 의 mcpServers.mcp-atlassian.env 에 같은 3개 키 (파일 위치는 CLAUDE_DESKTOP_CONFIG 환경변수로 변경 가능)",
        file=sys.stderr,
    )
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


def detect_page_id(content):
    """마크다운 본문에서 Confluence 페이지 ID 자동 탐지 (…/pages/<숫자> 또는 첨부 URL의 컨테이너 ID)."""
    m = re.search(r"/pages/(\d+)", content)
    if m:
        return m.group(1)
    m = re.search(r"/download/attachments/(\d+)/", content)
    return m.group(1) if m else None


def fetch_attachment_map(base_url, page_id, auth_headers):
    """페이지 첨부 목록 조회 → {파일명: 다운로드 절대 URL}. 실패 시 빈 dict (비치명)."""
    api = f"{base_url}/rest/api/content/{page_id}/child/attachment?limit=200"
    try:
        req = urllib.request.Request(api, headers=auth_headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        amap = {}
        for att in data.get("results", []):
            dl = att.get("_links", {}).get("download", "")
            if att.get("title") and dl:
                amap[att["title"]] = base_url + dl
        return amap
    except Exception as e:
        print(f"WARN: 첨부 목록 조회 실패(pageId={page_id}) — {e}", file=sys.stderr)
        return {}


def resolve_unfetchable(url, alt, attachment_map):
    """다운로드 불가 참조(blob:/무스킴/404난 URL)를 첨부 파일명 매칭으로 해석.
    반환: (다운로드 URL, 첨부 파일명) 또는 None"""
    candidates = []
    if alt and "." in alt:
        candidates.append(urllib.parse.unquote(alt.strip()))
    tail = url.split("/")[-1].split("?")[0]
    if tail and "." in tail:
        candidates.append(urllib.parse.unquote(tail))
    for name in candidates:
        if name in attachment_map:
            return attachment_map[name], name
    return None


def download_image(url, output_dir, auth_headers, base_url, filename=None):
    """
    이미지 URL을 로컬에 다운로드.
    상대 URL이면 base_url 앞에 붙임. filename 지정 시 그 이름으로 저장.
    반환: 로컬 파일 경로 (실패 시 None)
    """
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = base_url + url

    # 파일명: 지정값 → URL 꼬리(쿼리스트링 제거) → 해시 폴백
    if not filename:
        filename = urllib.parse.unquote(url.split("/")[-1].split("?")[0])
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
    parser.add_argument("--page-id", default=None, help="Confluence 페이지 ID (blob 참조 해석용 — 생략 시 본문에서 자동 탐지)")
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

    page_id = args.page_id or detect_page_id(content)
    attachment_map = None  # 첫 blob/무스킴 참조 때 1회만 조회 (lazy)

    results = []
    for img in images:
        url = img["url"]
        save_name = None
        # blob:/data:/무스킴 참조는 직접 받을 수 없음 → 첨부 목록에서 파일명 매칭으로 해석
        if url.startswith(("blob:", "data:")) or not (url.startswith("http") or url.startswith("/")):
            if attachment_map is None:
                if page_id:
                    attachment_map = fetch_attachment_map(base_url, page_id, auth_headers)
                else:
                    attachment_map = {}
                    print("WARN: 페이지 ID 미탐지 — blob/무스킴 이미지 해석 불가 (--page-id 로 지정 가능)", file=sys.stderr)
            resolved = resolve_unfetchable(url, img["alt"], attachment_map)
            if resolved:
                url, save_name = resolved
            else:
                print(f"WARN: 첨부 매칭 실패 — 스킵: {img['url']} (alt={img['alt']})", file=sys.stderr)
                results.append({
                    "url": img["url"],
                    "alt": img["alt"],
                    "local_path": None,
                    "context_before": img["context_before"],
                    "context_after": img["context_after"]
                })
                continue

        local_path = download_image(url, output_dir, auth_headers, base_url, filename=save_name)
        if not local_path:
            # 직접 다운로드 실패(404 등 — 예: /wiki 컨텍스트가 빠진 절대 URL) → 첨부 목록에서 파일명으로 재해석
            if attachment_map is None:
                if page_id:
                    attachment_map = fetch_attachment_map(base_url, page_id, auth_headers)
                else:
                    attachment_map = {}
            retry = resolve_unfetchable(url, img["alt"], attachment_map)
            if retry and retry[0] != url:
                local_path = download_image(retry[0], output_dir, auth_headers, base_url, filename=retry[1])
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
