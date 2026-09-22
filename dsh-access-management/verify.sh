#!/usr/bin/env bash
# 自检 DSH「访问管理」功能包的安装结果。
# 用法：./verify.sh [--repo <dir>] [--tests]
set -euo pipefail

readonly PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly RECORD_NAME="dsh-access-management-install"

REPO=""
RUN_TESTS=0
PASS=0
FAIL=0
WARN=0

log() { printf '%s\n' "$*"; }
ok() { PASS=$((PASS + 1)); printf '  [ OK ] %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$*"; }
warn() { WARN=$((WARN + 1)); printf '  [WARN] %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) [[ $# -ge 2 ]] || { echo "--repo 需要一个目录参数" >&2; exit 2; }; REPO="$2"; shift 2 ;;
    --tests) RUN_TESTS=1; shift ;;
    -h|--help) sed -n '2,4p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[[ -n "$REPO" ]] || REPO="$PWD"
REPO="$(cd "$REPO" && pwd)"

log "检查目标仓库：$REPO"

file_exists() {
  if [[ -e "$REPO/$1" ]]; then ok "存在 $1"; else bad "缺少 $1"; fi
}
file_absent() {
  if [[ -e "$REPO/$1" ]]; then bad "仍存在 $1（应已被卸载）"; else ok "已移除 $1"; fi
}

log "1) 新增/修改的源码文件"
for file in \
  packages/client/connection/src/browser-access.ts \
  packages/client/connection/src/access-types.ts \
  packages/client/connection/src/access-controller.ts \
  packages/client/connection/src/browser-auth.ts \
  packages/api/remotes/src/client/index.ts \
  packages/client/ui-settings-access/package.json \
  packages/client/ui-settings-access/src/client/index.ts \
  packages/client/ui-settings-access/src/client/AccessSettingsSection.tsx; do
  file_exists "$file"
done

log "2) 名册与聚合注册"
if grep -q 'ui-settings-access' "$REPO/packages/bundle/web-app/cordis.patch.yml" 2>/dev/null; then
  ok "packages/bundle/web-app/cordis.patch.yml 含 ui-settings-access 行"
else
  bad "packages/bundle/web-app/cordis.patch.yml 缺少 ui-settings-access 行"
fi
if grep -q 'dsh-client-ui-settings-access' "$REPO/packages/bundle/web-app/package.json" 2>/dev/null; then
  ok "packages/bundle/web-app/package.json 声明了新包依赖"
else
  bad "packages/bundle/web-app/package.json 未声明 @deepseek-ai/dsh-client-ui-settings-access"
fi
if grep -q 'ui-settings-access' "$REPO/tsconfig.client.json" 2>/dev/null; then
  ok "tsconfig.client.json 注册了新包"
else
  bad "tsconfig.client.json 未注册 packages/client/ui-settings-access"
fi
if grep -q 'packages/client/connection/tsconfig.host.json' "$REPO/tsconfig.host.json" 2>/dev/null; then
  ok "tsconfig.host.json 注册了 connection 的 Host 编译面"
else
  bad "tsconfig.host.json 未注册 packages/client/connection/tsconfig.host.json"
fi

log "3) 构建产物"
for artifact in \
  packages/client/connection/lib/client.js \
  packages/client/connection/lib/index.js \
  packages/client/connection/lib/typert.host.js \
  packages/client/connection/lib/typert.remote-client.js \
  packages/client/ui-settings-access/lib/client.js \
  packages/api/remotes/lib/client.js; do
  if [[ -e "$REPO/$artifact" ]]; then
    ok "已构建 $artifact"
  else
    warn "缺少构建产物 $artifact（尚未 pnpm run build？）"
  fi
done
if [[ -e "$REPO/.dsh-build/client-build-environment.json" ]]; then
  ok "客户端构建记录 .dsh-build/client-build-environment.json 存在"
else
  warn "缺少 .dsh-build/client-build-environment.json（需要完整 pnpm run build 生成）"
fi

log "4) 安装记录"
GIT_DIR="$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null || true)"
if [[ -n "$GIT_DIR" && -f "$GIT_DIR/$RECORD_NAME" ]]; then
  ok "安装记录 $GIT_DIR/$RECORD_NAME"
  sed 's/^/       /' "$GIT_DIR/$RECORD_NAME"
else
  warn "没有安装记录 $RECORD_NAME（可能用 --apply 手工装的）"
fi

if [[ $RUN_TESTS -eq 1 ]]; then
  log "5) 运行相关测试（vitest）"
  if (cd "$REPO" && pnpm exec vitest run \
      packages/client/connection/tests/browser-access.host.spec.ts \
      packages/client/connection/tests/browser-auth.host.spec.ts \
      packages/client/ui-settings-access/tests/AccessSettingsSection.client.spec.tsx); then
    ok "功能相关测试通过"
  else
    bad "功能相关测试失败（见上方输出）"
  fi
fi

log ""
log "结果：通过 $PASS，失败 $FAIL，警告 $WARN"
[[ $FAIL -eq 0 ]] || exit 1
log "静态自检通过。别忘了重启 DSH 进程，并在页面上做一次「新建令牌 -> 设备出现 -> 登出 401」的实测。"
