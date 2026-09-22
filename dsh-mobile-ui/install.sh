#!/usr/bin/env bash
# dsh-mobile-ui 一键安装脚本（DSH Web 移动端 UI 优化插件）
#
# 用法：
#   git clone git@gitee.com:rhtcai/dshplugin.git
#   bash dshplugin/dsh-mobile-ui/install.sh        # 默认用本脚本所在目录作为安装源
#   bash install.sh --profile web --restart                # 装完顺带重启 web 服务
#   bash install.sh --dry-run                              # 只打印将执行的动作
#   bash install.sh --source /abs/path/dsh-mobile-ui       # 显式指定安装源（本地目录或 .tgz）
#
# 行为：备份 profile → dsh plugin add（包自带 bundle 补丁，CLI 自动并入层栈）→ 打印生效与自查步骤。
# 默认 **不重启** 服务：重启会中断正在跑的会话/任务，请在合适时机自己执行（或加 --restart）。
#
# 注意：本仓库把插件统一放在 <插件名>/，仓库根不再是包，
#   所以旧的 `dsh plugin add git+https://gitee.com/rhtcai/dshplugin.git` 不再适用。
set -euo pipefail

PROFILE=web
SOURCE=""
RESTART=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要一个名字}"; shift 2 ;;
    --source)  SOURCE="${2:?--source 需要一个包规格}"; shift 2 ;;
    --restart) RESTART=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE}"
say() { printf '%s\n' "$*"; }
run() { say "+ $*"; [ "$DRY" = 1 ] || "$@"; }

if [ -z "$SOURCE" ]; then
  if [ -f "${PLUGIN_DIR}/package.json" ]; then
    SOURCE="$PLUGIN_DIR"
  else
    say "✗ 本脚本不在插件目录里，找不到安装源"
    say "  用法：bash install.sh --source <插件目录或 .tgz>"
    exit 1
  fi
fi

say "== dsh-mobile-ui 安装 =="
say "profile : ${PROFILE}   (${PROFILE_DIR})"
say "source  : ${SOURCE}"
say ""

command -v node >/dev/null 2>&1 || { say "✗ 找不到 node"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { say "✗ 找不到 pnpm：dsh plugin 用它管理 profile 依赖，请先安装 pnpm"; exit 1; }
if ! command -v dsh >/dev/null 2>&1; then
  say "✗ 找不到 dsh 命令，请先把 DSH 的 dsh 放进 PATH"
  say "  （从源码树使用时也可以直接：node <checkout>/apps/cli/lib/bin.js plugin --profile ${PROFILE} add ${SOURCE}）"
  exit 1
fi

if [ -f "${PROFILE_DIR}/package.json" ]; then
  BACKUP="${PROFILE_DIR}.bak.$(date +%Y%m%d-%H%M%S)"
  say "-- 备份现有 profile：${BACKUP}"
  [ "$DRY" = 1 ] || cp -a "${PROFILE_DIR}" "${BACKUP}"
else
  say "-- profile 不存在，dsh plugin 会自动初始化（官方模板）"
fi

run dsh plugin --profile "${PROFILE}" add "${SOURCE}"

if [ "$DRY" = 0 ]; then
  if grep -q 'dsh-mobile-ui' "${PROFILE_DIR}/package.json"; then
    say "✓ 依赖已写入 ${PROFILE_DIR}/package.json"
  else
    say "✗ 依赖没写进去，请检查上面 pnpm 的输出"
    exit 1
  fi
  node -e "
    const fs=require('fs');
    const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    const list=(m.dsh&&m.dsh.profile&&m.dsh.profile.bundles)||[];
    console.log(list.includes('dsh-mobile-ui')
      ? '✓ 已并入 profile 的 bundles 层栈（补丁随启动生效）'
      : '! bundles 列表里没有 dsh-mobile-ui：本机 CLI 未做自动 reconcile，请按 DEPLOY.md 2.2 用补丁层热加载');
  " "${PROFILE_DIR}/package.json" || true
fi

say ""
say "== 生效 =="
if [ "$RESTART" = 1 ]; then
  run systemctl --user restart dsh-web
  say "✓ 已重启 dsh-web"
else
  say "还需重启一次 web 服务（bundles 层栈在进程启动时组装）："
  say "    systemctl --user restart dsh-web"
  say "注意：重启会中断正在进行的会话与任务——请在合适时机执行；"
  say "     不能重启时改用补丁层热加载（DEPLOY.md 2.2，保存即生效，刷新页面即可）。"
fi

say ""
say "== 装完自查 =="
say "1) 手机浏览器打开 DSH Web：左上出现抽屉把手、右下出现蓝色收缩圆点"
say "2) 设置 → 通用：多出「移动端优化」一行，可切 启用 / 停用"
say "3) 桌面浏览器打开同址：与官方完全一致（不应有任何变化）"
say "4) 浏览器控制台：不应出现 [mobileUi] DSH DOM seam missing 警告"
say ""
say "卸载：dsh plugin --profile ${PROFILE} remove dsh-mobile-ui && systemctl --user restart dsh-web"
