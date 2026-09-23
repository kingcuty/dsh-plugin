# dsh-mobile-ui 部署手册

把 **DSH Web 的移动端 UI 优化**装到任意一台机器（本机或别人的机器）上的完整步骤。
插件只写用户级 profile（`~/.dsh/profiles/<name>/`），不改 DSH 源码，卸载后完全回到官方布局。

- 适配基线：**DSH 0.1.5-rc 系**（2026-09-21 在鸿蒙 390×844 实机验证）
- 生效范围：UA 命中 **iOS / Android / 鸿蒙** 且框架宽度 **< 1024px**；桌面与窄桌窗口保持官方布局

---

## 0. 前置条件

| 项 | 要求 |
| --- | --- |
| DSH | 0.1.5-rc 系（更高版本见第 4 节「升级适配」） |
| Node | ≥ 22（与 DSH 自身要求一致） |
| pnpm | 需要在 PATH 上：`dsh plugin` 内部就是调用 pnpm 管理 profile 依赖 |
| profile | 默认 `web`，目录 `~/.dsh/profiles/web/` |
| 手机 | 系统浏览器（华为浏览器 / Safari / Chrome 均可） |

安装前建议先备份 profile：

```sh
cp -a ~/.dsh/profiles/web ~/.dsh/backups/web-profile-$(date +%Y%m%d-%H%M%S)
```

---

## 1. 拿到包

| 来源 | 说明 |
| --- | --- |
| 本仓库 | 插件位于仓库的 **`dsh-mobile-ui/`** 目录。公开副本：<https://github.com/kingcuty/dsh-plugin>（匿名可 clone / raw 下载）；私有副本：<https://gitee.com/rhtcai/dshplugin>（需有访问权限的账号） |
| 打包产物 | `dsh-mobile-ui/dist/dsh-mobile-ui-<version>.tgz`（`npm pack --pack-destination dist` 生成） |
| 安装脚本 | `dsh-mobile-ui/install.sh` —— 等价于 2.1 的手工步骤，另加 profile 备份与结果自查 |

> 仓库已按「一插件一目录」规整为 `<插件名>/`，仓库根不再是包，
> 因此旧的 `dsh plugin add git+https://gitee.com/rhtcai/dshplugin.git` **不再适用**（git 依赖只认仓库根的 `package.json`）。
> 改用下面的仓库内路径、仓库内 tarball，或直接跑 `install.sh`。

---

## 2. 安装

### 2.1 一条命令（推荐）

```sh
dsh plugin --profile web add <来源>
# 例：
git clone --depth 1 https://github.com/kingcuty/dsh-plugin.git            # 公开仓库，无需凭据
dsh plugin --profile web add ./dshplugin/dsh-mobile-ui            # 仓库里的插件目录（推荐）
dsh plugin --profile web add ./dshplugin/dsh-mobile-ui/dist/dsh-mobile-ui-0.2.23.tgz  # 仓库里的 tarball
dsh plugin --profile web add /abs/path/dsh-mobile-ui                      # 任意本地目录
dsh plugin --profile web add dsh-mobile-ui                                # npm 上（发布后）

# 首次安装后重启一次（bundles 层栈在进程启动时组装）
systemctl --user restart dsh-web
```

原理：包清单里声明了 `dsh.bundle.patch`，CLI 会把「解析到声明了 `dsh.bundle` 的依赖」自动并入 profile 的 `dsh.profile.bundles` 层栈（见 `apps/cli/src/plugin.ts` 的 reconcile 逻辑），插件自带的 `cordis.patch.yml` 因此被叠加生效。

### 2.2 补丁层热加载（不能重启服务时）

```sh
P=~/.dsh/profiles/web
ln -sfn /abs/path/dsh-mobile-ui $P/node_modules/dsh-mobile-ui
node -e "const f=process.env.HOME+'/.dsh/profiles/web/package.json';const fs=require('fs');const m=JSON.parse(fs.readFileSync(f,'utf8'));m.dependencies['dsh-mobile-ui']='file:/abs/path/dsh-mobile-ui';fs.writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
# 再往 $P/cordis.patch.yml 末尾追加：
#   - insert:
#       - id: mobile-ui
#         name: dsh-mobile-ui
```

保存即生效（profile 补丁层支持热加载），**浏览器刷新一次**即可看到。
profile 的 `pnpm-lock.yaml` 没同步是正常现象，下次在该目录跑 `pnpm install` 会正式落盘。

### 2.3 隔离验证（建议先做，不动现网）

```sh
HOME=/tmp/dshm-isolated dsh --profile web web --port 3099
```

对照两组：带 `mobile-ui` 行 vs 不带该行，确认「生效 / 回到官方」两种形态都符合预期。

---

## 3. 验证清单

装完按顺序过一遍：

