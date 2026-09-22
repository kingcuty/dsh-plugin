import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** Load the browser half with a stubbed module loader and baseline require. */
async function loadPlugin() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const loaded = []
  globalThis.window = { __ModuleLoader__: { load: registration => { loaded.push(registration) } } }
  const react = {
    createElement: () => null,
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
  const require = specifier => {
    if (specifier === 'react') return react
    if (specifier === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: init => ({ getSnapshot: () => init, set: () => {}, subscribe: () => () => {} }) }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error('unexpected require: ' + specifier)
  }
  // The bundle is not an ES module: run it in a function scope with the stubs.
  await new Function('window', 'require', source)(globalThis.window, require)
  assert.equal(loaded.length, 1, 'the bundle must register exactly one row')
  assert.equal(loaded[0].id, 'dsh-mobile-ui')
  return loaded[0].factory(require)
}

const { __internals } = await loadPlugin()
const { isMobilePlatform, overlayColumns, CSS, ENABLED_KEY, readEnabled, writeEnabled } = __internals

test('identifies the phone platforms the plugin serves', () => {
  const phones = [
    'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/5.0.0.31 Mobile HuaweiBrowser/5.0.0.310',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; HarmonyOS 4.0; ALN-AL00) AppleWebKit/537.36 Mobile Safari/537.36',
  ]
  for (const userAgent of phones) assert.equal(isMobilePlatform(userAgent), true, userAgent)
  const desktops = [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ]
  for (const userAgent of desktops) assert.equal(isMobilePlatform(userAgent), false, userAgent)
})

test('zeroes only the frame left track and keeps the solved right track', () => {
  assert.equal(overlayColumns('280px minmax(0, 1fr) 420px'), '0px minmax(0, 1fr) 420px')
  assert.equal(overlayColumns('56px minmax(0, 1fr) 0px'), '0px minmax(0, 1fr) 0px')
})

test('falls back to a left-free template when the frame template is unknown', () => {
  assert.equal(overlayColumns(''), '0px minmax(0, 1fr) 0px')
  assert.equal(overlayColumns(undefined), '0px minmax(0, 1fr) 0px')
  assert.equal(overlayColumns('auto 1fr auto'), '0px minmax(0, 1fr) 0px')
})

test('keeps the Settings switch on unless it was explicitly turned off', () => {
  assert.equal(ENABLED_KEY, 'dsh-mobile-ui.enabled')
  // No storage at all (this harness, private mode): the plugin stays on.
  assert.equal(readEnabled(), true)
  const store = new Map()
  globalThis.window.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
  }
  assert.equal(readEnabled(), true, 'an untouched browser profile reads as on')
  writeEnabled(false)
  assert.equal(readEnabled(), false, 'Disable survives a reload')
  writeEnabled(true)
  assert.equal(readEnabled(), true)
  delete globalThis.window.localStorage
})

test('names the upstream seam that a future DSH build renames', () => {
  const { SEAMS, REQUIRED_SEAMS, missingSeams } = __internals
  const fakeRoot = selectors => ({ querySelector: selector => (selectors.includes(selector) ? {} : null) })
  assert.deepEqual(missingSeams(fakeRoot(Object.values(SEAMS))), [], 'a complete DOM reports nothing')
  assert.deepEqual(missingSeams(fakeRoot([])), REQUIRED_SEAMS, 'an empty DOM reports every structural seam')
  assert.deepEqual(missingSeams(fakeRoot([SEAMS.card])), REQUIRED_SEAMS.filter(name => name !== 'card'))
  for (const name of REQUIRED_SEAMS) assert.ok(SEAMS[name] !== undefined, 'unknown required seam ' + name)
  assert.ok(SEAMS.todoPanel !== undefined && SEAMS.queueDock !== undefined, 'optional feature seams stay declared')
})

test('ships the selectors the adaptation depends on', () => {
  for (const selector of [
    '[data-dshm-frame]', '[data-dshm-sidebar]', '[data-dshm-center]', '[data-dshm-right]',
    "[data-dshm-composer='collapsed']", '[data-composer-card]', '[data-conversation-scroll]',
    '.dshm-handle', '.dshm-scrim', '.dshm-fab',
  ]) assert.ok(CSS.includes(selector), 'missing ' + selector)
})
