# dshplugin · 自研 DSH 插件仓库

收集我做的所有 DeepSeek Harness（DSH）插件。**一个插件一个顶层目录**，目录名即插件名，直接放在仓库根，每个插件自带 README、安装脚本与适配基线说明。

> 本仓库是**私有**仓库：需要访问权限的账号才能 clone，没有匿名 raw 链接。

## 插件清单

| 插件 | 做什么 | 形态 | 适配基线 | 目录 |
| --- | --- | --- | --- | --- |
| **dsh-mobile-ui** | DSH Web 移动端 UI 优化（iOS / Android / 鸿蒙 UA 生效）：侧栏改悬浮抽屉、底部输入区可收缩成圆点、设置面板整屏化、手机下隐藏滚动条 | 标准 DSH profile 插件包（`dsh plugin add`，不动 DSH 源码） | DSH 0.1.5-rc 系 | [`dsh-mobile-ui/`](dsh-mobile-ui/) |
| **dsh-access-management** | 设置页新增「访问」分区：命名登录令牌 + 一次性登录链接 + 设备列表 / 重命名 / 登出 / 整批吊销 | DSH 源码补丁包（目标机需是 DSH 源码检出） | DSH `0.1.5-rc.2`（`c291e79`） | [`dsh-access-management/`](dsh-access-management/) |

## 安装：两类插件方式不同

### 1）profile 插件包（推荐，可干净卸载）

不动 DSH 源码，只写用户级 profile（`~/.dsh/profiles/<name>/`），升级 DSH 不受影响。

```sh
# 一行（已配好 Gitee SSH key 的机器，把仓库链接换成插件名即可装任意插件）
tmp=$(mktemp -d) && git clone --depth 1 git@gitee.com:rhtcai/dshplugin.git "$tmp/dshplugin" \
  && bash "$tmp/dshplugin/dsh-mobile-ui/install.sh"

# 或者分两步：先 clone，再按插件跑各自的 install.sh
git clone git@gitee.com:rhtcai/dshplugin.git
bash dshplugin/dsh-mobile-ui/install.sh        # 一键：备份 profile → dsh plugin add → 自查提示

# 等价的纯手工方式：
dsh plugin --profile web add ./dshplugin/dsh-mobile-ui
systemctl --user restart dsh-web                        # bundles 层栈在进程启动时组装，装完重启一次
```

### 2）源码补丁包（给 DSH 源码检出用）

```sh
git clone git@gitee.com:rhtcai/dshplugin.git
cd /path/to/deepseek-harness
bash ../dshplugin/dsh-access-management/install.sh --repo .   # git am 补丁 → pnpm install → pnpm run build
bash ../dshplugin/dsh-access-management/verify.sh  --repo .   # 自检
```

细节见该目录下的 [`交付说明.md`](dsh-access-management/交付说明.md)（含前置条件、页面验证清单、回滚与排障）。


### 若把仓库改为公开：链接即可匿名安装

公开后不需要任何 Gitee 凭据，tarball 有稳定的 raw 链接：

```sh
curl -fL -o /tmp/dsh-mobile-ui.tgz \
  https://gitee.com/rhtcai/dshplugin/raw/main/dsh-mobile-ui/dist/dsh-mobile-ui-0.2.2.tgz
dsh plugin --profile web add /tmp/dsh-mobile-ui.tgz
systemctl --user restart dsh-web        # 首次装完重启一次
```

新版发布流程：在插件目录 \`npm pack --pack-destination dist\`，把新 tarball 一起提交，然后把上面链接里的版本号换掉。

## 目录约定

```
<插件名>/
├── README.md        插件说明：功能、适配基线、安装、排障
├── install.sh       一键安装（支持 --dry-run / --help）
├── DEPLOY.md        部署手册（部分插件有）
└── ...              插件自身产物（client.js / patches / dist/ 等）
```

新增插件时：目录名取插件名；README 写清「适配基线 / 安装 / 卸载 / 排障」；安装脚本支持 `--dry-run` 与 `--help`；不要把插件文件放在仓库根。

## 历史

- **2026-09-21**：仓库只有 dsh-mobile-ui 一个插件，文件直接放在仓库根。
- **2026-09-21**：规整为「一插件一目录」，插件移入 `plugins/<插件名>/`（随后短暂更名为 `dsh-plugins/<插件名>/`）；新增访问管理功能包。
- **2026-09-21（本次）**：拍平目录层级——两个插件目录直接放在仓库根（`dsh-mobile-ui/`、`dsh-access-management/`）；本地检出名由 `dsh-mobile-ui` 改为 `dsh-plugins`；README / DEPLOY.md / install.sh 路径同步更新。旧根路径的 `git+https://gitee.com/rhtcai/dshplugin.git` 安装方式作废——git 依赖只认仓库根的 `package.json`。
