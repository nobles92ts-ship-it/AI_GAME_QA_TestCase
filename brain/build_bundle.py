#!/usr/bin/env python3
"""build_bundle.py — turn your own docs into one layered "brain" bundle.

The tc-team cross-reference step (S1 STEP 2) looks ambiguous spec items up in a knowledge
index of YOUR project's docs. context-mode indexes a markdown file by headings, so this
script gathers every document listed in brain_manifest.json into one markdown file where
each document starts with a layered header:

    # [D/MYGAME] wiki/combat/status_effects.md

The layer letter is what the anti-circular-citation guard reads
(skills/tc-team/rules/tc-대조.md): only `[D/...]` chunks may be cited as evidence.
`[R]` (past TC output), `[P]` (personal notes) and `[E]` (reviews) are still searchable
by people, but the pipeline never cites them as spec.

Latest version only: folders named `<feature>`, `<feature>_v2`, `<feature>_v3` … (optionally
with a `draft_` / `초안_` prefix or a trailing ticket key like `_ABC123`) are grouped and
only the highest version is bundled. Old versions otherwise show up next to the current one
and the lookup cites a value that has since changed.

Usage:
    python brain/build_bundle.py                       # uses brain/brain_manifest.json
    python brain/build_bundle.py --manifest my.json
    python brain/build_bundle.py --dry-run             # list what would be bundled

Then index it once (and after every rebuild):
    python tc-team/lib/brain_index_sync.py --project-dir <your work dir> \
        --source <crossref_source> --bundle <bundle path>
"""
import argparse
import fnmatch
import json
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
LAYERS = {"D", "R", "P", "E"}
VER_RE = re.compile(r"_v(\d+)$")
PREFIX_RE = re.compile(r"^(draft_|초안_)")
TICKET_RE = re.compile(r"_[A-Z]{2,}\d+$")


def feature_key(name):
    """'draft_party_system_ABC12_v3' -> ('partysystem', 3)."""
    m = VER_RE.search(name)
    base = VER_RE.sub("", name)
    base = TICKET_RE.sub("", PREFIX_RE.sub("", base))
    return re.sub(r"[_\s]", "", base).lower(), (int(m.group(1)) if m else 1)


def latest_dirs(root):
    """Direct sub-folders of root, newest version per feature (ties -> most recently modified)."""
    groups = {}
    for d in root.iterdir():
        if d.is_dir() and not d.name.startswith((".", "_")):
            key, ver = feature_key(d.name)
            groups.setdefault(key, []).append((ver, d.stat().st_mtime, d))
    return sorted(max(lst)[2] for lst in groups.values())


def matches(rel, globs):
    return any(fnmatch.fnmatch(rel, g) for g in globs)


def collect(source):
    root = Path(source["path"]).expanduser()
    if not root.is_dir():
        raise SystemExit(f"source path not found: {root}")
    include = source.get("include", ["**/*.md"])
    deny = source.get("deny", [])
    bases = latest_dirs(root) if source.get("latest_version_only") else [root]
    files = []
    for base in bases:
        for f in sorted(base.rglob("*")):
            if not f.is_file():
                continue
            rel = f.relative_to(root).as_posix()
            if matches(rel, include) and not matches(rel, deny):
                files.append((rel, f))
    return files


def demote_h1(text):
    """Body h1 -> h2, so the per-document h1 stays the only top-level heading (fences untouched)."""
    out, fence = [], False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
        out.append("#" + line if not fence and line.startswith("# ") else line)
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Build a layered brain bundle from your docs")
    ap.add_argument("--manifest", default=str(HERE / "brain_manifest.json"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    mpath = Path(a.manifest)
    if not mpath.is_file():
        raise SystemExit(f"manifest not found: {mpath}  (copy brain_manifest.example.json first)")
    m = json.loads(mpath.read_text(encoding="utf-8"))
    out = Path(m.get("bundle", str(HERE / "brain_bundle.md"))).expanduser()

    parts, count = [], {}
    for s in m["sources"]:
        layer = s.get("layer", "D")
        if layer not in LAYERS:
            raise SystemExit(f"layer must be one of {sorted(LAYERS)}: {layer}")
        tag = f"{layer}/{s['domain']}" if s.get("domain") else layer
        for rel, f in collect(s):
            count[tag] = count.get(tag, 0) + 1
            if a.dry_run:
                print(f"[{tag}] {rel}")
                continue
            body = demote_h1(f.read_text(encoding="utf-8", errors="replace")).strip()
            parts.append(f"# [{tag}] {s.get('label', Path(s['path']).name)}/{rel}\n\n{body}\n")
    summary = " · ".join(f"{k} {v}" for k, v in sorted(count.items())) or "0 files"
    if a.dry_run:
        print(f"-- {summary} (dry run, nothing written)")
        return
    if not parts:
        raise SystemExit("no documents matched — check paths and include globs (nothing written)")
    head = (f"> brain bundle · built {datetime.now():%Y-%m-%d %H:%M} by build_bundle.py · {summary}\n"
            "> One document per '# [layer/domain] path' heading. Only [D/...] may be cited as spec.\n\n")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(head + "\n\n".join(parts), encoding="utf-8")
    print(f"[OK] {out}  ({summary})")


if __name__ == "__main__":
    main()
