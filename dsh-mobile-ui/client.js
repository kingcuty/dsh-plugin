/**
 * DSH mobile UI plugin — browser half.
 *
 * Phone-shaped, touch platforms (iOS, Android, HarmonyOS) get two adaptations,
 * neither of which modifies an official package:
 *
 * 1. The left column leaves the frame's grid tracks and becomes an off-canvas
 *    drawer: closed it costs nothing, open it slides over a full-width centre.
 *    A handle on the frame's left edge opens it; a full-frame scrim dismisses
 *    it; choosing a session or a global panel dismisses it too.
 * 2. The composer card collapses to a floating button so the conversation keeps
 *    the height; the button expands the same official card, tool row and send
 *    button.
 *
 * Everything the adaptation needs is read from the shell's stable seams —
 * `[data-shell-overlay]` (frame discovery), `[data-sidebar-collapsed]` (the
 * column's state), `[data-phase]` (conversation phase), `[data-composer-card]`
 * (the composer body) — plus the public slot and service faces. No core package
 * is patched, and unloading this plugin removes every write it made.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mobile-ui',
  factory: (require) => {
    const React = require('react')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'mobileUi'

/*
 * Every upstream DOM seam this plugin reads, in one table. They are attributes the
 * official Web client publishes; when a DSH upgrade renames one, this is the only
 * place to edit and the console names the seam that went missing.
 */
const SEAMS = {
  shellOverlay: '[data-shell-overlay]',
  frame: '[data-dshm-frame]',
  phaseRoot: '[data-phase]',
  header: '[data-phase] header',
  headerMenuButton: "[data-phase] header button[aria-haspopup='menu']",
  headerMenuButtonOpen: "[data-phase] header button[aria-haspopup='menu'][aria-expanded='true']",
  card: '[data-composer-card]',
  seat: '[data-composer-seat]',
  inputScroll: '[data-input-scroll]',
  chatFlow: '[data-chat-flow]',
  statsRow: '[data-composer-stats]',
  toBottomSlot: "[class*='toBottomSlot']",
  rightSidebarButton: '[data-sidebar-right-expand]',
  todoPanel: "[data-testid='todo-panel']",
  queueDock: '[data-queue-dock]',
}

/*
 * Structural seams: without these the plugin cannot place itself at all. The others
 * belong to optional features (the task card and queue dock only exist while those
 * features are in use), so their absence is not a version break.
 */
const REQUIRED_SEAMS = ['shellOverlay', 'phaseRoot', 'header', 'card', 'seat', 'chatFlow', 'statsRow']

const seam = (name, root = document) => {
  const selector = SEAMS[name]
  return selector === undefined ? null : root.querySelector(selector)
}

const missingSeams = (root = document) => REQUIRED_SEAMS.filter(name => root.querySelector(SEAMS[name]) === null)

