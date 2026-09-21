#!/usr/bin/env bash
# 安装 DSH「访问管理」功能包到目标源码检出。
#   校验基线 -> git am 三个补丁 -> pnpm install -> pnpm run build
# 用法：./install.sh [--repo <dir>] [--apply] [--no-build] [--no-install] [--force]
set -euo pipefail

readonly PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BASELINE_COMMIT="c291e7961a515f6d7af9304e7fd1d257929aef26"
readonly BASELINE_VERSION="0.1.5-rc.2"
readonly RECORD_NAME="dsh-access-management-install"
readonly PATCHES=(
  "0001-add-per-device-browser-access-directory.patch"
  "0002-refuse-pre-directory-session-cookies.patch"
  "0003-persist-settings-document-off-loopback.patch"
)
readonly FEATURE_FILES=(
  "packages/client/connection/src/browser-access.ts"
  "packages/client/connection/src/access-types.ts"
  "packages/client/connection/src/access-controller.ts"
  "packages/client/ui-settings-access/package.json"
  "packages/client/ui-settings-access/src/client/AccessSettingsSection.tsx"
)

REPO=""
MODE="am"
RUN_INSTALL=1
RUN_BUILD=1
FORCE=0

log() { printf '[install] %s\n' "$*"; }
die() { printf '[install] 错误：%s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

参数：
  --repo <dir>    目标 DSH 源码检出目录（默认当前目录）
  --apply         只改工作区并暂存（git apply --3way --index），不生成提交
  --no-install    跳过 pnpm install
  --no-build      跳过 pnpm run build
  --force         允许脏工作区，或对已安装过的仓库再执行一次
  -h, --help      显示本帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) [[ $# -ge 2 ]] || die "--repo 需要一个目录参数"; REPO="$2"; shift 2 ;;
    --apply) MODE="apply"; shift ;;
    --no-install) RUN_INSTALL=0; shift ;;
    --no-build) RUN_BUILD=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

[[ -n "$REPO" ]] || REPO="$PWD"
[[ -d "$REPO" ]] || die "目录不存在：$REPO"
REPO="$(cd "$REPO" && pwd)"

command -v git >/dev/null 2>&1 || die "未找到 git"
[[ -f "$REPO/package.json" ]] || die "$REPO 下没有 package.json，不是仓库根目录？"
grep -q '"@deepseek-ai/dsh-root"' "$REPO/package.json" \
  || die "$REPO 不是 deepseek-harness 仓库根目录（package.json 名称不是 @deepseek-ai/dsh-root）"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO 不是 git 仓库"

for name in "${PATCHES[@]}"; do
  [[ -f "$PACKAGE_DIR/patches/$name" ]] || die "缺少补丁文件 patches/$name"
done

if [[ -e "$REPO/packages/client/ui-settings-access/package.json" && $FORCE -eq 0 ]]; then
  log "目标仓库里已经存在 packages/client/ui-settings-access —— 看起来已安装过。"
  log "如需重装请加 --force，或先运行 ./uninstall.sh。"
  exit 0
fi

if [[ -n "$(git -C "$REPO" status --porcelain)" && $FORCE -eq 0 ]]; then
  die "工作区不干净，请先提交或贮藏改动（确要继续请加 --force）"
fi

TARGET_VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$REPO/package.json" | head -1)"
if [[ "$TARGET_VERSION" != "$BASELINE_VERSION" ]]; then
  log "警告：目标版本 $TARGET_VERSION 与打包基线 $BASELINE_VERSION 不一致，补丁可能冲突。"
fi
if ! git -C "$REPO" cat-file -e "${BASELINE_COMMIT}^{commit}" 2>/dev/null; then
  log "警告：目标仓库里没有基线提交 ${BASELINE_COMMIT:0:8}（补丁的 3-way 兜底会受限）。"
elif ! git -C "$REPO" merge-base --is-ancestor "$BASELINE_COMMIT" HEAD; then
  log "警告：基线提交不是当前 HEAD 的祖先，按 3-way 尝试。"
else
  log "基线检查通过：$BASELINE_VERSION / ${BASELINE_COMMIT:0:8} 在历史中。"
fi

GIT_DIR="$(git -C "$REPO" rev-parse --absolute-git-dir)"
PRE_SHA="$(git -C "$REPO" rev-parse HEAD)"

if [[ "$MODE" == "am" ]]; then
  if ! git -C "$REPO" config --get user.email >/dev/null 2>&1; then
    export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-dsh-local}"
    export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-dsh-local@localhost}"
    log "目标仓库未配置 user.email，本次提交使用 dsh-local <dsh-local@localhost> 作为 committer。"
  fi
  PATCH_PATHS=()
  for name in "${PATCHES[@]}"; do PATCH_PATHS+=("$PACKAGE_DIR/patches/$name"); done
  log "应用补丁（git am --3way，共 ${#PATCH_PATHS[@]} 个）……"
  if ! git -C "$REPO" am --3way "${PATCH_PATHS[@]}"; then
    git -C "$REPO" am --abort >/dev/null 2>&1 || true
    die "补丁应用失败，已回滚到安装前状态。可用 --apply 模式试，或改用 overlay/ 手工覆盖。"
  fi
  APPLIED_SHAS="$(git -C "$REPO" rev-list --reverse "$PRE_SHA..HEAD" | tr '\n' ' ')"
else
  log "应用补丁（git apply --3way --index，不生成提交）……"
  for name in "${PATCHES[@]}"; do
    if ! git -C "$REPO" apply --3way --index "$PACKAGE_DIR/patches/$name"; then
      die "补丁 $name 应用失败。工作区可能处于半应用状态，请用 git -C '$REPO' reset --hard $PRE_SHA 恢复（会丢弃未提交改动）。"
    fi
  done
  APPLIED_SHAS=""
fi

for file in "${FEATURE_FILES[@]}"; do
  [[ -e "$REPO/$file" ]] || die "补丁应用后仍缺少 $file，安装中止（请检查 Git 输出）"
done
grep -q 'ui-settings-access' "$REPO/packages/bundle/web-app/cordis.patch.yml" \
  || die "包名册 packages/bundle/web-app/cordis.patch.yml 里没有 ui-settings-access 行"

cat > "$GIT_DIR/$RECORD_NAME" <<EOF
MODE=$MODE
PRE_SHA=$PRE_SHA
APPLIED_SHAS="$APPLIED_SHAS"
INSTALLED_AT=$(date -Iseconds)
PACKAGE_VERSION=$BASELINE_VERSION
EOF
log "安装记录已写入 $GIT_DIR/$RECORD_NAME"

if [[ $RUN_INSTALL -eq 1 ]]; then
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，无法安装依赖（可加 --no-install 跳过）"
  log "pnpm install ……"
  (cd "$REPO" && pnpm install)
else
  log "按要求跳过 pnpm install"
fi

if [[ $RUN_BUILD -eq 1 ]]; then
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，无法构建（可加 --no-build 跳过）"
  log "pnpm run build ……（整仓构建，视机器性能需要数分钟）"
  (cd "$REPO" && pnpm run build)
else
  log "按要求跳过 pnpm run build"
fi

cat <<EOF

[install] 完成。
  基线提交   ：$PRE_SHA
  功能提交   ：${APPLIED_SHAS:-（--apply 模式，未提交）}

接下来：
  1) 重启 DSH 进程让新插件生效，例如： systemctl --user restart dsh-web
  2) 用启动日志里的 ?token=... 链接打开页面，进入 设置 -> 访问
  3) 自检： ./verify.sh --repo "$REPO"
  4) 回滚： ./uninstall.sh --repo "$REPO"
EOF
