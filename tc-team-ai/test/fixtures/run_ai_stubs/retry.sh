#!/usr/bin/env bash
# 가짜 pipeline_retry.sh: <로그> -- <명령...> 을 그대로 돌리고 종료코드를 넘긴다 (인증·한도는 run-agent 스텁의 rc 로 흉내)
shift 2
exec "$@"
