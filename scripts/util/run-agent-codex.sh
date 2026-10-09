#!/usr/bin/env bash
# run-agent-codex.sh — run-agent.sh 의 Codex 짝 (2026-10-01). 인자 규약은 run-agent.sh 와 같다.
# tc-team 체인이 TCTEAM_ENGINE=codex 일 때만 고른다. 본체는 run_agent_codex.py (claude 호출 없음).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
PY="${TCTEAM_PYTHON:-python}"
exec "$PY" "$HERE/run_agent_codex.py" "$@"
