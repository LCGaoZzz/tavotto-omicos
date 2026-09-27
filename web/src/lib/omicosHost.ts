/** Cosmetic host context only. This never authorizes source execution or APIs. */
import { i18n, initI18n } from '@/i18n'

export const HOST_TOKEN_PROPERTIES: Record<string, string> = {
  '--oc-bg': 'color', '--oc-surface': 'color', '--oc-raised': 'color',
  '--oc-overlay': 'color', '--oc-border': 'color', '--oc-border-hi': 'color',
  '--oc-txt': 'color', '--oc-txt-2': 'color', '--oc-txt-3': 'color',
  '--oc-teal': 'color', '--oc-teal-hi': 'color', '--oc-teal-dim': 'color',
  '--oc-guanine': 'color', '--oc-thymine': 'color', '--oc-adenine': 'color',
  '--oc-input-bg': 'color', '--oc-input-border': 'color', '--oc-scroll-thumb': 'color',
  '--oc-font-ui': 'font-family', '--oc-font-mono': 'font-family',
  '--radius-card': 'border-radius', '--radius-input': 'border-radius', '--radius-btn': 'border-radius',
}

export function acceptContext(event: MessageEvent, origin: string, parent: Window): boolean {
  if (event.source !== parent || event.origin !== origin) return false
  const v = event.data
  if (!v || typeof v !== 'object' || v.type !== 'omicos:figure-context' || v.version !== 1) return false
  if (!['light', 'dark'].includes(v.theme) || !['zh-CN', 'en-US'].includes(v.locale)) return false
  if (!v.tokens || typeof v.tokens !== 'object' || Array.isArray(v.tokens)) return false
  const entries = Object.entries(v.tokens)
  if (entries.length > Object.keys(HOST_TOKEN_PROPERTIES).length) return false
  for (const [key, value] of entries) {
    const property = HOST_TOKEN_PROPERTIES[key]
    if (!property || typeof value !== 'string' || value.length > 512 || /[;{}<>\n]|url\s*\(/i.test(value)) return false
    if (!CSS.supports(property, value)) return false
  }
  const root = document.documentElement
  for (const key of Object.keys(HOST_TOKEN_PROPERTIES)) root.style.removeProperty(key)
  for (const [key, value] of entries) root.style.setProperty(key, value as string)
  root.dataset.theme = v.theme
  root.lang = v.locale
  document.title = v.locale === 'zh-CN' ? 'OmicOS 图形工作台' : 'OmicOS Figure Studio'
  initI18n(v.locale)
  return true
}

export function installOmicosHost(): () => void {
  const params = new URLSearchParams(location.search)
  const locale = params.get('lang') === 'en-US' ? 'en-US' : 'zh-CN'
  initI18n(locale)
  document.documentElement.lang = locale
  document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const updateTitle = (lng: string) => {
    document.documentElement.lang = lng
    document.title = lng.startsWith('zh') ? 'OmicOS 图形工作台' : 'OmicOS Figure Studio'
  }
  updateTitle(locale)
  i18n.on('languageChanged', updateTitle)
  let origin: string
  try {
    const url = new URL(params.get('omicosHostOrigin') || location.origin)
    if (!['https:', 'http:', 'tauri:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid host origin')
    origin = url.origin === 'null' && url.protocol === 'tauri:' ? 'tauri://localhost' : url.origin
  } catch { return () => i18n.off('languageChanged', updateTitle) }
  const receive = (event: MessageEvent) => { acceptContext(event, origin, window.parent) }
  window.addEventListener('message', receive)
  if (window.parent !== window) window.parent.postMessage({ type: 'omicos:figure-ready', version: 1 }, origin)
  return () => { window.removeEventListener('message', receive); i18n.off('languageChanged', updateTitle) }
}

/** Tell the OmicOS shell which project the embedded editor now owns. The
 * editor's project switcher is intentionally local to the iframe, so the
 * shell must receive an explicit, origin-scoped notification before routing
 * cross-conversation imports. */
export function notifyOmicosProjectChanged(project: {
  id?: string | null
  name?: string
  figures_dir?: string
}): void {
  if (window.parent === window || !project || typeof project.figures_dir !== 'string' || !project.figures_dir.trim()) return
  const params = new URLSearchParams(location.search)
  let origin: string
  try {
    const url = new URL(params.get('omicosHostOrigin') || location.origin)
    if (!['https:', 'http:', 'tauri:'].includes(url.protocol) || url.username || url.password) return
    origin = url.origin === 'null' && url.protocol === 'tauri:' ? 'tauri://localhost' : url.origin
  } catch { return }
  window.parent.postMessage({
    type: 'omicos:figure-project-changed', version: 1,
    project: { id: typeof project.id === 'string' ? project.id : null, name: typeof project.name === 'string' ? project.name : '', path: project.figures_dir },
  }, origin)
}
