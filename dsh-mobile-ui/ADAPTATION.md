# DSH 升级后的适配要求与验收（dsh-mobile-ui）

**这份文档解决什么**：DSH 每升一个版本，官方可能重命名插件的接入点（DOM 缝）。本文档把「升级后怎么适配」和「改完怎么算合格」固定成一轮可执行、可判定的标准动作——每次升级只需照着走一遍，就能确认插件在新版上回到基线，并留下可追溯的记录。

**适用触发**：DSH 跟到一个新 rc tag 之后（本机策略：跟 rc，不跟 alpha）。alpha 不必走。

**执行时机**：先在隔离环境演练通过，再动现网。

---

## 一、适配基线（每次适配后必须更新此表）

| 项 | 值 |
| --- | --- |
| DSH 版本 / 上游 commit | `0.1.7-rc.2` / `477b4f4` |
| 适配完成日期 | 2026-09-26 |
| 适配人 | kingcuty |
| `SEAMS` 条数 / 必需条数 | 15 / 7 |
| 单测 | `node --test` 6/6 通过 |
| 实机验收（§4 A–D、F、G） | 通过（鸿蒙 ArkWeb，390×844） |
| 性能验收（§4 E） | 通过（6912 节点长会话：打开 72ms、滚动 12 次 733ms） |
| 结论 | ✅ 可用 |

> 基线一旦更新，README「升级适配」章节里那句适配基线也要同步改，避免两处说法漂移。

---

## 一点五、0.1.7-rc.2 适配实录（本流程的由来）

这次适配推翻了"升级适配 = 改选择器"的直觉，所以把事实记在这里：

| 事实 | 结果 |
| --- | --- |
| 官方 DOM 缝 | **15 条全部命中，一条没改**——0.1.5-rc → 0.1.7-rc.2 官方没动插件的接入点 |
| 真正的事故 | 手机上打开长会话**整页点不动、滚动也不动，只能刷新**（滚动走合成器线程，连它都不动即主线程 100% 占用） |
| 根因 | 不是缝坏了，是插件自己：`document.body` 的 `{childList, subtree}` 观察器**每插入一个节点跑一次全量测量**（5 次全文档查询 + 强制布局，实测单次 2.6ms≈手机一帧）。长会话挂载上千个节点，于是整个挂载期间每帧都在测量，主线程占满 |
| 修复 | 所有结构/尺寸/属性观察器统一走 `scheduleRefresh`（`REFRESH_DEBOUNCE_MS = 150ms` 防抖）；直接交互仍由 store 订阅立即刷新 |
| 第二个坑 | 改完源码"没生效"——文本类工具改写文件会**断开 pnpm 硬链接**，源文件变成新 inode，运行时仍读旧文件 |
| 第三个坑 | 升级后手机首次加载明显变慢——插件包 `rev` 随内容变化，升级后缓存失效要重下整包（58 个模块 / 5.3MB gzip）；属于预期，刷新一次即命中缓存 |

**由此确定的四条验收原则**：

1. **缝零改动也要走完整流程**——接入点稳定不代表行为没回归，性能与交互必须实测；
2. **性能是一等验收项**（§4 E），不是"顺手看看"；任何新增的观察器/测量路径都要按 E3 检查放大倍数，禁止在结构观察器里直连 `refresh()`；
3. **改完必须验证运行时同步**（§3 步骤 3 与 G4 的 inode 比对），否则会误判成"改了没用"；
4. **升级后首次加载变慢属预期**，第二次仍慢才按故障排查。

---

## 二、红线：允许改什么，不允许改什么

**允许改**（全部集中在 `client.js`）：

1. 顶部 `SEAMS` 表里的选择器字符串——这是唯一为"官方改名"准备的位置；
2. `REQUIRED_SEAMS` 的成员——仅当官方**新增或移除**结构缝时调整；
3. 具名阈值常量：`NARROW_MAX`(1024)、`REFRESH_DEBOUNCE_MS`(150)、`ANIMATED_NODES_MAX`(600)、`MOBILE_PLATFORM`(正则)；
4. `CSS` 模板里引用官方类名的选择器（如 `[class*='toBottomSlot']`）。

**不允许改**：

