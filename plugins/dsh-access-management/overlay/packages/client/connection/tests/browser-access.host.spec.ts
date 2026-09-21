/** Durable browser-access directory and device-bound session cookies. */

import { describe, expect, it } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BrowserAccessDirectory } from '../src/browser-access.ts'
import { BrowserAuth } from '../src/browser-auth.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end() {},
    },
    state,
  }
}

function request(url: string, authority = '127.0.0.1:3080', init?: {
  cookie?: string
  method?: string
  userAgent?: string
}): ConnectionIndexRequest {
  return {
    method: init?.method ?? 'GET',
    url,
    headers: {
      host: authority,
      ...init?.cookie === undefined ? {} : { cookie: init.cookie },
      ...init?.userAgent === undefined ? {} : { 'user-agent': init.userAgent },
    },
  }
}

/** Exchange one login URL and return the session cookie it set, without its attributes. */
function exchange(auth: BrowserAuth, url: string, authority = '127.0.0.1:3080'): string {
  const target = new URL(url)
  const res = response()
  expect(auth.authorizeIndex(request(`${target.pathname}${target.search}`, authority), res.value)).toBe(false)
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('exchange did not set a session cookie')
  return setCookie.split(';', 1)[0]!
}

describe('BrowserAccessDirectory', () => {
  it('starts empty when this Harness home stored none', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    expect(directory.tokens()).toEqual([])
    expect(directory.devices()).toEqual([])
    expect(directory.damaged).toBeUndefined()
    expect(directory.unenforceable).toBe(false)
  })

  it('reads back a token it created, through storage', async () => {
    const store = new RecordCredentials()
    const first = await BrowserAccessDirectory.load(credentials(store))
    const token = first.createToken('Office PC', NOW)
    await first.settled()

    const second = await BrowserAccessDirectory.load(credentials(store))
    expect(second.tokenBySecret(token.secret)?.id).toBe(token.id)
    expect(second.tokens()).toHaveLength(1)
  })

  it('revokes the devices a dropped token authorized', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    const token = directory.createToken('Office PC', NOW)
    const device = directory.registerDevice({ tokenId: token.id, createdAt: NOW, expiresAt: NOW + DAY })
    expect(directory.deviceActive(device.id)).toBe(true)

    expect(directory.revokeToken(token.id, NOW + 1)).toBe(true)
    expect(directory.deviceActive(device.id)).toBe(false)
    expect(directory.tokens()).toEqual([])
  })

  it('refuses a revoked device and reports an unknown one as inactive', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    const device = directory.registerDevice({ createdAt: NOW, expiresAt: NOW + DAY })
    expect(directory.revokeDevice(device.id, NOW + 1)).toBe(true)
    expect(directory.revokeDevice(device.id, NOW + 2)).toBe(false)
    expect(directory.deviceActive(device.id)).toBe(false)
    expect(directory.deviceActive('never-recorded')).toBe(false)
  })

  it('prunes devices whose cookie lifetime already ended', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    directory.registerDevice({ createdAt: NOW, expiresAt: NOW + DAY })
    const stale = directory.registerDevice({ createdAt: NOW, expiresAt: NOW + 1 })
    expect(directory.pruneExpired(NOW + 2)).toBe(1)
    expect(directory.device(stale.id)).toBeUndefined()
  })

  it('keeps the newest name when renaming, and clears it with undefined', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    const device = directory.registerDevice({ createdAt: NOW, expiresAt: NOW + DAY })
    expect(directory.renameDevice(device.id, 'MacBook')).toBe(true)
    expect(directory.device(device.id)?.label).toBe('MacBook')
    expect(directory.renameDevice(device.id, undefined)).toBe(true)
    expect(directory.device(device.id)?.label).toBeUndefined()
    expect(directory.renameDevice('missing', 'x')).toBe(false)
  })

  it('degrades to an empty, unenforceable directory when storage is unreadable', async () => {
    const store = new RecordCredentials()
    store.record = { kind: 'grant', payload: { version: 99, tokens: [], devices: [] } }
    const directory = await BrowserAccessDirectory.load(credentials(store))
    expect(directory.damaged).toBeDefined()
    expect(directory.unenforceable).toBe(true)
    // An unreadable directory must not lock every browser out of the GUI.
    expect(directory.deviceActive('anything')).toBe(true)
  })

  it('records device activity only past the write threshold', async () => {
    const directory = await BrowserAccessDirectory.load(credentials(new RecordCredentials()))
    const device = directory.registerDevice({ createdAt: NOW, expiresAt: NOW + DAY })
    directory.touchDevice(device.id, NOW + 1000, 60_000)
    expect(directory.device(device.id)?.lastSeenAt).toBe(NOW)
    directory.touchDevice(device.id, NOW + 120_000, 60_000)
    expect(directory.device(device.id)?.lastSeenAt).toBe(NOW + 120_000)
  })
})

describe('BrowserAuth access directory', () => {
  it('accepts a stored token, and binds the session to a device', async () => {
    const store = new RecordCredentials()
    const auth = await BrowserAuth.create({}, credentials(store), 30)
    const token = auth.access.createToken('Office PC', NOW)

    const cookie = exchange(auth, `http://127.0.0.1:3080/?token=${token.secret}`)
    const devices = auth.access.devices()
    expect(devices).toHaveLength(1)
    expect(devices[0]?.tokenId).toBe(token.id)
    expect(devices[0]?.userAgent).toBeUndefined()

    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)
    expect(auth.access.tokens()[0]?.lastUsedAt).toBeGreaterThan(0)
  })

  it('stops accepting the session once its device is revoked', async () => {
    const auth = await BrowserAuth.create({}, credentials(new RecordCredentials()), 30)
    const token = auth.access.createToken('Office PC', NOW)
    const cookie = exchange(auth, `http://127.0.0.1:3080/?token=${token.secret}`)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)

    const device = auth.access.devices()[0]!
    auth.access.revokeDevice(device.id, NOW + 1)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
  })

  it('refuses a secret no token owns', async () => {
    const auth = await BrowserAuth.create({}, credentials(new RecordCredentials()), 30)
    const res = response()
    expect(auth.authorizeIndex(request('/?token=not-a-token'), res.value)).toBe(false)
    expect(res.state.status).toBe(401)
    expect(auth.access.devices()).toEqual([])
  })

  it('records the forwarded address at device creation', async () => {
    const auth = await BrowserAuth.create({}, credentials(new RecordCredentials()), 30)
    const token = auth.access.createToken('Office PC', NOW)
    const target = new URL(`http://127.0.0.1:3080/?token=${token.secret}`)
    const res = response()
    auth.authorizeIndex({
      method: 'GET',
      url: `${target.pathname}${target.search}`,
      headers: {
        host: '127.0.0.1:3080',
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120',
        'x-forwarded-for': '192.168.169.55, 10.0.0.1',
      },
    }, res.value)
    expect(auth.access.devices()[0]?.address).toBe('192.168.169.55')
    expect(auth.access.devices()[0]?.userAgent).toContain('Chrome')
  })

  it('keeps the process launch token working regardless of the directory', async () => {
    const auth = await BrowserAuth.create({}, credentials(new RecordCredentials()), 30)
    const cookie = exchange(auth, auth.authenticatedUrl('http://127.0.0.1:3080'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)
    // The launch token names no stored token, so its device carries no tokenId.
    expect(auth.access.devices()[0]?.tokenId).toBeUndefined()
  })
})
