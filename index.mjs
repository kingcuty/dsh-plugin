/**
 * DSH mobile UI plugin — host half.
 *
 * The host side owns no behaviour: every effect lives in the browser half
 * (`./client`), which the client module system finds through this package's
 * `dsh.client` manifest. The row exists so the loader composes it into the
 * web profile's tree, which is what puts the browser half on the wire.
 * @module dsh-mobile-ui
 */

/** Cordis plugin name, matching the profile row id. */
export const name = 'mobile-ui'

/** The row needs no host services; it activates as soon as it is loaded. */
export const inject = []

/** No host-side work. */
export function apply() {}