1. 不改任何官方文件——`deepseek-harness` 仓库 `git status` 必须干净；
2. 不 `import` 官方源码路径，只用公开客户端模块（`react`、`@deepseek-ai/dsh-client-*`）与 `data-*` 属性；
3. 不写"按版本号分支"的兼容代码（`if (version >= x)`）——适配靠选择器收敛，不靠版本判断；
4. 不用"关掉自检/观察器"来掩盖问题——性能不达标要按 §5 处置，不能删监测点。

---

## 三、标准化适配流程（一轮跑完，顺序固定）

### 步骤 0 · 前置：新版已运行、旧版已备份

```bash
# 新版起来后确认页面可访问（带 token 的 URL 由 dsh web 打印）
dsh web --no-open --trusted-host <host>
# 建议先备份现有插件目录，便于回退
cp -a ~/.dsh/profiles/web/node_modules/dsh-mobile-ui /tmp/dsh-mobile-ui.bak-$(date +%Y%m%d-%H%M%S)
```

### 步骤 1 · 采集新版的 DOM 缝

在**新版 DSH 的手机视口**里打开 GUI，控制台执行附录 §6.1 的采集脚本，得到两份清单：

- **A. 当前版本全部 `data-*` 属性名**——与上一版基线对比，能一眼看出官方把哪个属性改名了；
- **B. `SEAMS` 逐条命中情况**——直接告诉你哪条缝失效。

同时插件自身也会在第一次接管时报缺失：

```
[mobileUi] DSH DOM seam missing: card [data-composer-card] — this DSH build renamed them, update SEAMS in client.js
```

### 步骤 2 · 只改 `SEAMS` 表

按步骤 1 的输出，把失效的选择器换成新版名字。判断依据：

- 属性改名 → 改对应的选择器字符串；
- 属性消失但功能还在 → 找同一语义的稳定 `data-*` 或 `role`，优先选 `data-*`；
- 缝彻底不存在了 → 把该条目从 `REQUIRED_SEAMS` 降为可选，并**关掉依赖它的子功能**（在 `refresh()` 里加 `seam(...) === null` 短路），不要用脆弱的类名硬凑。

### 步骤 3 · 同步到运行时（易漏，务必执行）

改完源文件**必须**确认运行时副本同步。文本类编辑器/工具改写文件会断开 pnpm 的硬链接（源文件变成新 inode，`node_modules` 里仍是旧文件），表现为"改了却没生效"：

```bash
cd <插件目录>
ln -f client.js  ~/.dsh/profiles/web/node_modules/dsh-mobile-ui/client.js
# 验证：两边 inode 必须相同
stat -c '%i %n' client.js ~/.dsh/profiles/web/node_modules/dsh-mobile-ui/client.js
```

### 步骤 4 · 单测与语法

```bash
node --check client.js && node --test     # 期望 6/6 通过
```

### 步骤 5 · 实机验收（§4 的 A–D、F、G）

手机视口 + 真实手机 UA 下逐项过 §4 清单。

### 步骤 6 · 性能验收（§4 的 E）— **不可省略**

每次升级都要重跑。历史事故：`document.body` 的 `childList+subtree` 观察器在每个节点插入时跑一次全量测量，打开长会话时主线程被占满，**整页点不动、滚动也不动，只能刷新**。任何新增的观察器/测量路径都可能重新引入这类问题。

### 步骤 7 · 回退验收（§4 F）

确认插件是"可干净卸下"的：停用开关回到官方布局，卸载后无残留。

### 步骤 8 · 更新基线与文档

1. 更新本文档 §1 基线表；
2. 更新 README 的适配基线与 SEAMS 条数；
3. 版本号 +1（`package.json`），提交信息写清"适配 DSH x.y.z-rc.n"；
4. 两个远端都推：`git push github main && git push origin main`。

---

## 四、验收清单（逐项判据，全部通过才算适配完成）

### A. 结构缝

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| A1 | 必需缝齐全 | 控制台**无** `[mobileUi] DSH DOM seam missing:` 警告 | 手机 UA 首次接管时看控制台 |
| A2 | 自检函数正确 | `missingSeams(空 DOM)` 返回全部 7 条 `REQUIRED_SEAMS` | `node --test` |
| A3 | 可选缝已声明 | `todoPanel`、`queueDock` 仍在 `SEAMS` 里（缺失不算故障） | 读 `client.js` |

