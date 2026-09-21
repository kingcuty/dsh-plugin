/**
 * Host Remote owner for the browser-access directory: what the Access settings
 * page lists and edits. Every write answers with the whole directory, so the
 * page never reconciles a partial update against its own copy.
 *
 * Reaching this namespace already required a valid session cookie, which is
 * this deployment's whole authority model; a device that can open Settings can
 * therefore also manage tokens.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ACCESS_LABEL_MAX_LENGTH } from './browser-access.ts'
import type {
  AccessDeviceView, AccessDirectoryView, AccessMintedTokenView, AccessTokenView,
  BrowserAccessHandle, StoredDevice, StoredToken,
} from './access-types.ts'
// Type-only: resolves the `connection` Context augmentation this controller reads.
import type {} from './rpc-host.ts'

/** Validate one operator-supplied label at the wire boundary. */
function requireLabel(value: string): string {
  const label = value.trim()
  if (label.length === 0 || label.length > ACCESS_LABEL_MAX_LENGTH) {
    throw new RangeError(`label must be 1 to ${String(ACCESS_LABEL_MAX_LENGTH)} characters`)
  }
  return label
}

/** Project one stored device onto its wire view. */
function deviceView(device: StoredDevice, tokens: readonly StoredToken[]): AccessDeviceView {
  const token = device.tokenId === undefined
    ? undefined
    : tokens.find(entry => entry.id === device.tokenId)
  return {
    id: device.id,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    expiresAt: device.expiresAt,
    revoked: device.revokedAt !== undefined,
    ...device.tokenId === undefined ? {} : { tokenId: device.tokenId },
    ...device.label === undefined ? {} : { label: device.label },
    ...token === undefined ? {} : { tokenLabel: token.label },
    ...device.userAgent === undefined ? {} : { userAgent: device.userAgent },
    ...device.address === undefined ? {} : { address: device.address },
  }
}

/** Project one stored token onto its wire view. */
function tokenView(token: StoredToken, devices: readonly StoredDevice[]): AccessTokenView {
  return {
    id: token.id,
    label: token.label,
    createdAt: token.createdAt,
    deviceCount: devices.filter(device =>
      device.tokenId === token.id && device.revokedAt === undefined).length,
    ...token.lastUsedAt === undefined ? {} : { lastUsedAt: token.lastUsedAt },
  }
}

/** Host service backing the generated `ctx.remote.browserAccess` namespace. */
export class BrowserAccessController extends TypertRemoteService {
  static inject = ['connection']

  /** @param ctx - Host context carrying the Connection service. */
  constructor(ctx: Context) {
    super(ctx, 'browserAccess')
  }

  /**
   * Read the whole access directory.
   * @returns named tokens with their device counts, and every recorded device.
   */
  @Remote
  directory(): AccessDirectoryView {
    return this.view()
  }

  /**
   * Mint one named login token.
   * @param label - operator-supplied name.
   * @returns the new token row and the secret shown exactly once.
   */
  @Remote
  async createToken(label: string): Promise<AccessMintedTokenView> {
    const token = this.access.createToken(requireLabel(label), Date.now())
    await this.access.settled()
    return { token: tokenView(token, this.access.devices()), secret: token.secret }
  }

  /**
   * Drop one token, revoking the devices it authorized.
   * @param id - token id to drop.
   * @returns the directory after the drop.
   */
  @Remote
  async revokeToken(id: string): Promise<AccessDirectoryView> {
    this.access.revokeToken(id, Date.now())
    await this.access.settled()
    return this.view()
  }

  /**
   * Set or clear one device's name.
   * @param id - device id to rename.
   * @param label - new name; undefined clears it.
   * @returns the directory after the rename.
   */
  @Remote
  async renameDevice(id: string, label: string | undefined): Promise<AccessDirectoryView> {
    this.access.renameDevice(id, label === undefined ? undefined : requireLabel(label))
    await this.access.settled()
    return this.view()
  }

  /**
   * Revoke one device, refusing its cookies from the next request onward.
   * @param id - device id to revoke.
   * @returns the directory after the revocation.
   */
  @Remote
  async revokeDevice(id: string): Promise<AccessDirectoryView> {
    this.access.revokeDevice(id, Date.now())
    await this.access.settled()
    return this.view()
  }

  /** Directory operations owned by Connection, where authentication reads them. */
  private get access(): BrowserAccessHandle {
    return this.ctx.connection.access
  }

  /** Assemble the complete wire view from the shared in-memory directory. */
  private view(): AccessDirectoryView {
    const tokens = this.access.tokens()
    const devices = this.access.devices()
    const damaged = this.access.damaged
    return {
      tokens: tokens.map(token => tokenView(token, devices)),
      devices: devices.map(device => deviceView(device, tokens)),
      ...damaged === undefined ? {} : { damaged },
    }
  }
}
