# Agent Note: Per-device browser access tokens and a Settings page to manage them

Status: implemented

English | [中文](2026-09-16-browser-access-directory.zh.md)

## Problem

Browser authentication had exactly one credential: a process-scoped launch token minted at startup, shared by every browser, and a signed cookie derived from one durable secret. An operator could not issue a login link for one new device, could not see which devices were signed in, and could not sign one out — the only revocation was restarting the process, which signed everyone out.

## Decision

**Connection owns a durable access directory beside the signing secret.** [browser-access.ts](../../../../packages/client/connection/src/browser-access.ts) keeps named login tokens and the devices they authorized in one credential record (`client-connection/browser-access`). Writes publish to memory first and persist on a serialized queue, so the synchronous cookie check never waits on storage.

**A session cookie names its device.** [browser-auth.ts](../../../../packages/client/connection/src/browser-auth.ts) accepts any stored token as well as the process launch token, and mints a version-2 cookie carrying the device id it recorded (address and User-Agent included). Version-1 cookies keep authenticating as unmanaged sessions: they predate the directory, so they neither appear in the device list nor can be revoked, and no existing browser is signed out by the upgrade.

**An unknown device is accepted; a revoked one is refused.** A device id absent from the directory authenticates, because the record is written asynchronously and a directory rebuilt after storage damage must not sign every browser out. Revocation sets `revokedAt` and keeps the row, so refusal is a positive fact rather than a missing one.

**The process launch token stays outside the directory.** It is the recovery entry: authentication consults it before the directory, so an unreadable record still lets an operator reach Settings and repair it. A damaged record is reported by the Remote view instead of silently reading as "no devices", and it suspends revocation rather than locking every browser out.

**The settings surface is one new feature package.** [ui-settings-access](../../../../packages/client/ui-settings-access) registers a `settings.section` beside General and Plugins and calls the generated `browserAccess` Remote namespace; [access-controller.ts](../../../../packages/client/connection/src/access-controller.ts) is its Host owner. A minted token's secret appears in exactly one answer and in no list view.

**Connection joins the Host aggregate.** `packages/client/connection/tsconfig.host.json` was reachable only from the Client aggregate, so Typert never analyzed the package; registering it in `tsconfig.host.json` is what makes `./typert` and `./remote` artifacts exist at all.

## Consequences

Any authenticated device may manage tokens: reaching the namespace already required a session cookie, which is this deployment's whole authority model. A session minted before the upgrade cannot be listed or revoked until its browser signs in again through a token. Nothing here is model-visible: no prompt text, tool schema, session event, or request token changes.
