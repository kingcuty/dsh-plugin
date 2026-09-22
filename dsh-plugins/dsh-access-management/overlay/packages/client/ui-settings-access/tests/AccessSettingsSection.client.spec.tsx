// @vitest-environment jsdom
/** Access settings section behavior over a scripted Host directory. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccessDirectoryView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AccessSettingsSection, type AccessSectionInjected, type AccessSettingsSectionProps,
} from '../src/client/AccessSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const dictionary: Record<string, string> = zh
const START = 1_700_000_000_000
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

const EMPTY: AccessDirectoryView = { tokens: [], devices: [] }

const TOKEN = {
  id: 'tok1',
  label: 'Office PC',
  createdAt: START,
  deviceCount: 1,
}

const DEVICE = {
  id: 'dev1',
  tokenId: 'tok1',
  tokenLabel: 'Office PC',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36',
  address: '192.168.169.55',
  createdAt: START,
  lastSeenAt: START + 60_000,
  expiresAt: START + THIRTY_DAYS,
  revoked: false,
}

/** Mount the section with a scripted host face. */
function mount(overrides: Partial<AccessSectionInjected> = {}): AccessSectionInjected {
  const injected: AccessSectionInjected = {
    load: vi.fn(async () => ({ tokens: [TOKEN], devices: [DEVICE] })),
    createToken: vi.fn(async (label: string) => ({ token: { ...TOKEN, label }, secret: 'minted-secret' })),
    revokeToken: vi.fn(async () => EMPTY),
    renameDevice: vi.fn(async () => EMPTY),
    revokeDevice: vi.fn(async () => EMPTY),
    ...overrides,
  }
  const props = {
    t: (key: string) => dictionary[key] ?? key,
    close: () => {},
    ...injected,
  } as unknown as AccessSettingsSectionProps
  render(<AccessSettingsSection {...props} />)
  return injected
}

describe('AccessSettingsSection', () => {
  it('lists the tokens and devices the host answered with', async () => {
    mount()
    expect(await screen.findByText('Office PC')).toBeDefined()
    expect(screen.getByText('访问管理')).toBeDefined()
    expect(screen.getByText('登录设备')).toBeDefined()
    expect(screen.getByText('192.168.169.55', { exact: false })).toBeDefined()
  })

  it('mints a token and shows its one-time login link', async () => {
    const injected = mount()
    fireEvent.change(screen.getByLabelText('设备名称，例如：办公电脑'), {
      target: { value: '办公电脑' },
    })
    fireEvent.click(screen.getByText('新增令牌'))
    await waitFor(() => { expect(injected.createToken).toHaveBeenCalledWith('办公电脑') })
    expect(await screen.findByText('http://localhost:3000/?token=minted-secret')).toBeDefined()
  })

  it('does not mint while the name is blank', async () => {
    const injected = mount()
    fireEvent.click(screen.getByText('新增令牌'))
    await waitFor(() => { expect(screen.getByText('还没有令牌，用上面的输入框新增一个。')).toBeDefined() })
    expect(injected.createToken).not.toHaveBeenCalled()
  })

  it('revokes a token and signs a device out', async () => {
    const injected = mount()
    await screen.findByText('Office PC')
    fireEvent.click(screen.getByText('吊销'))
    await waitFor(() => { expect(injected.revokeToken).toHaveBeenCalledWith('tok1') })
    fireEvent.click(screen.getByText('退出登录'))
    await waitFor(() => { expect(injected.revokeDevice).toHaveBeenCalledWith('dev1') })
  })

  it('renames a device through the host face', async () => {
    const injected = mount()
    await screen.findByText('Office PC')
    fireEvent.click(screen.getByText('重命名'))
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '我的 MacBook' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => { expect(injected.renameDevice).toHaveBeenCalledWith('dev1', '我的 MacBook') })
  })

  it('reports an unreadable stored directory above the lists', async () => {
    mount({ load: vi.fn(async () => ({ ...EMPTY, damaged: 'record has an unsupported version' })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('record has an unsupported version')
  })

  it('reports a failed read and retries it', async () => {
    const load = vi.fn(async () => { throw new Error('transport down') })
    mount({ load })
    expect((await screen.findByRole('alert')).textContent).toContain('transport down')
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })
})
