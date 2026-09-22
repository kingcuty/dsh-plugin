#!/usr/bin/env bash
# 卸载 DSH「访问管理」功能包：按安装记录 revert 功能提交，然后重新构建。
# 用法：./uninstall.sh [--repo <dir>] [--no-build] [--hard]
set -euo pipefail

readonly RECORD_NAME="dsh-access-management-install"

REPO=""
RUN_BUILD=1
HARD=0

log() { printf '[uninstall] %s\n' "$*"; }
die() { printf '[uninstall] 错误：%s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) [[ $# -ge 2 ]] || die "--repo 需要一个目录参数"; REPO="$2"; shift 2 ;;
    --no-build) RUN_BUILD=0; shift ;;
    --hard) HARD=1; shift ;;
    -h|--help) sed -n '2,3p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done
[[ -n "$REPO" ]] || REPO="$PWD"
REPO="$(cd "$REPO" && pwd)"
GIT_DIR="$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null || true)"
[[ -n "$GIT_DIR" && -f "$GIT_DIR/$RECORD_NAME" ]] || die "没有安装记录 $RECORD_NAME；请手工回滚（git revert / git reset）"
# shellcheck disable=SC1090
source "$GIT_DIR/$RECORD_NAME"

if [[ "${MODE:-am}" == "am" ]]; then
  if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    die "工作区不干净，请先提交或贮藏改动再卸载"
  fi
  [[ -n "${APPLIED_SHAS:-}" ]] || die "安装记录里没有提交列表，无法自动 revert"
  if ! git -C "$REPO" config --get user.email >/dev/null 2>&1; then
    export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-dsh-local}"
    export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-dsh-local@localhost}"
    export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-dsh-local}"
    export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-dsh-local@localhost}"
    log "目标仓库未配置 user.email，本次 revert 使用 dsh-local <dsh-local@localhost> 作为提交身份。"
  fi
  # 栈式卸载：后应用的先撤销，每一步的 pre-image 才和当前树一致
  REVERT_ORDER=""
  for sha in ${APPLIED_SHAS}; do REVERT_ORDER="$sha $REVERT_ORDER"; done
  log "按逆序 revert：$REVERT_ORDER"
  # shellcheck disable=SC2086
  if ! git -C "$REPO" revert --no-edit $REVERT_ORDER; then
    git -C "$REPO" revert --abort >/dev/null 2>&1 || true
    die "revert 失败，已恢复到卸载前状态；请手工处理（git -C '$REPO' revert <sha>）"
  fi
  log "revert 完成"
else
  [[ $HARD -eq 1 ]] || die "安装时用的是 --apply（改动未提交）。请手工执行：git -C '$REPO' checkout -- . 并删除 packages/client/ui-settings-access，或加 --hard 让脚本 reset 到安装前提交 $PRE_SHA"
  log "reset --hard 回安装前提交：$PRE_SHA"
  git -C "$REPO" reset --hard "$PRE_SHA"
  git -C "$REPO" clean -fd packages/client/ui-settings-access 2>/dev/null || true
fi

rm -f "$GIT_DIR/$RECORD_NAME"

if [[ $RUN_BUILD -eq 1 ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    log "pnpm install && pnpm run build ……"
    (cd "$REPO" && pnpm install && pnpm run build)
  else
    log "未找到 pnpm，跳过重新构建"
  fi
fi

log "卸载完成。别忘了重启 DSH 进程。"
