#!/usr/bin/env python3
"""dep_check.py — Agent/Skill dependency graph verification (v2).

github-repo 스킬 STEP 1.5 / STEP 8 의 단일 소스 검증 스크립트.
"관계 기반 검증": 각 에이전트·스킬·스크립트가 참조하는 다른 파일이
staging 안에 전부 존재하는지 확인한다. 1건이라도 누락이면 exit 1.

v1 대비 추가 (2026-06-14, 검증 사고 재발 방지):
  - [CRITICAL] `--agent <name>` (확장자 없는 CLI 플래그) → agents/<name>.md 매핑 검사.
    v1 정규식은 .md|.py|.js|.json 확장자를 강제해 run-agent.sh의 --agent 호출을
    전혀 못 잡았다 → 신규 에이전트(예: tc-리뷰1수정1-v2) 누락이 [PASS]로 통과,
    2026-04-15 tc-분석.md 누락 사건과 동형 재발. 본 검사가 그 사각을 막는다.
  - [HIGH] .gs 동반 파일 검사: deploy_appscript.js 등이 path.join(__dirname, '...gs')
    또는 appscript/<name>.gs 로 부르는 동반 파일을 staging 존재 강제.
  - .gs / .gas 를 스캔·인덱싱 확장자에 포함.

사용법:
    python dep_check.py [staging_root]   # 기본값 = 현재 디렉토리
"""
import re
import sys
from pathlib import Path
from collections import defaultdict

# Windows 콘솔(cp949)에서도 한글/유니코드 출력이 깨지지 않게 stdout을 UTF-8로 강제
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except (AttributeError, ValueError):
    pass

STAGING = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

# 참조를 스캔할 소스 파일 확장자
SCAN_EXTENSIONS = ('.md', '.js', '.py', '.sh', '.ps1', '.gs')
# staging 의 "존재하는 파일" 집합을 만들 때 인덱싱할 확장자 (.template = 셋업이 생성하는 설정의 원본)
INDEX_EXTENSIONS = SCAN_EXTENSIONS + ('.json', '.html', '.gas', '.template', '.mjs')

# 경로형 참조 추출 패턴 (확장자 있는 참조)
# ⚠ 확장자 alternation 은 긴 것 우선(json|js, mjs|js) — 'js' 가 먼저면 .json/.mjs 가 잘린다
# ⚠ sh/ps1/mjs 는 2026-07-30 추가 — 빠져 있던 6주간 docs/SETUP.md 의 존재하지 않는
#   preflight 스크립트(.ps1)와 install(.mjs) 지시를 못 잡았다(QA 항목 14가 있었는데도
#   기계가 침묵 → 수동 체크가 스킵되며 v3.1.0 릴리스를 통과, 07-29 발견).
#   (주석에 풀경로를 쓰면 이 스캐너가 자기 주석을 누락 참조로 잡는다 — 일부러 깨서 표기)
_EXT = r'(mjs|md|py|json|js|html|gs|sh|ps1)'
PATH_PATTERNS = [
    # 절대 Windows/Unix 경로. (?<![A-Za-z]) 로 'https:' 의 s: 가 드라이브로 오인되는 것 방지
    re.compile(r'(?<![A-Za-z])[A-Z]:[/\\][\w\-\\/\.가-힣]+\.' + _EXT, re.IGNORECASE),
    # git-bash 형 드라이브 경로 /c/Users/... 도 포착
    re.compile(r'/[a-z]/[\w\-/\.가-힣]+\.' + _EXT, re.IGNORECASE),
    # 플레이스홀더 경유 ({CLAUDE_HOME}/..., $UTIL/...)
    re.compile(r'[{$][A-Z_]+[}]?[/\\][\w\-\\/\.가-힣]+\.' + _EXT, re.IGNORECASE),
    # 레포 내부 상대 경로
    # tc-team-v2 가 tc-team 보다 먼저 (접두 관계 — 짧은 쪽이 먼저면 -v2 경로가 잘린다)
    re.compile(r'\b(skills|agents|commands|scripts|tc-team-v2|tc-team|docs|appscript)/[\w\-\\/\.가-힣]+\.' + _EXT, re.IGNORECASE),
]

