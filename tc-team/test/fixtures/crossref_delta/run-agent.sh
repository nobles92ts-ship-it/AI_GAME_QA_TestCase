#!/usr/bin/env bash
# 테스트 스텁 — crossref_delta.test.js 가 finalize.sh 의 run-agent.sh 자리에 놓는다. LLM 을 부르지 않는다.
# 마지막 인자(프롬프트)만 stub_agent.js 로 넘긴다. TCTEAM_NODE 는 테스트가 환경변수로 준다.
exec "$TCTEAM_NODE" "$(dirname "${BASH_SOURCE[0]}")/stub_agent.js" "${@: -1}"
