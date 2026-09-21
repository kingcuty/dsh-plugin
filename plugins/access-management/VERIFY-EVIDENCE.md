# 验证证据（打包方自检记录）

验证环境：Ubuntu 24.04.5 LTS · Node v24.21.0 · pnpm 11.7.0
源仓库：`/home/dev/projects/deepseek-harness`（HEAD `4a7484b`）· 验证时间：2026-09-21

## 1. 补丁在干净基线上应用

```sh
git clone --shared <源仓库> dist/verify-clone
git checkout --detach c291e79            # 0.1.5-rc.2 基线
./install.sh --repo dist/verify-clone --no-install --no-build
```

结果：三个补丁全部 `git am --3way` 干净应用（`Applying: ...` 无冲突）；安装后 `git diff HEAD 4a7484b`
只剩两个侧边栏提交的文件（`packages/client/ui-settings/src/client/SidebarRoot*` —— 本包故意不含它们）；
`overlay/` 38 个文件与源仓库对应文件**逐字节一致**（`cmp` 全通过）。

## 2. 卸载与回滚

| 场景 | 结果 |
| --- | --- |
| am 模式 `uninstall.sh` | 逆序 revert 三个提交成功；`git diff c291e79 HEAD` 为空、工作区干净、安装记录删除 |
| `--apply` 模式 `uninstall.sh`（无 `--hard`） | 按设计拒绝（exit 1），给出手工步骤 |
| `--apply` 模式 `uninstall.sh --hard` | reset 回基线、新包目录删除、工作区干净 |
| 已安装状态再跑 `install.sh` | 提示"已安装"并退出 0（幂等） |

## 3. 完整构建（干净克隆）

```sh
pnpm install          # 292 个 workspace 项目，成功
pnpm run build        # build:native-system + build:lib + build:web，exit 0
```

- 新产物齐全：`connection` 的 `lib/typert.host.js`、`lib/typert.remote-client.js`（补丁新增的 Host 编译面），
  `ui-settings-access` 的 `lib/client.js`（新客户端插件），`api/remotes` 的 `lib/client.js`。
- `.dsh-build/client-build-environment.json`：`fileCount = 236`（含新插件）。
- `./verify.sh --repo dist/verify-clone`：**通过 20，失败 0，警告 0**。

## 4. 功能测试（当前 checkout）

```sh
pnpm exec vitest run packages/client/connection/tests/browser-access.host.spec.ts \
  packages/client/connection/tests/browser-auth.host.spec.ts
```

结果：13 + 5 = **18 项全绿**。

## 5. 与本次改动无关的既有环境问题

本机当前沙箱环境下，**jsdom 环境**的客户端用例起不来，报
`Error: No such built-in module: node:`（setup 文件 `scripts/test-proxy-environment.ts` 引入的 node 内置模块被按浏览器环境外部化）。
同样的失败出现在**完全未改动**的 `packages/client/ui-settings-general` 的 jsdom 用例上（4 failed / 2 passed），
因此不是访问管理功能引入的问题；host（node 环境）用例不受影响。目标机在自己的 shell 里跑普通构建与测试不受此限。
