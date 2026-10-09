"""Confluence 페이지 → specs 폴더 (tc-team S0, LLM 없이).

2026-09-28 `_no_sync/codex_port/fetch_page_for_codex_run.py`(Codex 이식 선행본)를 정식화했다.
Claude S0 는 mcp-atlassian MCP 로 페이지를 읽었다. 이 경로는 같은 계정 정보를
`scripts/util/confluence_image_downloader.py` 의 로더(환경변수 → 로컬 설정)로 읽어
REST 로 직접 가져온다 — 인증 정보는 복사하지 않고 그 로더를 런타임에 부른다.

산출 (spec_dir 아래):
  confluence_raw.md            — 본문 마크다운 + 맨 위 수집 표식 줄들
  confluence_storage.html      — storage 원문 (변경 감지·감사용)
  confluence_source_meta.json  — 버전·해시·링크 수집 결과
  linked/<id>_<제목>.md        — 본문이 가리키는 같은 사이트 페이지 (최대 5개)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "_vendor"))
from bs4 import BeautifulSoup  # noqa: E402
from markdownify import markdownify  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CRED_MODULE = PROJECT_ROOT / "scripts" / "util" / "confluence_image_downloader.py"
MAX_LINKED = 5
MIN_RAW_BYTES = 1024          # Claude S0 계약과 같다: 본문 1KB 미만이면 실패
_PAGE_ID = re.compile(r"/pages/(\d+)|[?&]pageId=(\d+)")


def _auth():
    spec = importlib.util.spec_from_file_location("tc_confluence_auth", CRED_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def page_id_of(url: str) -> str | None:
    m = _PAGE_ID.search(url or "")
    return (m.group(1) or m.group(2)) if m else None


def fetch(auth, base, user, token, page_id):
    url = f"{base}/rest/api/content/{page_id}?expand=body.storage,body.view,version"
    headers = {**auth.make_auth_header(user, token), "Accept": "application/json"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)


def convert(base, page):
    soup = BeautifulSoup(page["body"]["view"]["value"], "html.parser")
    for node in soup.select("script, style, .toc-macro"):
        node.decompose()
    parsed = urllib.parse.urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    for tag in soup.find_all(["a", "img"]):
        attribute = "href" if tag.name == "a" else "src"
        value = tag.get(attribute) or (tag.get("data-image-src") if tag.name == "img" else None)
        if value:
            tag[attribute] = urllib.parse.urljoin(origin, value)
    images = {}
    for index, tag in enumerate(soup.find_all("img")):
        marker = f"TCIMAGEPLACEHOLDER{index:03d}END"
        alt = tag.get("alt") or tag.get("title") or "이미지"
        src = tag.get("src") or ""
        images[marker] = f"![{alt}]({src})" if src else f"[이미지: {alt}]"
        tag.replace_with(marker)
    body = markdownify(str(soup), heading_style="ATX", bullets="*")
    for marker, replacement in images.items():
        body = body.replace(marker, replacement)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return f"# {page['title']}\n\n{body}\n"


def safe_title(title):
    return re.sub(r"[\\/:*?\"<>|]+", "_", title).strip()[:80]


def title_of(page_id: str) -> str:
    auth = _auth()
    base, user, token = auth.load_confluence_credentials()
    return fetch(auth, base, user, token, page_id)["title"]


def write_spec(page_id: str, spec_dir: Path) -> dict:
    auth = _auth()
    base, user, token = auth.load_confluence_credentials()
    spec_dir.mkdir(parents=True, exist_ok=True)
    main_page = fetch(auth, base, user, token, page_id)
    main_md = convert(base, main_page)
    site = re.escape(urllib.parse.urlparse(base).netloc)
    ids = []
    for found in re.findall(rf"https://{site}/wiki/(?:spaces/[^/\s)]+/)?pages/(\d+)", main_md):
        if found != page_id and found not in ids:
            ids.append(found)
    collected = []
    linked_dir = spec_dir / "linked"
    linked_dir.mkdir(exist_ok=True)
    for linked_id in ids[:MAX_LINKED]:
        try:
            page = fetch(auth, base, user, token, linked_id)
            name = f"{linked_id}_{safe_title(page['title'])}.md"
            (linked_dir / name).write_text(convert(base, page), encoding="utf-8")
            collected.append({"page_id": linked_id, "title": page["title"], "file": name,
                              "version": page["version"]["number"]})
        except Exception as error:
            collected.append({"page_id": linked_id, "error": str(error)})
    header = "[미수집: 자식 페이지·첨부·댓글]\n"
    for item in collected:
        if item.get("file"):
            header += f"[링크수집: {item['title']} → linked/{item['file']}]\n"
        else:
            header += f"[링크수집 실패: {item['page_id']} — {item['error']}]\n"
    raw = header + "\n" + main_md
    (spec_dir / "confluence_raw.md").write_text(raw, encoding="utf-8")
    storage = main_page["body"]["storage"]["value"]
    (spec_dir / "confluence_storage.html").write_text(storage, encoding="utf-8")
    meta = {
        "page_id": page_id,
        "title": main_page["title"],
        "version": main_page["version"]["number"],
        "version_when": main_page["version"]["when"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "storage_sha256": hashlib.sha256(storage.encode()).hexdigest(),
        "view_sha256": hashlib.sha256(main_page["body"]["view"]["value"].encode()).hexdigest(),
        "body_bytes": len(raw.encode()),
        "storage_image_count": storage.count("<ac:image"),
        "markdown_image_count": main_md.count("!["),
        "linked_references": ids,
        "linked_collected": collected,
    }
    (spec_dir / "confluence_source_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("page_id")
    parser.add_argument("spec_dir", type=Path)
    args = parser.parse_args()
    meta = write_spec(args.page_id, args.spec_dir)
    print(json.dumps({"title": meta["title"], "version": meta["version"],
                      "bytes": meta["body_bytes"], "linked": meta["linked_collected"]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
