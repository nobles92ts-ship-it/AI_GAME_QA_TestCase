#!/usr/bin/env bash
# 가짜 체인(run_pipeline_full.sh 자리): 받은 인자를 적고, 견본 확정본을 specs 폴더에 깐 뒤 STUB_CHAIN_RC 로 끝난다
printf '%s\n' "$@" > "$STUB_DIR/chain_args.txt"
FEAT=""
while [[ $# -gt 0 ]]; do [[ "$1" == "--feature" ]] && FEAT="$2"; shift; done
SPEC="$TCTEAM_PROJECT_ROOT/team/specs/$FEAT"
mkdir -p "$SPEC"
[[ "${STUB_CHAIN_FINAL:-1}" == "1" ]] && cp -r "$STUB_FIXTURE/." "$SPEC/"
echo "[stub chain] $FEAT" >> "$SPEC/chain.log"
exit "${STUB_CHAIN_RC:-0}"