# [CRITICAL] --agent <name> : 확장자 없는 에이전트 참조 → agents/<name>.md 요구
AGENT_FLAG_PATTERN = re.compile(r'--agent[=\s]+["\']?([A-Za-z0-9가-힣_][A-Za-z0-9가-힣_\-]*)')
# 모델명이 --agent 자리에 잘못 매칭되는 것을 막는 가드 (claude-sonnet-4, gpt-4o 등은 하이픈을 포함하므로 '-' 검사로는 못 거른다)
MODEL_PREFIXES = ('claude', 'gpt', 'sonnet', 'haiku', 'opus', 'gemini', 'gemma', 'llama', 'o1', 'o3', 'mistral')


def looks_like_agent(name):
    """실제 에이전트 네이밍 규칙(tc-/qa- 접두 또는 -v<digit> 접미)만 통과. 모델명/플레이스홀더 제외."""
    low = name.lower()
    if low.startswith(MODEL_PREFIXES):
        return False
    return name.startswith(('tc-', 'qa-')) or bool(re.search(r'-v\d', name))

# [HIGH] node 스크립트가 path.join(__dirname, '...gs|json|js') 로 부르는 동반 파일
COMPANION_PATTERN = re.compile(r"""['"]([\w\-./가-힣]+\.(?:gs|json|js))['"]""", re.IGNORECASE)

# 런타임 생성·gitignore 대상이라 배포물이 아닌 참조(오탐) — 검사 제외
RUNTIME_VAR_ROOTS = ('$SPEC', '${SPEC}', '$TEAM', '${TEAM}', '$STATE', '${STATE}',
                     '$STATUS', '${STATUS}', '$SNAP', '${SNAP}',
                     '$FEATURE_NAME', '${FEATURE_NAME}', '$FEAT', '${FEAT}', '$TAB', '${TAB}')
RUNTIME_PATH_SUBSTR = ('team/state', 'team/status', 'team/specs', 'team/batch_config',
                       'team/history', '/specs/', '_snapshot', 'tc_after_fix',
                       'confluence_raw', 'sheet_info', 'learned_patterns')


# 같은 줄에서 "이 파일은 폐기/삭제됨"을 명시하면 누락 참조로 보지 않는다(죽은 포인터 안내문)
DEPRECATION_RE = re.compile(r'폐기|deprecated|참조\s*금지|죽은\s*포인터|삭제됨|removed|더 이상 사용', re.IGNORECASE)


def line_of(text, pos):
    """text 에서 pos 가 속한 줄 문자열."""
    start = text.rfind('\n', 0, pos) + 1
    end = text.find('\n', pos)
    return text[start: end if end != -1 else len(text)]


def is_runtime_ref(ref):
    """specs/state 등 런타임에 생성되어 레포에 올라가지 않는(gitignore) 참조, 또는 URL이면 True → 검사 스킵."""
    if '://' in ref:                      # http(s):// 등 URL (배지·문서 링크) 오탐 방지
        return True
    if ref.startswith(RUNTIME_VAR_ROOTS):
        return True
    norm = ref.replace('\\', '/').lower()
    return any(s in norm for s in RUNTIME_PATH_SUBSTR)


def build_existing_index():
    """staging 내 실제 파일 집합 (rel-posix 경로 + basename 양쪽)."""
    existing = set()
    for ext in INDEX_EXTENSIONS:
        for p in STAGING.rglob(f'*{ext}'):
            if '.git' in p.parts or 'node_modules' in p.parts:
                continue
            existing.add(p.relative_to(STAGING).as_posix())
            existing.add(p.name)
    return existing


def normalize_ref(ref):
    """참조 문자열을 staging 상대경로 후보로 정규화."""
    basename = Path(ref).name
    stripped = re.sub(r'^[{$][A-Z_]+[}]?[/\\]', '', ref)
    stripped = re.sub(
        r'^[A-Z]:[/\\][\w\-\\\.]+?[/\\](?=(agents|skills|scripts|tc-team-v2|docs|appscript|commands))',
        '', stripped, flags=re.IGNORECASE)
    stripped = re.sub(r'^/[a-z]/[\w\-/\.]+?/(?=(agents|skills|scripts|tc-team-v2|docs|appscript|commands))',
                      '', stripped, flags=re.IGNORECASE)
    stripped = stripped.replace('\\', '/')
    return basename, stripped


