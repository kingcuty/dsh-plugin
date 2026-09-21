---
description: "Access settings section for the Web GUI: named login tokens and the browser devices they authorized; for operators enrolling and retiring browsers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-access

English | [中文](README.zh.md)

## Summary

Use this package to enroll and retire the browsers that may sign in to this DeepSeek Harness. The Access page mints one named login token per device, shows the link to open on that device, lists every browser session the Host recorded, and revokes either one device or a whole token together with the devices it authorized. A token's secret appears exactly once, in the answer to the mint that created it; every other view is redacted.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Open Settings and choose **Access**. The page holds two lists.

### Login tokens

Type a name for the new device and choose **New token**. The page answers with the one-time login link; copy it to the new device and open it there. That device exchanges the secret for a thirty-day session cookie and appears in the device list below. Revoking a token drops it and revokes every device it authorized.

### Devices

Every browser session the Host recorded is listed with its authorizing token, its reported browser and address, and its first-seen, last-active, and expiry times. **Rename** gives a device a name of your own; **Sign out** revokes it, and its next request is refused with 401.

## Understand the implementation

The section keeps no client-side storage of its own: every action calls the Host `browserAccess` Remote namespace, which reads and writes the same in-memory directory that connection authentication enforces. The Host persists tokens and devices in one credential record (`client-connection/browser-access`) and updates its in-memory copy first, so a synchronous cookie check never waits on storage.

The process launch token printed by `dsh web` sits deliberately outside this directory. It keeps working even when the stored directory is unreadable, which is what lets an operator reach this page and repair it; a damaged directory is reported above the lists, and revoke stops taking effect rather than every browser being locked out.

## Model Experience

This package changes no model-visible input, no tool schema, and no prompt text. It adds no session event and no token to any request, so it has no effect on KV-cache reuse.

## Known Limitations and Deferred Work

- A session cookie minted before this page existed carries no device id. It keeps working as an unmanaged session and cannot be listed or revoked; signing in again through a token produces a manageable device.
- The login link is shown once, at mint time. Recovering a lost link means minting another token.
- Token secrets and the cookie signing secret are both stored in plaintext in the Host credential store, at the same trust level as the rest of that file.
