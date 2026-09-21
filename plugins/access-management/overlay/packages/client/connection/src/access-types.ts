/**
 * Browser-access vocabulary in one client-safe, types-only module: the
 * settings views that cross the Remote wire, the durable record shapes behind
 * them, and the handle Connection publishes to the access controller. The store
 * that interprets these shapes owns the runtime.
 */

/** One named login token as the access settings list renders it. */
export interface AccessTokenView {
  /** Stable id addressed by revoke. */
  readonly id: string
  /** Operator-supplied name. */
  readonly label: string
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Last successful token exchange, absent until the token is first used. */
  readonly lastUsedAt?: number
  /** Devices this token currently authorizes (revoked devices excluded). */
  readonly deviceCount: number
}

/** One browser session holding a signed session cookie. */
export interface AccessDeviceView {
  /** Stable id addressed by rename and revoke. */
  readonly id: string
  /** Token that authorized this device; absent for the process launch token. */
  readonly tokenId?: string
  /** Operator-supplied name. */
  readonly label?: string
  /** Authorizing token's label, so a row renders without a second lookup. */
  readonly tokenLabel?: string
  /** Raw `User-Agent` reported when the device first authenticated. */
  readonly userAgent?: string
  /** Client address reported when the device first authenticated. */
  readonly address?: string
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Last authenticated request, epoch milliseconds. */
  readonly lastSeenAt: number
  /** Absolute cookie expiry, epoch milliseconds. */
  readonly expiresAt: number
  /** Whether this device's cookies are refused. */
  readonly revoked: boolean
}

/** The complete access directory. */
export interface AccessDirectoryView {
  /** Named login tokens in creation order. */
  readonly tokens: readonly AccessTokenView[]
  /** Session devices in creation order, revoked ones included. */
  readonly devices: readonly AccessDeviceView[]
  /**
   * Set when the stored directory could not be read and was ignored. The
   * settings surface reports it instead of silently showing an empty list.
   */
  readonly damaged?: string
}

/** One minted token: its directory row plus the secret shown exactly once. */
export interface AccessMintedTokenView {
  /** The new directory row. */
  readonly token: AccessTokenView
  /** Login secret; the settings page builds `/?token=<secret>` from it. */
  readonly secret: string
}

/** One stored login token. */
export interface StoredToken {
  /** Stable id addressed by revoke. */
  readonly id: string
  /** Operator-supplied name. */
  readonly label: string
  /** Secret accepted as `?token=`; never leaves the Host. */
  readonly secret: string
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Last successful token exchange, absent until first used. */
  readonly lastUsedAt?: number
}

/** One stored browser device. */
export interface StoredDevice {
  /** Stable id carried by the session cookie and addressed by the settings list. */
  readonly id: string
  /** Token that authorized this device; absent for the process launch token. */
  readonly tokenId?: string
  /** Operator-supplied name. */
  readonly label?: string
  /** Raw `User-Agent` reported at creation. */
  readonly userAgent?: string
  /** Client address reported at creation. */
  readonly address?: string
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Last authenticated request, epoch milliseconds. */
  readonly lastSeenAt: number
  /** Absolute cookie expiry, epoch milliseconds. */
  readonly expiresAt: number
  /** Revocation time, absent while the device may authenticate. */
  readonly revokedAt?: number
}

/**
 * The directory operations Connection publishes to the access controller.
 * Connection keeps the instance's identity because authentication reads the
 * same in-memory state synchronously; the controller only needs this surface.
 */
export interface BrowserAccessHandle {
  /** @returns every stored token, in creation order. */
  tokens(): readonly StoredToken[]
  /** @returns every stored device, in creation order. */
  devices(): readonly StoredDevice[]
  /**
   * Add a named login token.
   * @param label - operator-supplied name.
   * @param now - creation time in epoch milliseconds.
   * @returns the created token, secret included.
   */
  createToken(label: string, now: number): StoredToken
  /**
   * Drop a token and revoke the devices it authorized.
   * @param id - token id to drop.
   * @param now - revocation time in epoch milliseconds.
   * @returns true when a token was dropped.
   */
  revokeToken(id: string, now: number): boolean
  /**
   * Set or clear one device's operator-supplied name.
   * @param id - device id to rename.
   * @param label - new name; undefined clears it.
   * @returns true when a device was renamed.
   */
  renameDevice(id: string, label: string | undefined): boolean
  /**
   * Revoke one device.
   * @param id - device id to revoke.
   * @param now - revocation time in epoch milliseconds.
   * @returns true when a device was revoked.
   */
  revokeDevice(id: string, now: number): boolean
  /** Unusable-storage report, absent while the directory is sound. */
  readonly damaged: string | undefined
  /** @returns after every queued write drains. */
  settled(): Promise<void>
}
