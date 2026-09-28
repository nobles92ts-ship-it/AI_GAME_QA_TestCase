#!/usr/bin/env bash
# 테스트 스텁 — s1_crossref_cwd.test.js 가 run_pipeline_s1only.sh 의 run-agent.sh 자리에 놓는다. LLM 을 부르지 않는다.
# --agent 이름과 마지막 인자(프롬프트)만 stub_agent.js 로 넘긴다. TCTEAM_NODE 는 테스트가 환경변수로 준다.
# --model 값은 env STUB_MODEL_ARG 로 넘긴다 — s1_opus_pin.test.js 가 호출별 모델 자리(opus/sonnet)를 본다.
AGENT=""; MODEL=""
for ((i = 1; i < $#; i++)); do
  if [[ "${!i}" == "--agent" ]]; then j=$((i + 1)); AGENT="${!j}"; fi
  if [[ "${!i}" == "--model" ]]; then j=$((i + 1)); MODEL="${!j}"; fi
done
export STUB_MODEL_ARG="$MODEL"
exec "$TCTEAM_NODE" "$(dirname "${BASH_SOURCE[0]}")/stub_agent.js" "$AGENT" "${@: -1}"
