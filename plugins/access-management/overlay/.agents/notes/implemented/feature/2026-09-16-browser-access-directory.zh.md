# Agent Note：逐设备浏览器访问令牌与配套设置页

Status: implemented

[English](2026-09-16-browser-access-directory.md) | 中文

## Problem

浏览器认证此前只有一个凭据：启动时随机生成的**进程级**登录令牌，所有浏览器共用，加上由一个持久密钥签出的会话 cookie。运维者无法为某台新设备单独签发登录链接，看不到有哪些设备已登录，也无法把其中一台登出——唯一的吊销手段是重启进程，而那会把所有人一起登出。

## Decision

**Connection 在签名密钥之外持有一份持久访问目录。** [browser-access.ts](../../../../packages/client/connection/src/browser-access.ts) 把命名登录令牌与它们授权的设备放在一个凭证记录（`client-connection/browser-access`）里。写入先落到内存、再在串行队列上持久化，因此同步的 cookie 校验从不等存储。

**会话 cookie 指明它属于哪台设备。** [browser-auth.ts](../../../../packages/client/connection/src/browser-auth.ts) 既接受存储的令牌，也接受进程级应急令牌，并签发携带所记录设备 id 的 v2 cookie（同时记录地址与 User-Agent）。v1 cookie 继续作为「未托管会话」通过认证：它们早于本目录存在，因此既不出现在设备列表里也无法被吊销，升级不会把任何既有浏览器登出。

**未知设备放行，已吊销设备拒绝。** 目录里查不到的设备 id 一律认证通过——记录是异步写入的，而且存储损坏后重建的目录不该把所有浏览器登出。吊销写入 `revokedAt` 并保留该行，因此「拒绝」是一个明确的事实，而不是「查不到」。

**进程级应急令牌留在目录之外。** 它是恢复入口：认证先查它再查目录，所以记录读不出来时运维者仍能进入设置页修复。目录损坏会由 Remote 视图报出，而不是静默地读成「没有设备」，并且它让吊销暂时失效，而不是把每台浏览器锁在门外。

**设置界面是一个新功能包。** [ui-settings-access](../../../../packages/client/ui-settings-access) 在 General 与 Plugins 之旁注册一个 `settings.section`，调用生成的 `browserAccess` Remote 命名空间；[access-controller.ts](../../../../packages/client/connection/src/access-controller.ts) 是它的 Host 侧拥有者。令牌密钥只出现在创建它的那一次应答里，任何列表视图都不包含它。

**Connection 进入 Host 聚合。** `packages/client/connection/tsconfig.host.json` 此前只被 Client 聚合引用，Typert 从未分析该包；把它登记进 `tsconfig.host.json` 才是 `./typert` 与 `./remote` 产物得以存在的原因。

## Consequences

任何已认证设备都可以管理令牌：能触达该命名空间本身就要求一个会话 cookie，而这正是本部署的完整权限模型。升级前签发的会话在对应浏览器用令牌重新登录之前，既不能被列出也不能被吊销。此处没有任何模型可见的东西：提示词、工具 schema、会话事件、请求 token 都不变。
