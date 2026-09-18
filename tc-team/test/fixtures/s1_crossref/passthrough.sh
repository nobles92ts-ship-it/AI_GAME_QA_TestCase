#!/usr/bin/env bash
# 테스트 스텁 — silent_exit_guard.sh · pipeline_retry.sh 자리에 놓는다. 둘 다 `<파일> -- <명령…>` 꼴이다.
# 재시도·silent 감시 없이 명령만 그대로 실행한다(이 테스트가 볼 대상이 아니다).
shift 2
exec "$@"