const reportMissingSeams = (root = document) => {
  const missing = missingSeams(root)
  if (missing.length === 0) return
  const detail = missing.map(name => `${name} ${SEAMS[name]}`).join(', ')
  console.warn(`[${NS}] DSH DOM seam missing: ${detail} — this DSH build renamed them, update SEAMS in client.js`)
}
    /** Frame width below which the phone presentation applies (the shell's own auto-collapse). */
    const NARROW_MAX = 1024
    /** User-agent families whose platforms get the phone presentation. */
    const MOBILE_PLATFORM = /Android|iPhone|iPad|iPod|HarmonyOS|OpenHarmony|ArkWeb/i

    /*
     * The Settings → General switch. Stored per browser profile, which is the right
     * scope for a phone presentation (a desktop never reads it). Missing or
     * unreadable storage reads as on, so a fresh install keeps working.
     */
    const ENABLED_KEY = 'dsh-mobile-ui.enabled'
    const readEnabled = () => {
      try {
        return window.localStorage.getItem(ENABLED_KEY) !== 'off'
      } catch {
        // Storage blocked (private mode, sandboxed frame): stay enabled.
        return true
      }
    }
    const writeEnabled = (value) => {
      try {
        window.localStorage.setItem(ENABLED_KEY, value ? 'on' : 'off')
      } catch {
        // Nothing to persist into; the running session still switches.
      }
    }

    const zh = {
      'sidebar.open': '打开侧边栏',
      'sidebar.close': '收起侧边栏',
      'composer.expand': '展开输入框',
      'composer.collapse': '收起输入框',
      'settings.title': '移动端优化',
      'settings.description': '在 iOS / Android / 鸿蒙手机上启用抽屉侧栏与可收缩输入区',
      'settings.enable': '启用',
      'settings.disable': '停用',
      'settings.action': '移动端优化开关',
    }

    const en = {
      'sidebar.open': 'Open sidebar',
      'sidebar.close': 'Collapse sidebar',
      'composer.expand': 'Expand composer',
      'composer.collapse': 'Collapse composer',
      'settings.title': 'Mobile UI optimisation',
      'settings.description': 'Drawer sidebar and collapsible composer on iOS / Android / HarmonyOS phones',
      'settings.enable': 'Enable',
      'settings.disable': 'Disable',
      'settings.action': 'Mobile UI optimisation switch',
    }

    /*
     * Track overrides. The frame's own columns are an inline style, so only an
     * important declaration wins; `--dshm-columns` carries the frame's own
     * template with the left track zeroed, which keeps the right column's track
     * exactly as the frame solved it.
     */
    const CSS = `
/*
 * One clock for the composer's expand/collapse choreography: the card grows from the
 * bottom while its content, the tool rail and the pinned circles slide in from the
 * right. Retune the whole motion from these five values.
 */
html[data-dshm] {
  /* One clock for the whole gesture: the card and its input move exactly like the
     vertical controls, and only the rail's per-button stagger is stepped. */
  --dshm-card-grow: 240ms;
  --dshm-card-fade: 170ms;
  --dshm-input-move: 200ms;
  --dshm-item-move: 200ms;
  --dshm-item-fade: 170ms;
  /* Step 15ms + move 200ms: the fourth and last control lands with the card
     (3 x 15 + 200 = 245ms), so the whole gesture still reads as one piece. */
  --dshm-item-step: 15ms;
  --dshm-chip-move: 200ms;
  --dshm-chip-fade: 170ms;
}

html[data-dshm] [data-dshm-frame] {
  grid-template-columns: var(--dshm-columns, 0px minmax(0, 1fr) 0px) !important;
}

html[data-dshm] [data-dshm-sidebar] {
  grid-column: 1;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: max-content;
  max-width: 88vw;
  z-index: 21;
  visibility: hidden;
  transform: translateX(-102%);
  transition: transform 200ms var(--ds-ease-in-out), visibility 0s linear 200ms;
  border-right: 0.5px solid var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-prominent);
}

html[data-dshm] [data-dshm-frame]:not([data-sidebar-collapsed]) [data-dshm-sidebar] {
  visibility: visible;
  transform: none;
  transition-delay: 0s;
}

/* Explicit placement: a fixed column leaves the grid flow, and auto-placement
   would otherwise slide the centre into the zero-width track it left behind. */
html[data-dshm] [data-dshm-center] { grid-column: 2; }
html[data-dshm] [data-dshm-right] { grid-column: 3; }

/* Column resize handles belong to pointer devices. */
html[data-dshm] [data-dshm-frame] [data-side] { display: none; }

/*
 * Closed-drawer handle: the mirror of the header's own right-sidebar button.
 * The official control is a 28px circle holding a 15px glyph, so this one uses
 * exactly that recipe — the two read as one symmetric pair, and nothing is drawn
 * behind the icon (no fill, no border).
 */
.dshm-handle {
  position: fixed;
  /* Measured by the adapter from the header's own right-sidebar button, so the two
     corner controls share a band whatever the header's padding works out to. */
  top: var(--dshm-handle-top, 6px);
  left: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dshm-handle svg {
  width: 15px;
  height: 15px;
}

/* Touch devices keep :hover after a tap, which would leave a dark pill behind
   the glyph; the official control's own hover is for pointer devices only. */
@media (hover: hover) {
  .dshm-handle:hover { background: var(--dsw-alias-interactive-bg-hover); }
}

/*
 * Settings on phones. The official panel reserves a 188px nav rail inside a
 * max-width: calc(100vw - 48px) box, so on a 390px frame the content column is
 * ~100px wide and every label wraps to one character per line. As a phone sheet the
 * panel turns into a column, the rail becomes a scrollable chip strip, and every
 * row gets the full width. Scoped to html[data-dshm], so the Settings switch turns
 * this off together with the rest.
 */
html[data-dshm] [role='dialog'][aria-modal='true'] {
  flex-direction: column;
  width: calc(100vw - 16px);
  max-width: calc(100vw - 16px);
  height: calc(100vh - 24px);
  max-height: calc(100vh - 24px);
  border-radius: 20px;
}

/*
 * The panel is now a column, so the content column must be allowed to shrink:
 * without min-height: 0 a column flex child keeps its content height, the panel's
 * overflow: hidden clips it, and the inner scroller never gets a viewport.
 */
html[data-dshm] [role='dialog'][aria-modal='true'] > :not(nav) {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

html[data-dshm] [role='dialog'][aria-modal='true'] nav {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: auto;
  padding: 10px 12px 0;
  overflow-x: auto;
}

/* The 设置 / Settings title moves out: the content header already names the section. */
html[data-dshm] [role='dialog'][aria-modal='true'] nav > :first-child {
  display: none;
}

html[data-dshm] [role='dialog'][aria-modal='true'] nav > :last-child {
  flex-direction: row;
  gap: 8px;
}

html[data-dshm] [role='dialog'][aria-modal='true'] nav button {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  white-space: nowrap;
}

/* Chips read as labels; the section icons stay on the desktop panel. */
html[data-dshm] [role='dialog'][aria-modal='true'] nav button svg {
  display: none;
}

/* Appearance cubes: three across instead of three stacked. */
html[data-dshm] [role='dialog'][aria-modal='true'] [class*='cubeRow'] {
  flex-wrap: nowrap;
}

html[data-dshm] [role='dialog'][aria-modal='true'] [class*='themeCube'] {
  flex: 1 1 0;
  padding: 12px 6px;
  border-radius: 14px;
}

/* Settings → General row: official preference-row metrics (title 14/22 primary,
   description 12/18 tertiary, 16px vertical padding, hairline separator) so the
   plugin's row is indistinguishable from the built-in ones. */
.dshm-set-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.dshm-set-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 24px;
}

.dshm-set-title {
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}

.dshm-set-desc {
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dshm-set-selector {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.dshm-set-chevron { flex: none; }

.dshm-handle:active { color: var(--dsw-alias-label-primary); }

/* Open-drawer dismissal: one full-frame target under the drawer column. */
.dshm-scrim {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: var(--dsw-alias-bg-mask-1);
  cursor: pointer;
}

/*
 * Collapse and expand animate instead of snapping: the card keeps its box and
 * grows/shrinks through max-height (the composer seat follows, so the transcript
 * eases with it) plus a fade. No transform on the card or on the row: both hold
 * position:fixed controls whose anchor must stay the viewport.
 */
/*
 * No clip while settled: the card anchors the composer's own popups (the command
 * list opens upward from it), and overflow:hidden would cut them off. The clip
 * is applied inline only for the duration of the height transition.
 */
html[data-dshm] [data-phase='active'] [data-composer-card] {
  opacity: 1;
  transition:
    max-height var(--dshm-card-grow, 360ms) var(--ds-ease-in-out),
    opacity var(--dshm-card-fade, 260ms) var(--ds-ease-in-out);
}

html[data-dshm] [data-phase='active'] [data-composer-card] [data-input-scroll] {
  translate: none;
  opacity: 1;
  transition:
    translate var(--dshm-input-move, 460ms) var(--ds-ease-in-out),
    opacity var(--dshm-card-fade, 340ms) var(--ds-ease-in-out);
}

html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-composer-card] [data-input-scroll] {
  translate: 28px 0;
  opacity: 0;
}

html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-composer-card] {
  max-height: 0;
  /* Symmetric padding, both ends removed: either side would keep a sliver. */
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  pointer-events: none;
  /*
   * Clip the shrunken body: its still-rendered contents (the draft row, the
   * tool row) would otherwise count as the scrollport's overflow, so the
   * conversation could always scroll ~25px past its own end and the permanent
   * stats row would appear to float above the bottom.
   */
  overflow: hidden;
}

/* The tool rail and the pinned circles are viewport-fixed (overflow cannot clip
   them), so they animate on their own clock; the row itself only carries the
   interaction guard, held until the last control of the cascade has left. */
/*
 * The rail is only faded, never unrendered: an element the browser does not
 * paint runs no transition, so a visibility or display toggle here would make
 * every control snap in. The collapsed rail is taken out of reach with the inert
 * attribute (set by the adapter), which blocks pointer and keyboard without
 * touching rendering.
 */
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-composer-card] > :last-child {
  pointer-events: none;
  /* Held visible while its controls leave, then the whole row goes — otherwise the
     official labelled row shows through the still-shrinking card. Opacity (not
     visibility) keeps the children rendered, so their expand transitions still run. */
  opacity: 0;
  transition: opacity 0s linear 260ms;
}

html[data-dshm][data-dshm-composer='expanded'] [data-phase='active'] [data-composer-card] > :last-child {
  pointer-events: auto;
  opacity: 1;
  transition: opacity 0s;
}

html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-composer-card] [data-dshm-primary] {
  opacity: 0;
  translate: 16px 0;
  transition:
    opacity 200ms var(--ds-ease-in-out),
    translate var(--dshm-item-move, 320ms) var(--ds-ease-in-out);
}

html[data-dshm][data-dshm-composer='expanded'] [data-phase='active'] [data-composer-card] [data-dshm-primary] {
  opacity: 1;
  translate: none;
  transition:
    opacity var(--dshm-item-fade, 260ms) var(--ds-ease-in-out) 60ms,
    translate var(--dshm-item-move, 320ms) var(--ds-ease-in-out) 60ms;
}

/* One control per step: each rail button fades and rises in its own slot, so the
   column unfolds top-to-bottom and folds away in the same order. */
html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]) {
  opacity: 1;
  translate: none;
  transition:
    opacity var(--dshm-chip-fade, 150ms) var(--ds-ease-in-out) calc(var(--dshm-i, 0) * var(--dshm-item-step, 30ms)),
    translate var(--dshm-chip-move, 190ms) var(--ds-ease-in-out) calc(var(--dshm-i, 0) * var(--dshm-item-step, 30ms)),
    background-color 120ms var(--ds-ease-in-out);
}

html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]) {
  opacity: 0;
  translate: 16px 12px;
  transition:
    opacity var(--dshm-chip-fade, 150ms) var(--ds-ease-in-out) calc((3 - var(--dshm-i, 0)) * var(--dshm-item-step, 30ms)),
    translate var(--dshm-chip-move, 190ms) var(--ds-ease-in-out) calc((3 - var(--dshm-i, 0)) * var(--dshm-item-step, 30ms));
}

html[data-dshm][data-dshm-composer='collapsed'] [data-conversation-scroll] {
  --dsh-composer-height: 96px !important;
}

/* The toggle keeps its expanded seat while collapsed, so the transcript reserves
   the height that seat spans (its top sits 68px above the frame bottom). */
/*
 * The toggle floats over the transcript (position: fixed) rather than reserving a
 * row, so the conversation scrolls to the bottom of the scrollport and passes
 * under it — the official 16px gap between the flow and the composer seat still
 * keeps the last line clear of the permanent stats row.
 */
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-chat-flow] {
  padding-bottom: 0;
  /*
   * Line the transcript's last row up with the floating toggle: the flow ends 5px
   * lower inside the official gap before the composer seat, so the turn status row
   * (centre 790 instead of 785) shares the button's centre line. The seat, and so
   * the permanent stats row, does not move.
   */
  margin-bottom: -5px;
}

/*
 * Expanded: the composer yields the bottom-right corner to the toggle, so the
 * send button and the collapse control are never adjacent (two round targets a
 * thumb's width apart are a mis-tap waiting to happen). The docks and the stats
 * strip ride the same inset so the whole stack keeps one width axis.
 */
/* Both states reserve the control column: expanded it holds the tool rail,
   collapsed it holds the toggle — and the queued-message list and the task list
   live here in both, so they must stop clear of it either way. Measured against
   the rail's own left edge; the fallback only covers the first paint. */
html[data-dshm] [data-phase='active'] [data-composer-seat] {
  padding-right: var(--dshm-rail-inset, 42px);
}

/*
 * The tool row leaves the card and becomes a vertical rail on the frame's right
 * edge, stacked above the collapse toggle: attach, permission, model, context
 * meter, then the toggle. The rail is narrow, so the official chips' own
 * container rules render them icon-only without any per-chip override.
 */
html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child {
  position: fixed;
  right: 16px;
  bottom: calc(var(--dshm-card-bottom, 8px) + 46px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 36px;
  padding: 0;
  background: transparent;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child > * {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: auto;
  margin: 0;
}

/* A picker opened from the rail anchors on its own trigger at the frame's right
   edge: read-outs that would cross the frame are shifted back inside it. */
[data-dshm-shift] {
  translate: calc(-1 * var(--dshm-shift, 0px));
}

/*
 * The task list draws itself with the composer's side clearance already applied,
 * and it sits in a container that this plugin has already inset for the control
 * column — so it lands ~16px narrower than the input card on each side. Pin it
 * to the same band the card uses instead.
 */
/*
 * The Chat / Trajectory tabs move into the header's more-actions menu (see
 * augmentHeaderMenu): on a phone that row costs a whole line for an occasional
 * switch, and the menu is already the header's overflow affordance.
 */
/* Scoped to the conversation's own tab row: the right sidebar's panel tabs
   (Files, …) use the same role and must keep their strip. */
html[data-dshm] [data-phase] header [role='tablist'] {
  display: none;
}

/* The header's own height is a constant sized for title row + tab row, so hiding
   the tabs alone leaves the space behind: give it the height of the title row and
   its padding instead (measured by the adapter, 40px before the first pass). */
html[data-dshm] [data-phase] header {
  height: var(--dshm-header-h, 40px) !important;
  min-height: var(--dshm-header-h, 40px) !important;
  /*
   * The official header pads only its top, which leaves the title row flush with the
   * header's lower edge: by ink it sat 17.5px from the top and 9px from the bottom.
   * Split the same total evenly instead, so the glyphs measure 12.5 / 14 — balanced
   * without making the header a single pixel taller than the official 40px.
   */
  padding-top: 5px !important;
  padding-bottom: 5px !important;
}

/*
 * The permanent stats row is the bottom-most element: the rail column ends above it
 * and the floating toggle lives in the band above, so it takes back the width the
 * seat reserves for that column and re-centres on the frame. The wider row gives
 * the stat pills more characters before they truncate.
 */
html[data-dshm] [data-phase='active'] [data-composer-stats] {
  /*
   * The row's own width stops one composer clearance short on each side, and the
   * seat reserves the control column for the cards above. Both are taken back here
   * (a wider row and half the reserve as a shift) so the row spans the composer's
   * full width on the frame's centre line, and the stat pills get the same 32px of
   * extra room for their text before they truncate.
   */
  /*
   * Take back the composer's own side clearance AND the seat's control-column
   * reserve: the row then has the frame's whole width to lay the pills out, so a
   * narrower phone still fits their text (the row's own box is transparent, and the
   * pills stay inside the frame because the row's padding keeps them there).
   */
  width: calc(100% + var(--dsh-composer-side-clearance, 16px) * 2 + var(--dshm-rail-inset, 42px)) !important;
  /* Only a token inset: the row runs to the screen edges and its own centred
     content decides where the pills sit, so a phone with a little less room still
     fits their text before it truncates. */
  padding-left: 8px !important;
  padding-right: 8px !important;
  /* Measured by the adapter: the offset that lands the row on the frame's centre. */
  translate: var(--dshm-stats-shift, 0px) 0;
}

/*
 * Collapsed, the task list and the goal bar join the composer card's band. Expanded
 * they keep their own official width, which is the same inset the queued-message
 * card uses there — the three docks read as one stack.
 */
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-testid='todo-panel'],
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-goal-bar] {
  width: auto;
  margin-left: var(--dsh-composer-side-clearance, 16px);
  margin-right: var(--dsh-composer-side-clearance, 16px);
}

/*
 * The adapter aligns this with the round control of the current composer state —
 * the send button while expanded, the collapse toggle while collapsed — so the
 * pair always shares one vertical centre line and the control rail keeps its
 * column to itself.
 */
html[data-dshm] [data-dshm-to-bottom] {
  translate: calc(-1 * var(--dshm-to-bottom-shift, 0px)) 0;
  transition: translate var(--dshm-item-move, 320ms) var(--ds-ease-in-out);
}

/*
 * Collapsed, the queued-message card stands alone above the permanent stats row, so
 * it takes the task list card's exact shape: the panel's own 2px inset becomes 1px
 * (the official 36px header row plus 2px = the task card's 38px), and the corner
 * shape closes — the official card is top-rounded only because it used to merge
 * into the input card underneath, which is hidden here.
 */
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-queue-dock] > * {
  /* Official: 36px header row + a 2px panel inset = 40px; the task card's band is 38. */
  padding: 1px 0;
  border-radius: 12px;
}

html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-queue-dock] > *::after {
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

/* Collapsed, the queued-message card takes the task list's band; expanded it
   keeps the composer's own width. */
html[data-dshm][data-dshm-composer='collapsed'] [data-phase='active'] [data-queue-dock] {
  width: auto;
  margin-left: var(--dsh-composer-side-clearance, 16px);
  margin-right: var(--dsh-composer-side-clearance, 16px);
  /* The dock also carries the official 8px dock inset as padding, which would leave
     the visible card at 24–322 while the task card is 16–330. */
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/*
 * One rounded rectangle per function, matching the collapse toggle: the chips
 * keep their own glyph, minus the label and chevron the rail has no room for.
 * The menu items of the pickers the rail opens are explicitly out of scope —
 * they are buttons inside the row too, and the chip box would leave them
 * unreadable (36px wide, text hidden); as menu rows they keep their own layout.
 */
html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]):not([role='menu'] *) {
  display: grid;
  place-items: center;
  width: 36px;
  /* Same box as the collapse toggle below the column, so the rail reads as one
     family in both states. */
  height: 32px;
  min-width: 36px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 9px;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]):not([role='menu'] *) > span {
  display: none;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]) > span:first-child {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]) > svg ~ svg {
  display: none;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child button:not([data-dshm-primary]):hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

/* Only the primary circles (send / stop, marked by the adapter) stay with the
   input: they pin back into the card's right end while the rail holds the rest. */
html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child [data-dshm-primary] {
  position: fixed;
  right: calc(var(--dshm-card-right, 16px) + 12px);
  /* Anchored to the card's BOTTOM-right corner in every draft height: a growing
     draft grows upward while the circle keeps its seat (9px against the card's
     52px single-line band). The official circle carries a -2px nudge that
     belonged to the tool row it used to sit in. */
  bottom: calc(var(--dshm-card-bottom, 8px) + 9px);
  transform: none;
}

html[data-dshm] [data-phase='active'] [data-composer-card] > :last-child [data-dshm-primary] ~ [data-dshm-primary] {
  right: calc(var(--dshm-card-right, 16px) + 50px);
}

/* With the row gone the card holds the draft alone: give it one symmetric band
   (the pinned circles are 34px, so 52px leaves 9px above and below them) and
   centre the draft inside it, instead of the official top-heavy padding that
   expected a tool row underneath. */
html[data-dshm][data-dshm-composer='expanded'] [data-phase='active'] [data-composer-card] {
  /* The 52px single-line band comes from the input plus equal padding: a min-height
     here would out-rank the collapsed max-height (min wins) and the height would
     snap instead of animating. */
  padding-top: 8px;
  padding-bottom: 8px;
  justify-content: center;
}

/* The pinned send sits over the card's right end: the draft and its placeholder
   reserve that width so no glyph runs under it. */
html[data-dshm][data-dshm-composer='expanded'] [data-phase='active'] [data-composer-card] [contenteditable] {
  min-height: 36px;
  padding-top: 6px;
  padding-bottom: 6px;
  padding-right: 48px;
}

html[data-dshm][data-dshm-composer='expanded'] [data-phase='active'] [data-composer-card] [data-composer-placeholder] {
  top: 6px;
  right: 48px;
}

/*
 * ONE control for both states: same size, same fill, same glyph family, the
 * arrow only turns to face the direction the tap moves the composer. It stays
 * on the frame's bottom-right corner column in both states; expanded it lines
 * up with the composer's tool row beside the corner the stack gave up.
 */
.dshm-fab {
  position: fixed;
  right: 16px;
  /*
   * ONE seat in both states, and the same centre line as the send button: the send
   * is a 34px circle pinned 9px above the card's bottom (centre = +26), so a 32px
   * toggle must sit 10px above it to share that centre. 8px here would leave the
   * toggle 2px lower when collapsed than while expanded — a visible jump on every
   * toggle. The adapter's measured --dshm-fab-bottom resolves to the same value.
   */
  bottom: var(--dshm-fab-bottom, calc(var(--dshm-card-bottom, 30px) + 10px));
  display: grid;
  place-items: center;
  width: 36px;
  /* One chip size for the whole control family; collapsed the adapter lets it
     follow the task list card instead (38px when there is none). */
  height: 32px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 9px;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
  cursor: pointer;
  transition:
    bottom var(--dshm-item-move, 320ms) var(--ds-ease-in-out),
    height var(--dshm-item-move, 320ms) var(--ds-ease-in-out),
    background-color var(--dshm-item-fade, 260ms) var(--ds-ease-in-out),
    border-color var(--dshm-item-fade, 260ms) var(--ds-ease-in-out),
    color var(--dshm-item-fade, 260ms) var(--ds-ease-in-out);
}

.dshm-fab:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }

/* Collapsed, the button is the one call to action on screen: it wears the send
   circle's fill. Static white glyph, matching the official send circle's own
   rationale (white stays readable on the blue fill in both themes). */
html[data-dshm-composer='collapsed'] .dshm-fab {
  background: var(--dsw-alias-button-info-fill);
  border-color: transparent;
  color: #fff;
  /*
   * Inset against the task list rather than matching it: a solid saturated fill
   * optically reads ~2px larger than the same height in a flat dark panel, so an
   * equal box looks oversized. 3px per side (centres kept) reads equal and keeps
   * the action subordinate to the card beside it.
   */
  --dshm-dock-inset: 3px;
  height: calc(var(--dshm-dock-h, 38px) - var(--dshm-dock-inset) * 2);
}

html[data-dshm-composer='collapsed'] .dshm-fab:hover {
  background: var(--dsw-alias-button-info-hover);
}

/*
 * A phone has no pointer to drag a bar with: every scroll region scrolls by
 * touch, and the app's reserved gutter only eats width. Hide the bars across
 * the assembled app (both the standard and the WebKit face).
 */
html[data-dshm] * {
  scrollbar-width: none;
}

html[data-dshm] *::-webkit-scrollbar {
  width: 0;
  height: 0;
}

@media (prefers-reduced-motion: reduce) {
  html[data-dshm] [data-dshm-sidebar],
  html[data-dshm] [data-composer-card],
  html[data-dshm] [data-composer-card] > :last-child,
  html[data-dshm] [data-composer-card] > :last-child button,
  html[data-dshm] [data-dshm-primary],
  .dshm-fab {
    transition: none;
  }
}
`

    /**
     * Whether one user agent identifies a phone platform.
     * @param {string} userAgent - navigator.userAgent.
     * @returns {boolean} true for iOS, Android, and HarmonyOS families.
     */
    function isMobilePlatform(userAgent) {
      return MOBILE_PLATFORM.test(String(userAgent))
    }

    /**
     * The frame's own column template with its left track zeroed.
     * @param {string} inline - the frame's inline grid-template-columns.
     * @returns {string} a three-track template that reserves nothing on the left.
     */
    function overlayColumns(inline) {
      const value = String(inline === undefined || inline === null ? '' : inline)
      return /^\s*[\d.]+px/.test(value) ? value.replace(/^\s*[\d.]+px/, '0px') : '0px minmax(0, 1fr) 0px'
    }

    /** Drawer chrome: the frame handle while closed, the scrim while open. */
    function SidebarChrome({ useShell, toggleSidebar, requestRefresh, useSessions, usePanelInfo, t }) {
      // Mounting means the shell has rendered: let the adapter attach now
      // instead of waiting for its watchdog.
      useEffect(() => { requestRefresh() }, [])
      const mobile = useShell(snapshot => snapshot.mobile)
      const drawer = useShell(snapshot => snapshot.drawer)
      const currentSession = useSessions(snapshot => snapshot.current)
      const activePanel = usePanelInfo(info => info.activePanelId)
      // Choosing a destination dismisses the drawer: the picked session or
      // global panel is what the frame should show, not content under the scrim.
      const dismiss = useRef({ drawer, toggleSidebar })
      dismiss.current = { drawer, toggleSidebar }
      const destination = String(activePanel) + '\u0000' + String(currentSession)
      const lastDestination = useRef(destination)
      useEffect(() => {
        if (lastDestination.current === destination) return
        lastDestination.current = destination
        const current = dismiss.current
        if (current.drawer) current.toggleSidebar()
      }, [destination])
      if (!mobile) return null
      if (drawer) {
        return h('button', {
          type: 'button',
          className: 'dshm-scrim',
          'data-dshm-scrim': '',
          'aria-label': t('sidebar.close'),
          onClick: () => { toggleSidebar() },
        })
      }
      const Icon = primitives.IconPanelLeftOutline16
      return h('button', {
        type: 'button',
        className: 'dshm-handle',
        'data-dshm-handle': '',
        'aria-label': t('sidebar.open'),
        onClick: () => { toggleSidebar() },
      }, Icon === undefined ? null : h(Icon, { size: 16 }))
    }

    /**
     * Settings → General row: the same preference-row metrics the official rows use,
     * with a picker pill that opens 启用 / 停用.
     */
    function SettingsRow({ useShell, setEnabled, t }) {
      const enabled = useShell(snapshot => snapshot.enabled)
      const [open, setOpen] = useState(false)
      const items = [
        { id: 'on', label: t('settings.enable') },
        { id: 'off', label: t('settings.disable') },
      ]
      return h('div', { className: 'dshm-set-row' }, [
        h('div', { className: 'dshm-set-text', key: 'text' }, [
          h('div', { className: 'dshm-set-title', key: 'title' }, t('settings.title')),
          h('div', { className: 'dshm-set-desc', key: 'desc' }, t('settings.description')),
        ]),
        primitives.Menu === undefined ? null : h(primitives.Menu, {
          key: 'menu',
          open,
          onClose: () => { setOpen(false) },
          items,
          selectedId: enabled ? 'on' : 'off',
          onSelect: (id) => {
            setOpen(false)
            setEnabled(id === 'on')
          },
          align: 'end',
          portal: true,
          anchor: h('button', {
            type: 'button',
            className: 'dshm-set-selector',
            'aria-label': t('settings.action'),
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => { setOpen(value => !value) },
          }, [
            h('span', { key: 'label' }, t(enabled ? 'settings.enable' : 'settings.disable')),
            primitives.IconChevronDownOutline14 === undefined
              ? null
              : h(primitives.IconChevronDownOutline14, { key: 'chevron', className: 'dshm-set-chevron' }),
          ]),
        }),
      ])
    }

    /** The composer's floating button: expand when collapsed, collapse when open. */
    function ComposerFab({ useShell, setComposer, t }) {
      const mobile = useShell(snapshot => snapshot.mobile)
      const active = useShell(snapshot => snapshot.active)
      const collapsed = useShell(snapshot => snapshot.composer === 'collapsed')
      const drawer = useShell(snapshot => snapshot.drawer)
      if (!mobile || !active || drawer) return null
      // One glyph family in both states: the arrow points the way the tap moves
      // the composer, so the control reads as the same thing either way.
      const Icon = collapsed ? primitives.IconChevronUpOutline14 : primitives.IconChevronDownOutline14
      return h('button', {
        type: 'button',
        className: 'dshm-fab',
        'data-dshm-fab': '',
        'aria-label': t(collapsed ? 'composer.expand' : 'composer.collapse'),
        onClick: () => { setComposer(collapsed ? 'expanded' : 'collapsed') },
      }, Icon === undefined ? null : h(Icon, { size: 16 }))
    }

    /**
     * Mark the composer's primary circles (send, and stop while it exists) so
     * the stylesheet can keep them pinned to the card while the tool rail takes
     * everything else. A circle at least as wide as the send control is primary;
     * the attach circle, the chips, and the context meter are smaller.
     */
    function markPrimaryControls() {
      const row = seam('card')
      const controls = row === null ? null : row.lastElementChild
      if (controls === null || controls === undefined) return
      const buttons = [...controls.querySelectorAll('button')]
      const last = buttons[buttons.length - 1]
      let order = 0
      for (const button of buttons) {
        const rect = button.getBoundingClientRect()
        // A hidden composer measures zero: keep whatever the marks already are.
        if (rect.width === 0) continue
        const radius = Number.parseFloat(getComputedStyle(button).borderTopLeftRadius)
        // A circle, not a chip: the send and stop circles are square boxes,
        // while the icon-only chips stay wider than they are tall.
        const circle = Math.abs(rect.width - rect.height) <= 2 && Number.isFinite(radius) && radius >= rect.width / 2 - 1
        // The composer's primary action is always the row's last control, which
        // also covers a stop circle that appears beside it mid-run.
        if (button === last || (circle && rect.width >= 30)) {
          button.setAttribute('data-dshm-primary', '')
          continue
        }
        button.removeAttribute('data-dshm-primary')
        // Rail order top-to-bottom, so the stylesheet can cascade them in and
        // out one after another instead of all at once.
        button.style.setProperty('--dshm-i', String(order))
        order += 1
      }
    }

    /**
     * Give every rail-anchored picker the same inset from the frame's right edge
     * (the official anchors land flush with the 36px trigger column, whose hard
     * edge reads as clipped, and a panel wider than the column would otherwise
     * overflow the viewport entirely).
     *
     * The shift rides `translate`, which composes with whatever transform the
     * official popup animation sets, and is computed from the UNSHIFTED box so a
     * placed panel never feeds its own offset back into the next measurement.
     * @param {Element|null} controls - the rail's control row.
     */
    function placeRailPopups(controls) {
      const edge = window.innerWidth - 8
      for (const popup of document.querySelectorAll("[role='menu'], [role='dialog'], [role='listbox']")) {
        const rect = popup.getBoundingClientRect()
        // Hidden or not-yet-measurable: drop any stale placement and revisit on
        // the next refresh (the caller schedules one for the opening frame).
        const anchored = controls !== null && (controls.contains(popup) || rect.right > window.innerWidth - 40)
        if (rect.width === 0 || rect.height === 0 || !anchored) {
          popup.removeAttribute('data-dshm-shift')
          popup.style.removeProperty('--dshm-shift')
          continue
        }
        const applied = Number.parseFloat(popup.style.getPropertyValue('--dshm-shift')) || 0
        const shift = Math.round(rect.right + applied - edge)
        if (shift === 0) {
          popup.removeAttribute('data-dshm-shift')
          popup.style.removeProperty('--dshm-shift')
          continue
        }
        popup.style.setProperty('--dshm-shift', shift + 'px')
        popup.setAttribute('data-dshm-shift', '')
      }
    }

    /**
     * Put the view switch into the header's more-actions menu as its first row.
     *
     * The tab row it replaces is hidden on phones. The injected row clones an
     * official menu item so it keeps the menu's own styling, takes its label from
     * the tab it switches to (so it stays localized), and presses that tab — the
     * hidden official button — so the view state stays the app's, not the
     * plugin's. The menu then closes exactly as it does for its own items.
     */
    function augmentHeaderMenu() {
      // Only the header's own more-actions menu: every picker in the app renders a
      // [role='menu'] too, and the permission picker's would otherwise get the view
      // switch injected into it. Its trigger reports the open state.
      const moreButton = seam('headerMenuButtonOpen')
      if (moreButton === null) return
      const menu = document.querySelector("[role='menu']")
      if (menu === null || menu.hasAttribute('data-dshm-view-menu')) return
      const tabs = [...document.querySelectorAll("[role='tablist'] [role='tab']")]
      if (tabs.length < 2) return
      const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]
      const target = tabs.find(tab => tab !== active)
      const template = menu.querySelector("[role='menuitem']")
      if (target === undefined || template === null) return
      const item = template.cloneNode(true)
      item.removeAttribute('style')
      item.removeAttribute('data-dshm-primary')
      const icon = item.querySelector("[class*='itemIcon']")
      if (icon !== null) icon.remove()
      const label = item.querySelector("[class*='itemLabel']")
      if (label !== null) label.textContent = (target.textContent ?? '').trim()
      item.addEventListener('click', (event) => {
        event.preventDefault()
        target.click()
        document.querySelector("button[aria-haspopup='menu'][aria-expanded='true']")?.click()
      })
      item.setAttribute('data-dshm-view-item', '')
      template.before(item)
      menu.setAttribute('data-dshm-view-menu', '')
    }

    /**
     * Keep the frame's phone presentation in step with the live DOM.
     * @param {object} store - this plugin's snapshot store.
     * @returns {{ refresh: () => void, dispose: () => void }} the re-attach entry
     *   and the teardown removing every observation and attribute.
     */
    function createAdapter(store) {
      let frame = null
      let conversationRoot = null
      let frameResize = null
      let frameAttributes = null
      let phaseAttributes = null
      let bodyChildren = null
      let controlsRoot = null
      let controlsObservers = []
      let controlsGuard = null
      let placementFrame = null
      let placementTimer = null

      /**
       * A picker measures itself while it mounts, so one read can catch a panel
       * that has not been placed yet: re-read on the next frame and once after
       * the open transition.
       */
      const schedulePlacement = () => {
        if (placementFrame === null) {
          placementFrame = window.requestAnimationFrame(() => {
            placementFrame = null
            placeRailPopups(controlsRoot)
          })
        }
        if (placementTimer === null) {
          placementTimer = window.setTimeout(() => {
            placementTimer = null
            placeRailPopups(controlsRoot)
          }, 180)
        }
      }

      /**
       * Keep the primary-control marks current. The composer's row gains and
       * loses children at runtime (the stop circle while a continuable child
       * runs, slot entries), so the marking is re-read from child-list changes
       * on the row and its own groups — never from subtree changes, which the
       * streaming context meter would fire continuously.
       */
      const syncControls = () => {
        const card = seam('card')
        const controls = card === null ? null : card.lastElementChild
        // Hold the composer stack clear of the rail column: measured from the
        // rail's left edge each refresh, because the stack's own side clearance
        // moves with the frame (scrollbar gone, width changes, docks added).
        const expanded = document.documentElement.getAttribute('data-dshm-composer') === 'expanded'
        const seat = seam('seat')
        const cardForInset = seam('card')
        // Only while the rail stands: collapsed, the row falls back to the
        // official in-flow layout and would measure the card's left edge.
        if (expanded && frame !== null && seat !== null && cardForInset !== null && controlsRoot !== null) {
          const seatRect = seat.getBoundingClientRect()
          const cardRect = cardForInset.getBoundingClientRect()
          const railLeft = controlsRoot.getBoundingClientRect().left
          if (cardRect.height > 0 && railLeft > window.innerWidth * 0.6) {
            const current = Number.parseFloat(getComputedStyle(seat).paddingRight) || 0
            const base = seatRect.right - cardRect.right - current
            const wanted = seatRect.right - (railLeft - 8) - base
            setVar('--dshm-rail-inset', Math.max(0, Math.round(wanted)) + 'px')
          }
        }
        // The collapse toggle and the send button are one row of controls: the
        // toggle takes the send button's centre line while expanded, measured from
        // the send's own box so wider frames (tablets) and taller cards stay level.
        // Collapsed there is no send button, so the toggle keeps its own seat.
        const sendPrimary = document.querySelector('[data-dshm-primary]')
        const fabButton = document.querySelector('[data-dshm-fab]')
        const animatingNow = document.documentElement.hasAttribute('data-dshm-animating')
        if (expanded && !animatingNow && sendPrimary !== null && fabButton !== null) {
          const sendRect = sendPrimary.getBoundingClientRect()
          const fabRect = fabButton.getBoundingClientRect()
          if (sendRect.height > 0 && fabRect.height > 0) {
            const centre = (sendRect.top + sendRect.bottom) / 2
            setVar('--dshm-fab-bottom', Math.round(window.innerHeight - centre - fabRect.height / 2) + 'px')
          }
        } else {
          clearVar('--dshm-fab-bottom')
        }
        // The official "back to bottom" control is right-aligned into the column
        // the rail occupies. Put it in the send button's column instead (the
        // collapse toggle's while collapsed), measured from the slot so the
        // applied translation never feeds back into the next measurement.
        const toBottomSlot = seam('toBottomSlot')
        const toBottomButton = toBottomSlot === null ? null : toBottomSlot.querySelector('button')
        if (toBottomSlot !== null && toBottomButton !== null) {
          toBottomButton.setAttribute('data-dshm-to-bottom', '')
          // Expanded it shares the send button's centre line; collapsed the send
          // button is gone, so it lines up with the collapse toggle instead.
          const collapsed = document.documentElement.getAttribute('data-dshm-composer') === 'collapsed'
          const reference = (collapsed
            ? document.querySelector('[data-dshm-fab]') ?? document.querySelector('[data-dshm-primary]')
            : document.querySelector('[data-dshm-primary]') ?? document.querySelector('[data-dshm-fab]'))
          if (reference !== null && frame !== null) {
            const slotRight = toBottomSlot.getBoundingClientRect().right
            const half = toBottomButton.getBoundingClientRect().width / 2
            const referenceRect = reference.getBoundingClientRect()
            const shift = slotRight - half - (referenceRect.left + referenceRect.width / 2)
            setVar('--dshm-to-bottom-shift', Math.round(shift) + 'px')
          }
        }
        const cardForInert = seam('card')
        if (cardForInert !== null) {
          const collapsed = document.documentElement.getAttribute('data-dshm-composer') === 'collapsed'
          if (collapsed) cardForInert.setAttribute('inert', '')
          else cardForInert.removeAttribute('inert')
        }
        if (controls !== controlsRoot) {
          for (const observer of controlsObservers) observer.disconnect()
          controlsObservers = []
          if (controlsRoot !== null && controlsGuard !== null) controlsRoot.removeEventListener('mousedown', controlsGuard, true)
          controlsRoot = controls
          controlsGuard = null
          if (controls !== null && controls !== undefined) {
            // The official controls call preventDefault + editor.focus() on
            // mousedown to keep typing seamless. In the rail that focus raises
            // the phone keyboard and pushes the picker off screen, so the rail
            // swallows mousedown before React's delegated listener sees it.
            // Click, pointer, and touch events pass through unchanged.
            controlsGuard = (event) => {
              if (event.target instanceof Element && event.target.closest('button') !== null) event.stopPropagation()
            }
            controls.addEventListener('mousedown', controlsGuard, true)
            const relocate = () => { markPrimaryControls(); placeRailPopups(controls); schedulePlacement() }
            for (const target of [controls, ...controls.children]) {
              const observer = new MutationObserver(relocate)
              observer.observe(target, { childList: true, subtree: target === controls })
              controlsObservers.push(observer)
            }
          }
        }
        markPrimaryControls()
        placeRailPopups(controls)
      }

      const tag = (element, name) => {
        if (element !== null && element !== undefined && !element.hasAttribute(name)) element.setAttribute(name, '')
      }

      const attach = () => {
        const layer = seam('shellOverlay')
        const nextFrame = layer === null ? null : layer.parentElement
        if (nextFrame !== frame) {
          frame = nextFrame
          // A fresh frame element carries none of the variables this adapter writes.
          writtenVars.clear()
          if (frameResize !== null) { frameResize.disconnect(); frameResize = null }
          if (frameAttributes !== null) { frameAttributes.disconnect(); frameAttributes = null }
          if (frame !== null) {
            tag(frame, 'data-dshm-frame')
            tag(frame.children[0], 'data-dshm-sidebar')
            tag(frame.children[1], 'data-dshm-center')
            tag(frame.children[2], 'data-dshm-right')
            if (typeof ResizeObserver === 'function') {
              frameResize = new ResizeObserver(() => { refresh() })
              frameResize.observe(frame)
            }
            frameAttributes = new MutationObserver(() => { refresh() })
            frameAttributes.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'] })
          }
        }
        const nextRoot = seam('phaseRoot')
        if (nextRoot !== conversationRoot) {
          conversationRoot = nextRoot
          if (phaseAttributes !== null) { phaseAttributes.disconnect(); phaseAttributes = null }
          if (conversationRoot !== null) {
            phaseAttributes = new MutationObserver(() => { refresh() })
            phaseAttributes.observe(conversationRoot, { attributes: true, attributeFilter: ['data-phase'] })
          }
        }
      }

      const publish = (mobile, active) => {
        const html = document.documentElement
        if (mobile) {
          html.setAttribute('data-dshm', '')
          if (active) html.setAttribute('data-dshm-composer', store.getSnapshot().composer)
          else html.removeAttribute('data-dshm-composer')
        } else {
          html.removeAttribute('data-dshm')
          html.removeAttribute('data-dshm-composer')
        }
      }

      const writtenVars = new Map()
      const setVar = (name, value) => {
        if (writtenVars.get(name) === value) return
        writtenVars.set(name, value)
        if (frame !== null) frame.style.setProperty(name, value)
      }
      const clearVar = (name) => {
        if (writtenVars.get(name) === '') return
        writtenVars.set(name, '')
        if (frame !== null) frame.style.removeProperty(name)
      }

      let seamsReported = false
      const refresh = () => {
        attach()
        const previous = store.getSnapshot()
        let mobile = false
        let drawer = false
        if (frame !== null) {
          const width = frame.getBoundingClientRect().width
          mobile = width > 0 && width < NARROW_MAX && isMobilePlatform(navigator.userAgent)
          // The Settings switch turns every override off: no frame variables, no
          // drawer, no composer chrome — the official layout returns live.
          mobile = mobile && previous.enabled
          if (mobile) {
            if (!seamsReported && seam('chatFlow') !== null) {
              seamsReported = true
              reportMissingSeams()
            }
            setVar('--dshm-columns', overlayColumns(frame.style.gridTemplateColumns))
            drawer = !frame.hasAttribute('data-sidebar-collapsed')
            const card = seam('card')
            // Skip the card while it animates (its box changes every frame, and the
            // measurement would force a fresh layout per frame), and keep the last
            // real insets while it is hidden (a collapsed card measures zero).
            const animating = document.documentElement.hasAttribute('data-dshm-animating')
            if (!animating && card !== null && card.getBoundingClientRect().height > 0) {
              const rect = card.getBoundingClientRect()
              setVar('--dshm-card-right', Math.max(0, Math.round(window.innerWidth - rect.right)) + 'px')
              setVar('--dshm-card-bottom', Math.max(0, Math.round(window.innerHeight - rect.bottom)) + 'px')
              setVar('--dshm-card-height', Math.round(rect.height) + 'px')
            } else if (!animating) {
              // Collapsed the card measures zero, so its resting bottom comes from an
              // anchor that is on screen in both states: the permanent stats row shares
              // the composer card's bottom edge exactly (measured 30px on the phone
              // frame), and unlike a cached measurement it is right on the first paint
              // of a conversation that opens already collapsed — the landing hero hands
              // over stale insets, which is why the toggle used to land off-seat until
              // an expand taught it the real one.
              const statsElement = seam('statsRow')
              const seatElement = seam('seat')
              const cardHeight = Number.parseFloat(String(writtenVars.get('--dshm-card-height') ?? ''))
              let derived = null
              if (statsElement !== null) {
                const statsRect = statsElement.getBoundingClientRect()
                if (statsRect.height > 0) derived = Math.round(window.innerHeight - statsRect.top)
              }
              if (derived === null && seatElement !== null && Number.isFinite(cardHeight) && cardHeight > 0) {
                const seatRect = seatElement.getBoundingClientRect()
                if (seatRect.height > 0) derived = Math.round(window.innerHeight - (seatRect.top + cardHeight))
              }
              // The composer rests in the bottom band; a much larger value means the
              // anchor is somewhere else entirely (the landing hero), where the CSS
              // fallback is the safer answer.
              if (derived !== null && derived >= 0 && derived < 240) setVar('--dshm-card-bottom', derived + 'px')
            }
          } else {
            clearVar('--dshm-columns')
            clearVar('--dshm-dock-h')
            document.querySelector('[data-composer-card][inert]')?.removeAttribute('inert')
          }
        }
        const active = conversationRoot !== null && conversationRoot.getAttribute('data-phase') === 'active'
        publish(mobile, active)
        // The task list card's header row is the height the collapsed toggle
        // matches; measured, so it follows the official control's own padding.
        if (mobile && frame !== null && !document.documentElement.hasAttribute('data-dshm-animating')) {
          const dockPanel = seam('todoPanel')
          // Its expanded list would be far taller than a control: clamp keeps the
          // match to the collapsed card and falls back otherwise.
          const height = dockPanel === null ? 0 : Math.round(dockPanel.getBoundingClientRect().height)
          if (height >= 28 && height <= 44) setVar('--dshm-dock-h', height + 'px')
          // Too tall means the list is expanded, and no panel means there is no
          // task card at all: keep the last measured band rather than drifting.
        }
        // Keep the drawer handle level with the header's own right-sidebar button:
        // both are 28px controls, and the header's padding decides their band.
        const cornerButton = seam('rightSidebarButton')
        const handleButton = document.querySelector('[data-dshm-handle]')
        if (mobile && frame !== null && cornerButton !== null && handleButton !== null) {
          const cornerRect = cornerButton.getBoundingClientRect()
          if (cornerRect.height > 0) setVar('--dshm-handle-top', Math.round(cornerRect.top) + 'px')
        }
        // Centre the permanent stats row on the frame. It is measured against the
        // unshifted box, so the applied shift never feeds back into the next pass.
        const statsBar = seam('statsRow')
        if (mobile && frame !== null && statsBar !== null) {
          const barRect = statsBar.getBoundingClientRect()
          const frameRect = frame.getBoundingClientRect()
          const applied = Number.parseFloat(frame.style.getPropertyValue('--dshm-stats-shift')) || 0
          if (barRect.width > 0) {
            const naturalCenter = (barRect.left + barRect.right) / 2 - applied
            const shift = Math.round((frameRect.left + frameRect.right) / 2 - naturalCenter)
            if (shift !== 0) setVar('--dshm-stats-shift', shift + 'px')
            else clearVar('--dshm-stats-shift')
          }
        }
        // The conversation header keeps its official height after the tab row is
        // hidden; size it from what is left so the reclaimed line is real.
        if (mobile && frame !== null) {
          const header = document.querySelector('[data-phase] header')
          const titleRow = header === null ? null : header.firstElementChild
          if (titleRow !== null) {
            const titleRect = titleRow.getBoundingClientRect()
            const headerStyle = getComputedStyle(header)
            const height = Math.round(titleRect.height + (Number.parseFloat(headerStyle.paddingTop) || 0) + (Number.parseFloat(headerStyle.paddingBottom) || 0))
            if (height >= 28 && height <= 80) setVar('--dshm-header-h', height + 'px')
          }
        }
        // After publish: the controls' inert state follows the composer mode the
        // attribute now carries, not the one from before this refresh.
        if (mobile) syncControls()
        if (mobile) augmentHeaderMenu()
        if (previous.mobile !== mobile || previous.drawer !== drawer || previous.active !== active) {
          store.set({ ...previous, mobile, drawer, active })
        }
      }

      const unsubscribe = store.subscribe(() => { refresh() })
      bodyChildren = new MutationObserver(() => { refresh() })
      bodyChildren.observe(document.body, { childList: true, subtree: true })
      // The shell renders inside its own root element, so a boot that happens
      // after this plugin loads produces no body child change to observe: one
      // cheap watchdog re-attaches until the frame exists and stays connected.
      const watchdog = window.setInterval(() => {
        if (frame === null || !frame.isConnected || conversationRoot === null) refresh()
      }, 1000)
      refresh()

      const dispose = () => {
        unsubscribe()
        window.clearInterval(watchdog)
        if (frameResize !== null) frameResize.disconnect()
        if (frameAttributes !== null) frameAttributes.disconnect()
        if (phaseAttributes !== null) phaseAttributes.disconnect()
        if (bodyChildren !== null) bodyChildren.disconnect()
        for (const observer of controlsObservers) observer.disconnect()
        if (controlsRoot !== null && controlsGuard !== null) controlsRoot.removeEventListener('mousedown', controlsGuard, true)
        if (placementFrame !== null) window.cancelAnimationFrame(placementFrame)
        if (placementTimer !== null) window.clearTimeout(placementTimer)
        const html = document.documentElement
        html.removeAttribute('data-dshm')
        html.removeAttribute('data-dshm-composer')
        if (frame !== null) {
          frame.style.removeProperty('--dshm-columns')
          frame.style.removeProperty('--dshm-card-right')
          frame.style.removeProperty('--dshm-card-bottom')
          for (const element of [frame, frame.children[0], frame.children[1], frame.children[2]]) {
            if (element === null || element === undefined) continue
            element.removeAttribute('data-dshm-frame')
            element.removeAttribute('data-dshm-sidebar')
            element.removeAttribute('data-dshm-center')
            element.removeAttribute('data-dshm-right')
          }
        }
      }

      return { refresh, dispose }
    }

    /** Services this plugin's apply world reaches for. */
    const inject = ['slots', 'locale', 'layout']

    /**
     * Register the phone presentation: dictionaries, stylesheet, DOM adapter,
     * and the two frame-anchored controls.
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      const store = createSnapshotStore({ mobile: false, drawer: false, active: false, composer: 'collapsed', enabled: readEnabled() })
      // The card's own height drives the collapse/expand easing: its natural
      // height is not a CSS constant (one line, a pasted block, an attachment
      // rail), so the from/to values are measured here.
      let lastCardHeight = 0
      let pendingSettle = null
      let refreshAdapter = () => {}
      const requestRefresh = () => { refreshAdapter() }
      // A height animation re-lays-out and repaints the transcript area on every
      // frame, so its cost scales with how much a session has rendered. Past this
      // size the card's box changes in one step and only the compositor-friendly
      // fade and slide animate: same gesture, no per-frame reflow.
      const ANIMATED_NODES_MAX = 600
      const transcriptWeight = () => {
        const flow = seam('chatFlow')
        return flow === null ? 0 : flow.querySelectorAll('*').length
      }
      const animateCard = (collapse, mutate) => {
        const card = seam('card')
        const heavy = transcriptWeight() > ANIMATED_NODES_MAX
        if (card === null || heavy || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          mutate()
          return
        }
        if (pendingSettle !== null) {
          card.removeEventListener('transitionend', pendingSettle)
          pendingSettle = null
        }
        const from = Math.round(card.getBoundingClientRect().height)
        if (collapse && from > 0) lastCardHeight = from
        // Marks the layout as in motion for the adapter: it must not re-measure
        // the task card until the composer has come to rest.
        document.documentElement.setAttribute('data-dshm-animating', '')
        card.style.transition = 'none'
        card.style.overflow = 'hidden'
        card.style.maxHeight = collapse ? from + 'px' : '0px'
        void card.offsetHeight
        card.style.transition = ''
        mutate()
        card.style.maxHeight = collapse ? '0px' : Math.max(lastCardHeight, 52) + 'px'
        const settle = (event) => {
          if (event.propertyName !== 'max-height') return
          card.removeEventListener('transitionend', settle)
          if (pendingSettle === settle) pendingSettle = null
          card.style.removeProperty('max-height')
          card.style.removeProperty('overflow')
          // The layout has come to rest: take the dock metrics once, here, so a
          // collapse never makes the toggle chase the moving task card.
          document.documentElement.removeAttribute('data-dshm-animating')
          requestRefresh()
        }
        pendingSettle = settle
        card.addEventListener('transitionend', settle)
      }
      const setComposer = (value) => {
        const collapse = value === 'collapsed'
        animateCard(collapse, () => { store.set({ ...store.getSnapshot(), composer: value }) })
      }
      const toggleSidebar = () => { ctx.layout.toggleSidebar() }

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mobile-ui: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-mobile-ui', '')
        style.textContent = CSS
        document.head.append(style)
        return () => { style.remove() }
      }, 'mobile-ui: stylesheet')
      ctx.effect(() => {
        const adapter = createAdapter(store)
        refreshAdapter = adapter.refresh
        return () => {
          refreshAdapter = () => {}
          adapter.dispose()
        }
      }, 'mobile-ui: frame adapter')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'mobile.sidebar',
        order: 0,
        locale: NS,
        inject: () => ({ toggleSidebar, requestRefresh, hooks: { shell: store } }),
      }, SidebarChrome))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'mobile.composer',
        order: 10,
        locale: NS,
        inject: () => ({ setComposer, hooks: { shell: store } }),
      }, ComposerFab))

      const setEnabled = (value) => {
        const current = store.getSnapshot()
        if (value === current.enabled) return
        writeEnabled(value)
        // Disabling must not leave the official sidebar collapsed: the drawer
        // collapsed it, so expand it again before the presentation goes away.
        const frameElement = seam('frame')
        if (!value && frameElement !== null && frameElement.hasAttribute('data-sidebar-collapsed')) toggleSidebar()
        store.set({ ...current, enabled: value })
      }

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'mobile-ui',
        order: 40,
        locale: NS,
        inject: () => ({ hooks: { shell: store }, setEnabled }),
      }, SettingsRow))
    }

    /**
     * Module face consumed by the client module system. The pure helpers ride
     * along for the offline unit test; the loader reads `apply`/`inject` only.
     */
    const module = {
    apply,
    inject,
    __internals: { isMobilePlatform, overlayColumns, CSS, SEAMS, REQUIRED_SEAMS, missingSeams, ENABLED_KEY, readEnabled, writeEnabled },
  }

    return module
  },
})
