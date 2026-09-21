---
description: "Web GUI 的访问管理设置页：命名登录令牌与它们授权的浏览器设备；面向登记和清退浏览器的运维者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-access

[English](README.md) | 中文

## Summary

用这个包登记和清退可以登录这台 DeepSeek Harness 的浏览器。访问管理页为每台设备签发一个命名登录令牌，给出在该设备上打开的链接，列出 Host 记录的全部浏览器会话，并支持吊销一台设备、或吊销一个令牌连同它授权的设备。令牌密钥只在创建它的那次应答里出现一次，其余视图一律脱敏。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

打开设置，选择 **访问管理**。页面上有两个列表。

### 登录令牌

输入新设备的名称并点 **新增令牌**。页面给出一次性登录链接；把它复制到新设备上打开。该设备用密钥换取 30 天会话 cookie，并出现在下方的设备列表中。吊销一个令牌会删除它，并吊销它授权的全部设备。

### 登录设备

Host 记录的每个浏览器会话都会列出，包含其来源令牌、上报的浏览器与地址，以及首次登录、最近活跃和有效期时间。**重命名** 可以给设备起自己的名字；**退出登录** 会吊销它，它之后的下一个请求会被 401 拒绝。

## Understand the implementation

本页自身不做任何客户端存储：每个动作都调用 Host 的 `browserAccess` Remote 命名空间，它读写的是连接认证所强制执行的同一份内存目录。Host 把令牌与设备持久化在一个凭证记录（`client-connection/browser-access`）里，并先更新内存副本，因此同步的 cookie 校验从不等存储。

`dsh web` 打印的进程级应急令牌刻意放在这份目录之外。即使存储的目录读不出来，它依然有效——这正是运维者还能进入本页去修复它的原因；目录损坏时会在列表上方报出，吊销随之失效，而不是把所有浏览器锁在门外。

## Model Experience

本包不改变任何模型可见输入、工具 schema 或提示词文本，也不新增会话事件或请求 token，因此对 KV-cache 复用没有影响。

## Known Limitations and Deferred Work

- 在本页出现之前签发的会话 cookie 不带设备 id。它作为「未托管会话」继续有效，既不能被列出也不能被吊销；用令牌重新登录一次即可得到可管理的设备。
- 登录链接只在创建时显示一次。链接丢了就再签发一个令牌。
- 令牌密钥与 cookie 签名密钥都以明文存放在 Host 凭证库里，与该文件其余内容的信任级别相同。
