# DSH「访问管理」功能包（0.1.5-rc.2）

把本机 DSH 的 **设置 → 访问（Access）** 功能搬给另一台 DSH 源码检出用的自包含补丁包。

| 项 | 值 |
| --- | --- |
| 来源仓库 | `/home/dev/projects/deepseek-harness`（分支 `feat/browser-access-directory`） |
| 目标基线 | `0.1.5-rc.2`，commit `c291e7961a515f6d7af9304e7fd1d257929aef26` |
| 功能提交 | `3a054552`（访问目录 + 访问页）、`c88b4a2e`（拒旧 cookie）、`fc42f08a`（设置持久化） |
| 生成时间 | 2026-09-21 |
| 变更规模 | 39 个文件（20 新增 / 19 修改），+2228 / −116 行；其中新客户端插件包 1 个 |

## 1. 这个功能是什么

浏览器认证原先只有一个进程级启动令牌（`dsh web` 启动时打印的 `?token=...` 链接），所有浏览器共用，既不能给单台设备发凭据，也看不到谁登录了，更没法单独踢人*。

本功能给 `connection` 加了一个持久化的**访问目录**，并在设置页里加了一个 **访问** 分区：

- **登录令牌**：起个名字 → 新建令牌 → 页面给出一次性登录链接（`https://<host>/?token=<secret>`）→ 在目标设备打开即换到 30 天会话 cookie，该设备随即出现在设备列表。
- **设备列表**：记录签发它的令牌、浏览器与地址、首次出现 / 最近活跃 / 到期时间；可以**重命名**，可以**登出**（下一请求即 401）。
- **吊销**：吊销令牌会连带吊销它签出的所有设备。
- **恢复入口**：进程启动令牌不放进访问目录，认证时会先查它——目录读不出来时仍能进设置页修复；目录损坏时页面会提示，并暂停吊销生效，而不是把所有人锁在门外。

落盘：令牌与设备存在 DSH credential store 的 `client-connection/browser-access` 记录里（**明文**，与其它凭据同一信任级别）。令牌 secret 只在签发那一次的返回值里出现，列表视图一律脱敏。

## 2. 包内容

```
dsh-access-management-0.1.5-rc.2/
├── README.md                 本文档
├── VERIFY-EVIDENCE.md        打包方自检记录（干净克隆上补丁 / 安装 / 卸载 / 整仓构建的实测结果）
├── SHA256SUMS                三个补丁的校验和
├── MANIFEST.md               变更清单（状态 / 行数 / SHA-256）
├── install.sh                一键安装（校验基线 → git am 补丁 → pnpm install → pnpm run build）
├── verify.sh                 安装后自检（文件 / 名册 / tsconfig / 构建产物 / 可选跑测试）
├── uninstall.sh              回滚（revert 三个提交 → 重新构建）
├── patches/                  git format-patch 补丁系列（保留提交作者与提交信息）
│   ├── 0001-add-per-device-browser-access-directory.patch
│   ├── 0002-refuse-pre-directory-session-cookies.patch
│   └── 0003-persist-settings-document-off-loopback.patch
└── overlay/                  全部 38 个受影响文件的完整副本（补丁打不上时的兜底，按仓库相对路径摆放）
```

三个补丁各自的作用：

1. **0001**（核心，38 个文件）：新增 `packages/client/connection/src/browser-access.ts`（访问目录）、`access-types.ts`、`access-controller.ts`（Host 侧 `browserAccess` Remote 命名空间）；改 `browser-auth.ts`（接受存储令牌、签发带设备 id 的 v2 cookie）；改 `api/remotes` 客户端装配；**新增客户端插件包 `packages/client/ui-settings-access`**（设置页的「访问」分区）；在 `packages/bundle/web-app/cordis.patch.yml` 名册里注册 `ui-settings-access` 行，并加进 `packages/bundle/web-app/package.json` 依赖；更新 `tsconfig.host.json` / `tsconfig.client.json` 聚合与 connection 的 host/client 编译面；同步 `pnpm-lock.yaml`。
2. **0002**：拒绝升级前签发的 v1 会话 cookie。v1 cookie 不带设备 id，访问目录既列不出也吊销不了——正是本功能要消灭的「管不到的会话」；拒绝它以后，每个活跃会话都归属某个设备。
3. **0003**：把设置文档的持久化策略固定为 `host`。上游默认「非 loopback 浏览器降级到内存后端」，局域网/域名访问时设置不落盘；本补丁让远端浏览器也走 Host 持久化。**loopback 部署行为完全不变**（loopback 本来就是 `host`），所以默认装、也可以不装。