1. **手机浏览器**打开 DSH Web：左上角出现抽屉把手、右下角出现蓝色收缩圆点 → 点圆点应能展开输入卡片；
2. **桌面浏览器**打开同一地址：与官方完全一致（框架左侧仍是 280px 侧栏，无任何插件痕迹）；
3. **设置 → 通用**：出现「移动端优化」一行，下拉为 **启用 / 停用**；切到停用应立即回到官方布局，切回启用立即恢复；
4. **控制台**：不应出现 `[mobileUi] DSH DOM seam missing: …`（出现说明该 DSH 版本改了结构属性，见第 4 节）；
5. **单测**：`cd <插件目录> && node --test` → 6 项全过。

---

## 4. 升级适配（DSH 升级后怎么快速跟上）

插件只依赖**公开的 DOM 属性**与**公开的客户端模块**（`react`、`@deepseek-ai/dsh-client-*`），不 import 官方源码路径，因此 DSH 升级不会与它冲突。万一官方重命名了某个属性：

1. **看控制台**：插件首次在手机 UA 接管时会自检结构缝并点名 ——
   `[mobileUi] DSH DOM seam missing: card [data-composer-card] — this DSH build renamed them, update SEAMS in client.js`
2. **只改一张表**：全部上游选择器集中在 `client.js` 顶部的 `SEAMS` 字典（14 条）。改名通常就是改一个字符串；
3. **跑自检**：`node --test`（含回归用例 `names the upstream seam that a future DSH build renames`），再刷新手机确认布局。

**CSS 侧的缝**同样集中在 `client.js` 的 `CSS` 模板里，用的都是属性选择器（`[data-composer-card]`、`[data-phase='active']`、`[data-queue-dock]`、`[data-testid='todo-panel']`、`[role='dialog'][aria-modal='true']` 等）。

---

## 5. 卸载 / 回滚

```sh
dsh plugin --profile web remove dsh-mobile-ui
systemctl --user restart dsh-web     # 热加载只增不减，已挂载的行需要冷启动才会卸载
```

走补丁层安装的：删掉 `cordis.patch.yml` 里那段 `insert` 行，重启一次即可。

**只想临时关掉**：设置 → 通用 → 移动端优化 → 停用（不卸载，立即回到官方布局；偏好按浏览器保存）。

卸载后不残留：`<html data-dshm>`、框架上的 `--dshm-*`、注入的 `<style>`、两个 `shell.overlay` 条目都会随插件生命周期移除。

---

## 6. 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 手机上看不到任何变化 | UA 不含手机标识 / 框架宽度 ≥ 1024px / 开关被停用 / 页面没刷新 | 确认是手机浏览器；设置里看「移动端优化」是否为启用；刷新页面 |
| 一切正常但**桌面**也变了 | 不应发生 | 检查是否用手机 UA 模拟器打开了桌面窗口；确认 `<html>` 上没有 `data-dshm` |
| 左上角把手 / 右下角圆点不见了 | 结构缝被上游改名（控制台会有 seam 警告） | 按第 4 节改 `SEAMS` 表；或先停用开关回到官方布局 |
| 装完刷新没生效 | 走的是 bundles 层栈安装，而进程还没重启 | `systemctl --user restart dsh-web`，或改用第 2.2 节的热加载路径 |
| 卸载后侧栏仍是 56px 轨道 | 官方侧栏自身处于收起态 | 点开即可；插件停用时会自动把侧栏恢复展开 |
| 设置里没有「移动端优化」一行 | 插件未加载 / 未在手机 UA 下 | 先确认第 3 节第 1 条；桌面 UA 下这一行同样可见（用于验证开关） |

---

## 7. 分享给别人

```sh
npm pack --pack-destination dist        # 生成 dist/dsh-mobile-ui-0.2.23.tgz
```

把 tarball 发给对方，对方执行：

```sh
dsh plugin --profile web add ./dsh-mobile-ui-0.2.23.tgz
systemctl --user restart dsh-web
```

或者**直接让对方用公开副本**（最省事，不用发文件，对方无需任何凭据）：

```sh
git clone --depth 1 https://github.com/kingcuty/dsh-plugin.git
dsh plugin --profile web add ./dsh-plugin/dsh-mobile-ui
systemctl --user restart dsh-web
```

也可以发布到 npm 后用包名安装。tarball 内含：`client.js`、`index.mjs`、`cordis.patch.yml`、`package.json`、`README.md`、`DEPLOY.md`。

---

## 8. 版本矩阵

| 插件版本 | 适配 DSH | 验证环境 | 内容 |
| --- | --- | --- | --- |
| 0.2.1 | 0.1.5-rc 系 | 鸿蒙 390×844（华为浏览器）、桌面 2560×1440 | 同 0.2.0，修复设置面板无法上下滑动（列方向 flex 子项补 min-height: 0） |
| 0.2.0 | 0.1.5-rc 系 | 鸿蒙 390×844（华为浏览器）、桌面 2560×1440 | 抽屉侧栏、可收缩输入区、队列/任务卡对齐、选项卡收进 ⋯、动效（含长会话降级）、设置面板手机化、设置内「移动端优化」开关 |