### B. 手机端布局

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| B1 | 插件已接管 | `document.documentElement` 上有 `data-dshm` | 控制台 |
| B2 | 左轨归零 | 框架计算值 `grid-template-columns` = `0px <宽> 0px` | 控制台读 `getComputedStyle(frame)` |
| B3 | 侧栏抽屉化 | 侧栏 `position: fixed`、宽约 281px、默认在屏外（`left ≈ -58`，`visibility: hidden`） | 控制台读侧栏 rect |
| B4 | 输入区默认折叠 | `[data-composer-card]` 收起态 `display: none`；`[data-composer-stats]` 常驻可见 | 控制台 |
| B5 | 把手就位 | `[data-dshm-handle]` 在左上角约 (0,6)，28×28 | 控制台读 rect |

### C. 交互

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| C1 | 抽屉可开合 | 点把手 → 侧栏移入（`left: 0`、可见）；点遮罩 → 收回 | 真机点击 |
| C2 | 输入区可收展 | 点圆点 → 卡片展开可输入；再点 → 收起 | 真机点击 |
| C3 | 选中会话后自动收起 | 抽屉里点会话 → 侧栏收回、会话打开 | 真机点击 |
| C4 | 草稿可输入 | 展开后能正常输入文字，多行不被裁 | 真机输入 |
| C5 | 设置项可停用 | 设置→通用→Mobile UI optimisation 选 Disable → `data-dshm` 消失 | 真机操作 |

### D. 桌面端完全不受影响

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| D1 | 不接管 | 桌面 UA 下无 `data-dshm`、无把手/圆点 | 桌面浏览器 |
| D2 | 官方布局 | 三轨保持官方求解值（如 1440 宽下 `280px … 0px`） | 控制台读计算值 |
| D3 | 无副作用 | 控制台 0 error / 0 pageerror | 桌面浏览器 |

### E. 性能（每次升级必测）

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| E1 | 长会话可打开 | 打开 >5000 节点的会话，页面**不假死**；一次脚本往返 < 500ms | 附录 §6.2 |
| E2 | 长会话可滚动 | 连续 12 次滚动总耗时 < 1500ms（桌面 CPU，手机放宽到 3000ms） | 附录 §6.2 |
| E3 | 观察器不放大 | 滚动期间 `MutationObserver` 回调数在**个位数**（防抖生效；若达到几十上百即回归） | 附录 §6.2 |
| E4 | 首屏可交互 | 从导航到「点把手能开抽屉」的时间，热刷新应 < 3s（手机 CPU 下 < 8s） | 见 README「验证」做法 |
| E5 | 单次测量成本 | 全文档查询 + 布局读取合计 < 10ms（6000 节点量级） | 附录 §6.3 |

> 判据来源：0.3.13 实测本机长会话（6912 节点）打开 72ms、滚动 12 次 733ms、滚动期间回调 4 次、单次测量 2.6ms（桌面 CPU）。真机更慢，故 E1/E2 留了放宽值。

### F. 可卸载 / 可回退

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| F1 | 开关可停用 | 停用后 `data-dshm`、`data-dshm-composer` 移除，把手/圆点消失，回到官方布局 | 真机操作 |
| F2 | 卸载无残留 | 移除 profile 里的行后重启，官方布局恢复（如 390 宽下 `56px 334px 0px`） | 删行 + 重启 |
| F3 | 不污染官方数据 | 除 `localStorage['dsh-mobile-ui.enabled']` 外不写任何存储 | 读 localStorage |

### G. 代码卫生

| # | 验收项 | 判据 | 怎么测 |
| --- | --- | --- | --- |
| G1 | 语法通过 | `node --check client.js` 无输出 | 命令 |
| G2 | 单测全绿 | `node --test` 全通过（当前 6 项） | 命令 |
| G3 | 官方仓库干净 | `deepseek-harness` 的 `git status` 无插件相关改动 | `git status` |
| G4 | 运行时已同步 | 源文件与 `node_modules` 副本 inode 相同 | `stat -c '%i %n'` |
| G5 | 控制台干净 | 手机与桌面场景均 0 error | 浏览器控制台 |

---

## 五、失败处置