def main():
    if not STAGING.exists():
        print(f"[FAIL] staging 경로가 없음: {STAGING}")
        sys.exit(1)

    existing = build_existing_index()
    # agents/ 에 실제 존재하는 에이전트 stem 집합 (basename 없는 이름)
    agent_files = {p.stem for p in STAGING.rglob('agents/*.md')}

    missing_refs = defaultdict(list)      # 경로형 참조 누락
    missing_agents = defaultdict(set)     # --agent <name> 인데 agents/<name>.md 없음
    missing_companions = defaultdict(set)  # node 동반 파일(.gs 등) 누락

    for ext in SCAN_EXTENSIONS:
        for source in STAGING.rglob(f'*{ext}'):
            if '.git' in source.parts or 'node_modules' in source.parts:
                continue
            try:
                text = source.read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            src_rel = source.relative_to(STAGING).as_posix()

            # 1) 경로형 참조
            for pattern in PATH_PATTERNS:
                for m in pattern.finditer(text):
                    ref = m.group(0)
                    if is_runtime_ref(ref):       # specs/state 등 런타임 산출물(gitignore) 오탐 제외
                        continue
                    if DEPRECATION_RE.search(line_of(text, m.start())):  # "폐기됨" 안내문 내 죽은 포인터
                        continue
                    basename, stripped = normalize_ref(ref)
                    # 셋업이 .template 에서 생성하는 설정 파일(pipeline_config.json 등)은 .template 존재로 충족
                    if (basename in existing or stripped in existing
                            or f'{basename}.template' in existing):
                        continue
                    missing_refs[src_rel].append(ref)

            # 2) [CRITICAL] --agent <name> 매핑
            for m in AGENT_FLAG_PATTERN.finditer(text):
                name = m.group(1)
                # 플레이스홀더(<에이전트명>)·모델명(claude-sonnet-4 등) 방어
                if not looks_like_agent(name):
                    continue
                if name not in agent_files and f'agents/{name}.md' not in existing:
                    missing_agents[src_rel].add(name)

            # 3) [HIGH] .gs 동반 파일 (deploy_appscript.js 등)
            if source.suffix == '.js' and ('__dirname' in text or 'appscript' in text.lower()):
                for m in COMPANION_PATTERN.finditer(text):
                    cand = m.group(1)
                    if not cand.lower().endswith('.gs'):
                        continue  # .gs 동반만 강제 (js/json 오탐 방지)
                    basename = Path(cand).name
                    if basename in existing:
                        continue
                    missing_companions[src_rel].add(cand)

    total = (sum(len(v) for v in missing_refs.values())
             + sum(len(v) for v in missing_agents.values())
             + sum(len(v) for v in missing_companions.values()))

    if total == 0:
        print("[PASS] No missing references found.")
        print(f"       scanned root: {STAGING}")
        print(f"       agents present: {sorted(agent_files)}")
        sys.exit(0)

    print(f"[FAIL] {total} missing references:\n")
    if missing_agents:
        print("  ■ 누락된 에이전트 (--agent <name> -> agents/<name>.md 없음) [CRITICAL]")
        for src, names in sorted(missing_agents.items()):
            print(f"    {src}")
            for n in sorted(names):
                print(f"      ↳ --agent {n}  →  agents/{n}.md 가 staging 에 없음")
    if missing_companions:
        print("  ■ 누락된 동반 파일 (.gs 등)")
        for src, cands in sorted(missing_companions.items()):
            print(f"    {src}")
            for c in sorted(cands):
                print(f"      ↳ {c}")
    if missing_refs:
        print("  ■ 누락된 경로 참조")
        for src, refs in sorted(missing_refs.items()):
            print(f"    {src}")
            for ref in refs[:5]:
                print(f"      ↳ {ref}")
            if len(refs) > 5:
                print(f"      ↳ ... +{len(refs) - 5} more")

    print("\n⛔ STOP. 누락 파일을 staging 에 추가하거나 참조를 제거/수정 후 재검증.")
    sys.exit(1)


if __name__ == '__main__':
    main()
