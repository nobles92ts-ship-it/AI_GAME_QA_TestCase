#!/usr/bin/env python3
"""brain_search.py — search your brain bundle from any folder (SQLite FTS5, standard library only).

The pipeline reaches the bundle through context-mode (`ctx_search`). This is the same bundle
for people and for agents outside the pipeline: "where did we decide X?", "which spec defines Y?".
Chunks are cut like ctx_index cuts them — each document's '# [layer/domain] path' heading, then
its h2 sections — so what you find here is what the pipeline would see.

Usage:
    python brain/brain_search.py --build                         # after every build_bundle.py
    python brain/brain_search.py "respawn delay"                  # top 5
    python brain/brain_search.py "respawn delay" "revive timer"  # several phrasings, merged
    python brain/brain_search.py "drop rate" --layer D -n 10
"""
import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
DOC_RE = re.compile(r"^# \[([A-Z])(?:/([^\]]+))?\] (.+)$", re.M)
WORD = re.compile(r"\w+", re.U)
PIECE = 2500          # ctx_index cuts at about 2.5 KB
RRF_K, DEPTH = 60, 20  # several phrasings: rank each, merge by reciprocal rank


def bundle_path(manifest):
    m = json.loads(Path(manifest).read_text(encoding="utf-8"))
    return Path(m.get("bundle", str(HERE / "brain_bundle.md"))).expanduser()


def chunks(text):
    heads = list(DOC_RE.finditer(text))
    for i, h in enumerate(heads):
        layer, path = h.group(1), h.group(3).strip()
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        for sec in re.split(r"(?m)^(?=## )", body):
            title = sec.splitlines()[0][3:].strip() if sec.startswith("## ") else ""
            for k in range(0, max(len(sec), 1), PIECE):
                piece = sec[k:k + PIECE].strip()
                if piece:
                    yield layer, f"{path} > {title}" if title else path, piece


def build(db, bundle):
    if not bundle.is_file():
        raise SystemExit(f"bundle not found: {bundle}  (run build_bundle.py first)")
    db.parent.mkdir(parents=True, exist_ok=True)
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    con.execute("CREATE VIRTUAL TABLE c USING fts5(layer UNINDEXED, title, body, tokenize='unicode61')")
    rows = list(chunks(bundle.read_text(encoding="utf-8")))
    con.executemany("INSERT INTO c VALUES (?,?,?)", rows)
    con.commit()
    print(f"[OK] {db}  ({len(rows)} chunks)")


def query(con, phrase, layer):
    words = [w for w in WORD.findall(phrase) if len(w) > 1] or WORD.findall(phrase)
    if not words:
        return []
    match = " OR ".join(f'"{w}"*' for w in words)
    sql = "SELECT layer, title, snippet(c, 2, '[', ']', ' … ', 24) FROM c WHERE c MATCH ?"
    args = [match]
    if layer:
        sql += " AND layer = ?"
        args.append(layer)
    return con.execute(sql + " ORDER BY bm25(c, 0, 3, 1) LIMIT ?", args + [DEPTH]).fetchall()


def main():
    ap = argparse.ArgumentParser(description="Search the brain bundle")
    ap.add_argument("phrases", nargs="*")
    ap.add_argument("--manifest", default=str(HERE / "brain_manifest.json"))
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--layer", choices=["D", "R", "P", "E"])
    ap.add_argument("-n", type=int, default=5)
    a = ap.parse_args()
    bundle = bundle_path(a.manifest)
    db = bundle.with_suffix(".search.db")
    if a.build:
        return build(db, bundle)
    if not a.phrases:
        ap.error("give at least one phrase (or --build)")
    if not db.exists():
        raise SystemExit("no search index yet — run with --build first")
    con = sqlite3.connect(db)
    score, hit = {}, {}
    for p in a.phrases:
        for rank, row in enumerate(query(con, p, a.layer)):
            key = (row[0], row[1])
            score[key] = score.get(key, 0) + 1 / (RRF_K + rank)
            hit.setdefault(key, row)
    best = sorted(score, key=score.get, reverse=True)[:a.n]
    if not best:
        print("no match — try other words for the same thing")
    for key in best:
        layer, title, snip = hit[key]
        print(f"[{layer}] {title}\n    {snip.replace(chr(10), ' ')}\n")


if __name__ == "__main__":
    main()
