/**
 * Access settings plugin, browser half: one Settings section listing named
 * login tokens and the browser devices they authorized, with the mint, rename,
 * and revoke actions the operator needs to enroll and retire devices.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the mounted browserAccess Remote namespace and its answers.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the settings slot types (this package registers a section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  AccessDirectoryView, AccessMintedTokenView, RemoteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { AccessSettingsSection } from './AccessSettingsSection.tsx'
import type { AccessSectionInjected } from './AccessSettingsSection.tsx'
import { en, zh, type AccessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Access section's copy. */
    'settings.access': AccessLocaleKey
  }
}

/** This section's locale namespace. */
const NS = 'settings.access'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.browserAccess']

/**
 * Turn one Remote answer into its value, restoring throw semantics for the
 * failure branch so the section reports a single error path.
 * @param answer - pending Remote call.
 * @returns the answered value.
 */
async function unwrap<T>(answer: Promise<RemoteResult<T>>): Promise<T> {
  const result = await answer
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Client plugin body: register the Access section under Settings.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-access: section dictionaries')
  const t = ctx.locale.bind(NS)

  const access = (): typeof ctx.remote.browserAccess => ctx.remote.browserAccess
  const injected = (): AccessSectionInjected => ({
    load: async (): Promise<AccessDirectoryView> => unwrap(access().directory()),
    createToken: async (label: string): Promise<AccessMintedTokenView> =>
      unwrap(access().createToken(label)),
    revokeToken: async (id: string): Promise<AccessDirectoryView> =>
      unwrap(access().revokeToken(id)),
    renameDevice: async (id: string, label: string | undefined): Promise<AccessDirectoryView> =>
      unwrap(access().renameDevice(id, label)),
    revokeDevice: async (id: string): Promise<AccessDirectoryView> =>
      unwrap(access().revokeDevice(id)),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'access',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AccessSettingsSection))
}
