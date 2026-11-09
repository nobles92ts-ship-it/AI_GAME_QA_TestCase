# 🧠 brain — the second brain tc-team was built to use

tc-team runs without this folder. It runs **fully** only with it.

A spec page almost never defines every value it relies on — a drop rate lives in a table doc, a status effect is defined on another team's page, a planner answered the question in a thread last week. Without a brain, the S1 chain can only flag those items for a human. With a brain, it looks each one up in **your** documents and settles it: `apply` (defined → folded into the design), `locate` (lives in a data table → location cited on the TC), `discover` (a whole spec area the design missed → added to coverage), `keep` (no evidence → still flagged).

The "brain" is just your own docs, gathered into one layered markdown file the pipeline can search. This folder ships the two tools that make it:

| File | What it does |
|---|---|
| `build_bundle.py` | Reads `brain_manifest.json`, gathers your docs into one bundle. Each document gets a `# [layer/domain] path` heading. Versioned folders (`feature`, `feature_v2`, …) keep **only the latest version**. |
| `brain_search.py` | Searches that bundle from any folder (SQLite FTS5, standard library only) — for people and for agents outside the pipeline. |
| `brain_manifest.example.json` | Template. Copy to `brain_manifest.json` (git-ignored) and point it at your docs. |

> ⭐ **Recommended:** set it up the way the author runs it — layers, latest-version rule, how planner answers flow back into the brain, and what to leave out. The walkthrough is on AI TRY:
> **[aitryed.com/en/built/second-brain](https://aitryed.com/en/built/second-brain/)** (Korean: [aitryed.com/ko/built/second-brain](https://aitryed.com/ko/built/second-brain/)).
> The steps below are the minimum; that page is the configuration the pipeline was validated with.

---

## Set it up in five steps

1. **Copy the manifest and point it at your docs.**
   ```bash
   cp brain/brain_manifest.example.json brain/brain_manifest.json
   ```
   Put your design wiki under a `D` source. Add your past TC output (`team/specs`) as an `R` source if you want to search it yourself — the pipeline will never cite it as spec.

2. **Build the bundle.**
   ```bash
   python brain/build_bundle.py --dry-run   # see what goes in
   python brain/build_bundle.py
   ```

3. **Tell the pipeline where it is** — in `team/tc_config.json`:
   ```json
   "crossref_brain": "on",
   "crossref_source": "my-brain",
   "crossref_bundle": "<the bundle path from your manifest>"
   ```
   The S1 chain checks the index before every lookup and re-indexes the bundle into context-mode on its own when it is missing or older than the file (`tc-team/lib/crossref_source_gate.py` + `brain_index_sync.py`). You do not run `ctx_index` by hand.

4. **(Optional) search it yourself.**
   ```bash
   python brain/brain_search.py --build
   python brain/brain_search.py "respawn delay" "revive timer"
   ```
   Give two or three phrasings of the same thing — the search matches words, not meaning.

5. **Rebuild when your docs change.** A nightly scheduled `build_bundle.py` (+ `brain_search.py --build`) is enough. The pipeline notices a newer bundle and re-indexes it.

---

## The three rules that make it work

**Layers decide what counts as evidence.** `D` = design wiki, the only layer the pipeline may cite. `R` = past TC output, `P` = personal notes, `E` = reviews — searchable, never cited. Without layers, a TC can cite an older TC as if it were spec and copy its mistakes forward. The shipped crossref rule (`skills/tc-team/rules/tc-대조.md`) accepts `[D/MYGAME]` headings as evidence — `MYGAME` is a placeholder project name. Keep `"domain": "MYGAME"` for your design wiki, or rename it to your project in that rule file too.

**Latest version only.** When a spec is re-run as `_v2`, `_v3`, the old folders stay on disk. If they are indexed, a lookup can return a value that has since changed. `latest_version_only` keeps one folder per feature (a `draft_` prefix and a trailing ticket key like `_ABC123` are ignored when grouping); `deny` keeps archive copies such as `retired_*` out.

**Your project's docs only.** The step tests TCs against the design world they belong to. Someone else's wiki — including the author's — adds nothing.

## What a bad brain does

Nothing breaks. No match, an error, or a missing index all end in `keep`: the item is flagged for a human exactly as if the brain were off. The gate logs the difference between "looked and found nothing" and "had nowhere to look", so a broken index does not hide.
