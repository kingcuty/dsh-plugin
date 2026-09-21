/**
 * Durable browser-access directory: named login tokens, and the browser
 * devices each token authorized. The cookie signing secret keeps its own
 * record (`client-connection/browser-session`); this one is the directory the
 * access settings surface reads and writes.
 *
 * Writes update the in-memory directory first and persist on a serialized
 * queue, so the synchronous authentication path never waits on storage.
 */

import { randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { BrowserAccessHandle, StoredDevice, StoredToken } from './access-types.ts'

const ACCESS_RECORD_KEY = credentialKey('client-connection', 'browser-access')
const STORED_VERSION = 1
const SECRET_BYTES = 32
const ID_BYTES = 9

/** Longest accepted token or device label. */
export const ACCESS_LABEL_MAX_LENGTH = 64

interface StoredAccess {
  readonly version: typeof STORED_VERSION
  readonly tokens: readonly StoredToken[]
  readonly devices: readonly StoredDevice[]
}

const EMPTY_ACCESS: StoredAccess = { version: STORED_VERSION, tokens: [], devices: [] }

/** Fresh url-safe identifier for one token or device. */
function mintId(): string {
  return randomBytes(ID_BYTES).toString('base64url')
}

/** Fresh url-safe login secret. */
export function mintSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function parseToken(value: unknown): StoredToken {
  if (!isRecord(value)) throw new TypeError('access token entry is not an object')
  const id = optionalString(value.id)
  const label = optionalString(value.label)
  const secret = optionalString(value.secret)
  const createdAt = optionalTimestamp(value.createdAt)
  if (id === undefined || label === undefined || secret === undefined || createdAt === undefined) {
    throw new TypeError('access token entry is missing id, label, secret, or createdAt')
  }
  const lastUsedAt = optionalTimestamp(value.lastUsedAt)
  return { id, label, secret, createdAt, ...lastUsedAt === undefined ? {} : { lastUsedAt } }
}

function parseDevice(value: unknown): StoredDevice {
  if (!isRecord(value)) throw new TypeError('access device entry is not an object')
  const id = optionalString(value.id)
  const createdAt = optionalTimestamp(value.createdAt)
  const lastSeenAt = optionalTimestamp(value.lastSeenAt)
  const expiresAt = optionalTimestamp(value.expiresAt)
  if (id === undefined || createdAt === undefined || lastSeenAt === undefined || expiresAt === undefined) {
    throw new TypeError('access device entry is missing id, createdAt, lastSeenAt, or expiresAt')
  }
  const tokenId = optionalString(value.tokenId)
  const label = optionalString(value.label)
  const userAgent = optionalString(value.userAgent)
  const address = optionalString(value.address)
  const revokedAt = optionalTimestamp(value.revokedAt)
  return {
    id, createdAt, lastSeenAt, expiresAt,
    ...tokenId === undefined ? {} : { tokenId },
    ...label === undefined ? {} : { label },
    ...userAgent === undefined ? {} : { userAgent },
    ...address === undefined ? {} : { address },
    ...revokedAt === undefined ? {} : { revokedAt },
  }
}

/** Decode one stored record, rejecting anything this build cannot address. */
function parseStored(record: CredentialRecord): StoredAccess {
  if (record.kind !== 'grant' || !isRecord(record.payload)) {
    throw new TypeError('access directory record has an unsupported format')
  }
  if (record.payload.version !== STORED_VERSION) {
    throw new TypeError('access directory record has an unsupported version')
  }
  const rawTokens = record.payload.tokens
  const rawDevices = record.payload.devices
  if (!Array.isArray(rawTokens) || !Array.isArray(rawDevices)) {
    throw new TypeError('access directory record is missing token or device arrays')
  }
  return {
    version: STORED_VERSION,
    tokens: rawTokens.map(parseToken),
    devices: rawDevices.map(parseDevice),
  }
}

/** One device registration request gathered from the authenticating request. */
export interface DeviceRegistration {
  readonly tokenId?: string
  readonly userAgent?: string
  readonly address?: string
  readonly createdAt: number
  readonly expiresAt: number
}

/**
 * In-memory access directory backed by one credential record.
 *
 * An unreadable record never fails activation: the directory starts empty,
 * reports {@link damage}, and the process launch token keeps working so an
 * operator can still reach Settings and rebuild it.
 */
export class BrowserAccessDirectory implements BrowserAccessHandle {
  private state: StoredAccess
  private writeFailure: string | undefined
  private writes: Promise<void> = Promise.resolve()

  private constructor(
    private readonly credentials: CredentialProvider,
    state: StoredAccess,
    private readonly readFailure: string | undefined,
  ) {
    this.state = state
  }

  /**
   * Read the stored directory, degrading to an empty one when it is unreadable.
   * @param credentials - persistent credential provider for this Harness home.
   * @returns the loaded directory.
   */
  static async load(credentials: CredentialProvider): Promise<BrowserAccessDirectory> {
    try {
      const record = await credentials.readRecord(ACCESS_RECORD_KEY)
      if (record === undefined) return new BrowserAccessDirectory(credentials, EMPTY_ACCESS, undefined)
      return new BrowserAccessDirectory(credentials, parseStored(record), undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new BrowserAccessDirectory(credentials, EMPTY_ACCESS, message)
    }
  }

  /**
   * Why the stored directory is not usable, if it is not.
   * @returns the read or write failure message, absent while storage is sound.
   */
  get damaged(): string | undefined {
    return this.readFailure ?? this.writeFailure
  }

  /**
   * Whether a damaged directory still authorizes existing device cookies.
   * A damaged directory accepts them rather than locking every browser out;
   * revoke stops taking effect until storage is repaired.
   * @returns true when device lookup cannot be trusted.
   */
  get unenforceable(): boolean {
    return this.damaged !== undefined
  }

  /** @returns every stored token, in creation order. */
  tokens(): readonly StoredToken[] {
    return this.state.tokens
  }

  /** @returns every stored device, in creation order. */
  devices(): readonly StoredDevice[] {
    return this.state.devices
  }

  /**
   * Find the token owning one presented secret.
   * @param secret - secret presented as `?token=`.
   * @returns the matching token, absent when no token owns it.
   */
  tokenBySecret(secret: string): StoredToken | undefined {
    return this.state.tokens.find(token => token.secret === secret)
  }

  /**
   * Find one device by id.
   * @param id - device id carried by a session cookie.
   * @returns the stored device, absent when it was never or no longer recorded.
   */
  device(id: string): StoredDevice | undefined {
    return this.state.devices.find(device => device.id === id)
  }

  /**
   * Whether one device id may still authenticate.
   * @param id - device id carried by a session cookie.
   * @returns true when the device is live, or when the directory is damaged.
   */
  deviceActive(id: string): boolean {
    if (this.unenforceable) return true
    // A cookie naming a device the directory does not hold is refused, which is
    // what makes dropping a record a permanent revocation. Recording a device
    // writes memory first, so only a crash between the write and the flush can
    // strand a session, and the process launch token still recovers it.
    const device = this.device(id)
    return device !== undefined && device.revokedAt === undefined
  }

  /**
   * Add a named login token.
   * @param label - operator-supplied name.
   * @param now - creation time in epoch milliseconds.
   * @returns the created token, secret included.
   */
  createToken(label: string, now: number): StoredToken {
    const token: StoredToken = { id: mintId(), label, secret: mintSecret(), createdAt: now }
    this.commit({ ...this.state, tokens: [...this.state.tokens, token] })
    return token
  }

  /**
   * Drop a token. Devices it authorized are revoked with it, because a device
   * whose token is gone can no longer be explained in the settings list.
   * @param id - token id to drop.
   * @param now - revocation time in epoch milliseconds.
   * @returns true when a token was dropped.
   */
  revokeToken(id: string, now: number): boolean {
    const token = this.state.tokens.find(entry => entry.id === id)
    if (token === undefined) return false
    this.commit({
      ...this.state,
      tokens: this.state.tokens.filter(entry => entry.id !== id),
      devices: this.state.devices.map(device =>
        device.tokenId === id && device.revokedAt === undefined ? { ...device, revokedAt: now } : device),
    })
    return true
  }

  /**
   * Record a successful token exchange.
   * @param id - token id that was presented.
   * @param now - exchange time in epoch milliseconds.
   */
  noteTokenUse(id: string, now: number): void {
    this.commit({
      ...this.state,
      tokens: this.state.tokens.map(token =>
        token.id === id ? { ...token, lastUsedAt: now } : token),
    })
  }

  /**
   * Add the device one successful cookie exchange created.
   * @param registration - facts gathered from the authenticating request.
   * @returns the created device.
   */
  registerDevice(registration: DeviceRegistration): StoredDevice {
    const device: StoredDevice = {
      id: mintId(),
      createdAt: registration.createdAt,
      lastSeenAt: registration.createdAt,
      expiresAt: registration.expiresAt,
      ...registration.tokenId === undefined ? {} : { tokenId: registration.tokenId },
      ...registration.userAgent === undefined ? {} : { userAgent: registration.userAgent },
      ...registration.address === undefined ? {} : { address: registration.address },
    }
    this.commit({ ...this.state, devices: [...this.state.devices, device] })
    return device
  }

  /**
   * Record authenticated activity, keeping the stored timestamp coarse enough
   * that ordinary request traffic does not rewrite the record.
   * @param id - device id carried by the session cookie.
   * @param now - request time in epoch milliseconds.
   * @param threshold - smallest advance worth persisting, in milliseconds.
   */
  touchDevice(id: string, now: number, threshold: number): void {
    const device = this.device(id)
    if (device === undefined || device.revokedAt !== undefined) return
    if (now - device.lastSeenAt < threshold) return
    this.commit({
      ...this.state,
      devices: this.state.devices.map(entry =>
        entry.id === id ? { ...entry, lastSeenAt: now } : entry),
    })
  }

  /**
   * Set or clear one device's operator-supplied name.
   * @param id - device id to rename.
   * @param label - new name; undefined clears it.
   * @returns true when a device was renamed.
   */
  renameDevice(id: string, label: string | undefined): boolean {
    if (this.device(id) === undefined) return false
    this.commit({
      ...this.state,
      devices: this.state.devices.map((device) => {
        if (device.id !== id) return device
        const { label: _dropped, ...rest } = device
        return label === undefined ? rest : { ...rest, label }
      }),
    })
    return true
  }

  /**
   * Revoke one device, refusing its cookies from the next request onward.
   * @param id - device id to revoke.
   * @param now - revocation time in epoch milliseconds.
   * @returns true when a device was revoked.
   */
  revokeDevice(id: string, now: number): boolean {
    const device = this.device(id)
    if (device === undefined || device.revokedAt !== undefined) return false
    this.commit({
      ...this.state,
      devices: this.state.devices.map(entry =>
        entry.id === id ? { ...entry, revokedAt: now } : entry),
    })
    return true
  }

  /**
   * Drop devices whose cookie lifetime already ended, so the list does not
   * accumulate rows nothing can present.
   * @param now - current time in epoch milliseconds.
   * @returns number of devices dropped.
   */
  pruneExpired(now: number): number {
    const kept = this.state.devices.filter(device => device.expiresAt > now)
    const dropped = this.state.devices.length - kept.length
    if (dropped > 0) this.commit({ ...this.state, devices: kept })
    return dropped
  }

  /**
   * Wait for every queued write to settle, so a caller that answered a Remote
   * call can be sure the record it describes is on disk.
   * @returns after the write queue drains.
   */
  async settled(): Promise<void> {
    await this.writes
  }

  /** Publish one new state in memory and enqueue its persistence. */
  private commit(next: StoredAccess): void {
    this.state = next
    this.writes = this.writes.then(async () => {
      await this.credentials.modifyRecord(ACCESS_RECORD_KEY, () =>
        Promise.resolve({ kind: 'grant', payload: next }))
      this.writeFailure = undefined
    }).catch((error: unknown) => {
      // Authentication already accepted the change in memory; a failed write
      // is reported as damage rather than rejected, and the next write retries
      // from the newest state.
      this.writeFailure = error instanceof Error ? error.message : String(error)
    })
  }
}
