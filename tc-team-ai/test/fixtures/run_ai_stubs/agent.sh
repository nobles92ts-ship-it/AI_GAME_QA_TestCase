#!/usr/bin/env bash
# 가짜 run-agent.sh: 받은 인자(프롬프트 빼고)와 도구·격리 env 를 적고, 프롬프트의 입출력 경로를 뽑아
# 원문을 그대로 네 칸에 넣어 쓴다. STUB_AGENT_RC 가 있으면 아무것도 안 쓰고 그 코드로 끝난다(인증 10 · 한도 11 흉내).
# STUB_AGENT_MODE=reject 면 결과 파일은 쓰되 조작 칸을 비워 게이트가 전부 거르게 한다(정상 폴백 경로).
# STUB_AGENT_MODE=fenced 면 같은 JSON 을 코드펜스로 감싸 쓴다 — 파일은 있지만 JSON 으로 안 읽힌다(형식 틀림).
P="${@: -1}"
echo "ARGS ${*:1:$#-1} | TOOLS=${RUNAGENT_TOOLS:-} ISO=${TCTEAM_ISOLATE:-}" >> "$STUB_DIR/agent_calls.txt"
[[ -n "${STUB_AGENT_RC:-}" ]] && exit "$STUB_AGENT_RC"
node -e '
const fs = require("fs");
const [inF, outF] = [...process.argv[1].matchAll(/"([^"\n]+_(?:in|out)\.json)"/g)].map((m) => m[1]);
const rows = JSON.parse(fs.readFileSync(inF, "utf8")).rows;
const act = (r) => (process.env.STUB_AGENT_MODE === "reject" ? [] : [r.재현스탭]);
const body = JSON.stringify({ rows: rows.map((r) => ({ id: r.id, 전제: [], 조작: act(r), 기대: [r.재현스탭], 관측: ["화면"] })) });
fs.writeFileSync(outF, process.env.STUB_AGENT_MODE === "fenced" ? "```json\n" + body + "\n```\n" : body);
' "$P"
echo AI_REWRITE_DONE
