/**
 * Access settings section: named login tokens and the browser devices they
 * authorized. Every read and write goes to the Host directory through the
 * injected face, and the section keeps only the answer it last received.
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  AccessDeviceView, AccessDirectoryView, AccessMintedTokenView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AccessSettingsSection.module.css'

/** Host calls the section performs against the browser-access directory. */
export interface AccessSectionInjected {
  /** Read the whole directory. */
  load: () => Promise<AccessDirectoryView>
  /** Mint one named token; its secret is answered exactly once. */
  createToken: (label: string) => Promise<AccessMintedTokenView>
  /** Drop one token and revoke the devices it authorized. */
  revokeToken: (id: string) => Promise<AccessDirectoryView>
  /** Set or clear one device's name. */
  renameDevice: (id: string, label: string | undefined) => Promise<AccessDirectoryView>
  /** Revoke one device. */
  revokeDevice: (id: string) => Promise<AccessDirectoryView>
}

/** Props the renderer binds for the Access settings section. */
export type AccessSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.access'>
  & InjectFace<AccessSectionInjected>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Absolute login URL carrying one minted secret. */
function loginUrlFor(secret: string): string {
  const origin = globalThis.location?.origin
  const base = origin === undefined || origin === 'null' ? '' : origin
  return `${base}/?token=${secret}`
}

/** Browser and platform names reported by one User-Agent, when recognisable. */
function describeBrowser(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined) return undefined
  const browser = /Edg\//u.test(userAgent) ? 'Edge'
    : /OPR\//u.test(userAgent) ? 'Opera'
      : /Firefox\//u.test(userAgent) ? 'Firefox'
        : /Chrome\//u.test(userAgent) ? 'Chrome'
          : /Safari\//u.test(userAgent) ? 'Safari'
            : undefined
  const platform = /Windows/u.test(userAgent) ? 'Windows'
    : /iPhone|iPad|iPod/u.test(userAgent) ? 'iOS'
      : /Android/u.test(userAgent) ? 'Android'
        : /Mac OS X|Macintosh/u.test(userAgent) ? 'macOS'
          : /Linux/u.test(userAgent) ? 'Linux'
            : undefined
  const parts = [browser, platform].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** Localized display time for one epoch-millisecond value. */
function formatTime(value: number): string {
  return new Date(value).toLocaleString()
}

/** Name shown for one device: the operator's, then its token's, then a short id. */
function deviceTitle(device: AccessDeviceView): string {
  return device.label ?? device.tokenLabel ?? device.id.slice(0, 8)
}