## 3. 前置条件

- 目标机是 deepseek-harness 的 **git 源码检出**，并且能自行构建（`pnpm install` + `pnpm run build` 跑得通）。
- 基线 `0.1.5-rc.2`（`c291e79` 在目标仓库历史里）；基线不同也能试 `git am --3way`，但 overlay 兜底只在同版本下可靠。
- Node `^22.19.0 || >=24`，pnpm（仓库 `packageManager` 声明 `pnpm@11.7.0`）。
- 目标仓库工作区干净（脚本会拒绝未提交改动，`--force` 可绕过）。
- 构建需要能联网执行 `pnpm install`。

## 4. 安装

```sh
tar xzf dsh-access-management-0.1.5-rc.2.tar.gz
cd dsh-access-management-0.1.5-rc.2
./install.sh --repo /path/to/deepseek-harness
```

脚本按顺序做四件事：**校验基线 → `git am --3way` 三个补丁 → `pnpm install` → `pnpm run build`**，并把安装记录写到 `<repo>/.git/dsh-access-management-install`（含安装前 SHA，供回滚用）。

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--repo <dir>` | 指定目标仓库（默认当前目录） |
| `--apply` | 只改工作区并暂存，不生成提交（默认 `git am` 生成三个真实提交） |
| `--no-build` | 跳过 `pnpm run build` |
| `--no-install` | 跳过 `pnpm install` |
| `--force` | 允许脏工作区 / 已安装过再装一次 |

装完**重启 DSH 进程**才生效，例如：

```sh
systemctl --user restart dsh-web      # 如果目标机用的是本机同款用户级服务
# 或按目标机自己的方式重启 dsh web
```

## 5. 安装后验证

```sh
./verify.sh --repo /path/to/deepseek-harness            # 静态自检：文件 / 名册 / tsconfig / 构建产物
./verify.sh --repo /path/to/deepseek-harness --tests    # 额外跑本功能相关的三个测试文件
```

页面上的手工验证（重启后用启动日志里的 `?token=...` 链接打开）：

1. 设置 → **访问**，页面出现「登录令牌」「设备」两个列表。
2. 「新建令牌」输入设备名 → 拿到一次性登录链接 → 在另一台设备打开 → 该设备出现在设备列表里。
3. 点该设备的「登出」→ 该设备下一次请求返回 401（刷新即被踢回登录）。
4. 「吊销」令牌 → 它签发的设备一并失效。

> **升级后的一次性影响**：升级前已经建立的浏览器会话（v1 cookie）会被拒绝，现有浏览器需要**用启动令牌重新登录一次**；这是 0002 补丁的预期行为，不是故障。

## 6. 回滚

```sh
./uninstall.sh --repo /path/to/deepseek-harness
```

默认按安装记录里的提交顺序 `git revert` 三个提交，再 `pnpm install && pnpm run build`，然后重启进程。若安装时用了 `--apply`（没有提交），回滚脚本会打印手工处理方式（`git checkout` 恢复改动文件 + 删除新增文件），不会替你做破坏性 reset。

## 7. 部署侧要留意

- **非 loopback 访问必须加 `--trusted-host`**：`dsh web --trusted-host <域名或 IP>`，否则登录链接与 API 请求会被信任校验挡掉（本机是 `--trusted-host dsh-jwp.rhtctech.cn`）。
- 0003 补丁改变的是「远端浏览器的设置文档是否落盘」，不影响认证与访问目录本身；只在本机 loopback 使用的话装不装都一样。
- 令牌 secret 与 cookie 签名密钥明文存在 credential store 里，权限按该文件原有策略管理。
- 本包**不含**：两个纯视觉的侧边栏提交（`732ce1a` 品牌标、`4a7484b` 版本角标）、nginx/证书配置——它们与访问管理无关，按目标机需要单独处理。
- **跟随上游升级**时，在本机（源仓库）rebase 或 cherry-pick 这三个提交即可；目标机升级上游 rc 后重跑一次 `./install.sh`（先 `git revert` 或让上游合入）。