| 现象 | 处置 |
| --- | --- |
| 缝改名，能对上语义 | 改 `SEAMS` 一条字符串即可，其余不动 |
| 缝消失且无替代 | 把该条从 `REQUIRED_SEAMS` 摘掉，并在 `refresh()` 里对该 `seam()` 为 `null` 短路，关掉对应子功能；在 README「已知取舍」记一条 |
| 多条缝同时消失（官方大改布局） | 停止逐条硬凑，按新版重采一遍缝，重写 `SEAMS`；必要时降到最小可用（三轨归零 + 抽屉），其余子功能标记停用 |
| 性能不达标（E 组不过） | 先查是不是新增了逐节点触发的测量路径：所有结构/尺寸/属性观察器必须统一走 `scheduleRefresh`（防抖），禁止直连 `refresh()`；确需更激进降级时提高 `REFRESH_DEBOUNCE_MS` 或复用 `ANIMATED_NODES_MAX` 的长会话降级分支 |
| 改完"没生效" | 九成是硬链接断开（§步骤 3），先比对 inode 再排查逻辑 |
| 桌面端被误伤 | 检查新加的选择器是否缺少 `html[data-dshm]` 作用域前缀，或 UA 判定是否被放宽 |

---

## 六、附录

### 6.1 采集新版 DOM 缝

在 DSH Web 控制台执行（手机视口下）：

```js
// A. 列出当前页面全部 data-* 属性名 —— 与上一版对比即可发现改名
const dataAttrs = new Set()
document.querySelectorAll('*').forEach(el => {
  for (const a of el.attributes) if (a.name.startsWith('data-')) dataAttrs.add(a.name)
})
console.log('[data-* 清单]\n' + [...dataAttrs].sort().join('\n'))

// B. 逐条检查 SEAMS 命中情况（把 SEAMS 从 client.js 顶部复制过来）
const SEAMS = { /* 粘贴当前 client.js 顶部的 SEAMS */ }
const missing = Object.entries(SEAMS).filter(([, sel]) => document.querySelector(sel) === null)
console.log(missing.length === 0
  ? 'SEAMS 全部命中 ✓'
  : '未命中：\n' + missing.map(([n, s]) => `  ${n}  ${s}`).join('\n'))
```

### 6.2 性能验收（长会话）

用 Playwright（Python）以手机 UA + 长会话跑：

```python
# 关键步骤：先挂钩观察器，再导航，然后打开最长的会话并滚动
INIT = """
window.__m = { obs: 0, rect: 0 };
const M = window.MutationObserver;
window.MutationObserver = class extends M {
  constructor(cb) { super(function (...a) { window.__m.obs++; return cb.apply(this, a); }); }
};
const R = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function (...a) { window.__m.rect++; return R.apply(this, a); };
"""
# 会话行是 DIV[role=treeitem]；点击后等 5s 再读 window.__m 与主线程往返耗时
```

判定：打开后 `page.evaluate("() => 1")` 往返 < 500ms；滚动 12 次总耗时达标；`obs` 增量为个位数。

### 6.3 单次测量成本

```js
const t0 = performance.now()
for (let i = 0; i < 5; i++) document.querySelectorAll(
  ["[role='menu'], [role='dialog'], [role='listbox']",
   "[role='tablist'] [role='tab']",
   '[data-composer-card][inert]',
   '[data-dshm-handle]',
   "[data-phase] header button[aria-haspopup='menu']"][i])
for (const s of ['[data-composer-card]','[data-composer-seat]','[data-composer-stats]','[data-chat-flow]']) {
  const el = document.querySelector(s); if (el) for (let i = 0; i < 20; i++) el.getBoundingClientRect()
}
console.log('pass ≈', Math.round((performance.now() - t0) * 100) / 100, 'ms', '| nodes:', document.getElementsByTagName('*').length)
```

### 6.4 常用命令

```bash
node --check client.js                      # 语法
node --test                                 # 单测（6 项）
ln -f client.js ~/.dsh/profiles/web/node_modules/dsh-mobile-ui/client.js   # 同步运行时
stat -c '%i %n' client.js ~/.dsh/profiles/web/node_modules/dsh-mobile-ui/client.js  # 验证同步
bash install.sh --profile web               # 标准安装（不加 --restart 以免中断会话）
git push github main && git push origin main # 双远端推送
```