/** Render the Access section: token list on top, device list below. */
export function AccessSettingsSection({
  t, load, createToken, revokeToken, renameDevice, revokeDevice,
}: AccessSettingsSectionProps) {
  const [directory, setDirectory] = useState<AccessDirectoryView>()
  const [failure, setFailure] = useState<string>()
  const [draft, setDraft] = useState('')
  const [minted, setMinted] = useState<AccessMintedTokenView>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renameId, setRenameId] = useState<string>()
  const [renameDraft, setRenameDraft] = useState('')

  const accept = useCallback((next: AccessDirectoryView) => {
    setDirectory(next)
    setFailure(undefined)
  }, [])

  const refresh = useCallback(async () => {
    try {
      accept(await load())
    } catch (error) {
      setFailure(messageOf(error))
    }
  }, [accept, load])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const write = async (action: () => Promise<AccessDirectoryView>) => {
    setBusy(true)
    try {
      accept(await action())
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const submitToken = async () => {
    const label = draft.trim()
    if (label === '') return
    setBusy(true)
    try {
      setMinted(await createToken(label))
      setCopied(false)
      setDraft('')
      accept(await load())
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (minted === undefined) return
    try {
      await navigator.clipboard.writeText(loginUrlFor(minted.secret))
      setCopied(true)
    } catch (error) {
      setFailure(messageOf(error))
    }
  }

  const saveRename = async (id: string) => {
    const label = renameDraft.trim()
    setRenameId(undefined)
    await write(() => renameDevice(id, label === '' ? undefined : label))
  }

  const tokens = directory?.tokens ?? []
  const devices = directory?.devices ?? []

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {directory?.damaged !== undefined && (
        <p className={css.warning} role="alert">{t('damaged')}: {directory.damaged}</p>
      )}
      {failure !== undefined && (
        <p className={css.warning} role="alert">
          {failure}{' '}
          <Button size="sm" onClick={() => { void refresh() }}>{t('retry')}</Button>
        </p>
      )}

      <section className={css.block}>
        <h3 className={css.blockHeading}>{t('tokens.title')}</h3>
        <p className={css.blockIntro}>{t('tokens.intro')}</p>
        <div className={css.createRow}>
          <Input
            value={draft}
            maxLength={64}
            disabled={busy}
            aria-label={t('tokens.placeholder')}
            placeholder={t('tokens.placeholder')}
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitToken()
            }}
          />
          <Button disabled={busy || draft.trim() === ''} onClick={() => { void submitToken() }}>
            {t('tokens.create')}
          </Button>
        </div>
        {minted !== undefined && (
          <div className={css.minted} role="status">
            <p className={css.mintedLabel}>{t('tokens.minted')}</p>
            <code className={css.link}>{loginUrlFor(minted.secret)}</code>
            <div className={css.rowActions}>
              <Button size="sm" onClick={() => { void copyLink() }}>
                {copied ? t('tokens.copied') : t('tokens.copy')}
              </Button>
            </div>
            <p className={css.hint}>{t('tokens.once')}</p>
          </div>
        )}
        {tokens.length === 0
          ? <p className={css.empty}>{t('tokens.empty')}</p>
          : (
            <ul className={css.list}>
              {tokens.map(token => (
                <li key={token.id} className={css.row}>
                  <div className={css.rowMain}>
                    <span className={css.rowTitle}>{token.label}</span>
                    <span className={css.rowMeta}>
                      {t('tokens.created')} {formatTime(token.createdAt)}
                      {' · '}
                      {t('tokens.deviceCount')} {token.deviceCount}
                      {' · '}
                      {t('tokens.lastUsed')}{' '}
                      {token.lastUsedAt === undefined ? t('tokens.never') : formatTime(token.lastUsedAt)}
                    </span>
                  </div>
                  <div className={css.rowActions}>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => { void write(() => revokeToken(token.id)) }}
                    >
                      {t('tokens.revoke')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={css.block}>
        <h3 className={css.blockHeading}>{t('devices.title')}</h3>
        <p className={css.blockIntro}>{t('devices.intro')}</p>
        {devices.length === 0
          ? <p className={css.empty}>{t('devices.empty')}</p>
          : (
            <ul className={css.list}>
              {devices.map(device => (
                <li
                  key={device.id}
                  className={device.revoked ? `${css.row} ${css.revoked}` : css.row}
                >
                  {renameId === device.id
                    ? (
                      <div className={css.renameRow}>
                        <Input
                          value={renameDraft}
                          maxLength={64}
                          autoFocus
                          aria-label={t('devices.renamePlaceholder')}
                          placeholder={t('devices.renamePlaceholder')}
                          onChange={(event) => { setRenameDraft(event.target.value) }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveRename(device.id)
                            if (event.key === 'Escape') setRenameId(undefined)
                          }}
                        />
                        <Button size="sm" disabled={busy} onClick={() => { void saveRename(device.id) }}>
                          {t('devices.renameSave')}
                        </Button>
                        <Button size="sm" onClick={() => { setRenameId(undefined) }}>
                          {t('devices.renameCancel')}
                        </Button>
                      </div>
                    )
                    : (
                      <>
                        <div className={css.rowMain}>
                          <span className={css.rowTitle}>
                            {deviceTitle(device)}
                            {device.revoked && ` (${t('devices.revoked')})`}
                          </span>
                          <span className={css.rowMeta}>
                            {device.tokenId === undefined ? t('devices.launch') : device.tokenLabel ?? ''}
                            {describeBrowser(device.userAgent) === undefined
                              ? ''
                              : ` · ${describeBrowser(device.userAgent) ?? ''}`}
                            {device.address === undefined ? '' : ` · ${device.address}`}
                            {' · '}
                            {t('devices.created')} {formatTime(device.createdAt)}
                            {' · '}
                            {t('devices.lastSeen')} {formatTime(device.lastSeenAt)}
                            {' · '}
                            {t('devices.expires')} {formatTime(device.expiresAt)}
                          </span>
                        </div>
                        <div className={css.rowActions}>
                          {!device.revoked && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setRenameId(device.id)
                                  setRenameDraft(device.label ?? '')
                                }}
                              >
                                {t('devices.rename')}
                              </Button>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => { void write(() => revokeDevice(device.id)) }}
                              >
                                {t('devices.revoke')}
                              </Button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
