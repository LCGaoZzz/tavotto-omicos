import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

interface SavedCanvas { canvases: { objects: unknown[] }[] }

// Real MCP widget + browser image decoding; only the persistence host is fake.
const WIDGET = path.resolve(import.meta.dirname, '../../codex-plugin/mcp/widget/canvas.html')
const ORIGIN = 'http://tavotto-material.test'
const HOST = `<!doctype html><html><body style="margin:0">
<iframe data-widget style="width:100vw;height:100vh;border:0" src="/canvas.html"></iframe>
<script>
const frame = document.querySelector('[data-widget]')
const post = (message) => frame.contentWindow.postMessage({jsonrpc:'2.0', ...message}, '*')
const image = document.createElement('canvas')
image.width = window.__SIZE__[0]; image.height = window.__SIZE__[1]
const ctx = image.getContext('2d')
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, image.width, image.height)
ctx.strokeStyle = '#367b9d'; ctx.lineWidth = 8
ctx.beginPath(); ctx.arc(image.width/2, image.height/2, Math.min(image.width,image.height)*0.38, 0, Math.PI*2); ctx.stroke()
window.__ASSET__ = {id:'initial', name:'circle.png', mime:'image/png', previewDataUrl:image.toDataURL('image/png')}
window.__OPEN__ = {ok:true, blank:true, project:'/tmp/aspect', stem:'Aspect', assets:[window.__ASSET__]}
window.__SAVED__ = null
window.addEventListener('message', ({data:m}) => {
  if (!m || m.jsonrpc !== '2.0') return
  if (m.method === 'ui/initialize') {
    post({id:m.id, result:{protocolVersion:m.params.protocolVersion, hostInfo:{name:'test',version:'1'}, hostCapabilities:{}, hostContext:{displayMode:'fullscreen'}}})
  } else if (m.method === 'ui/notifications/initialized') {
    post({method:'ui/notifications/tool-result', params:{structuredContent:window.__OPEN__}})
  } else if (m.method === 'tools/call') {
    if (m.params.name === 'tavotto_save_canvas') window.__SAVED__ = m.params.arguments.state
    post({id:m.id, result:{structuredContent:{ok:true}}})
  } else if (m.id != null) post({id:m.id, result:{}})
})
</script></body></html>`

for (const [name, width, height] of [
  ['square', 800, 800], ['wide', 1600, 800], ['tall', 800, 1600], ['four-three', 800, 600],
] as const) {
  test(`imported ${name} image keeps its aspect on canvas and after reopening`, async ({ page }, testInfo) => {
    const widget = readFileSync(WIDGET, 'utf8')
    await page.addInitScript((size) => { Object.assign(window, { __SIZE__: size }) }, [width, height])
    await page.route(`${ORIGIN}/**`, (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: new URL(route.request().url()).pathname === '/canvas.html' ? widget : HOST,
    }))
    await page.goto(ORIGIN)
    const frame = page.frameLocator('[data-widget]')
    // Exercise the actual add-to-canvas action, both hydrated and live imports.
    await frame.locator('[data-card="initial"]').press('Shift+Enter')
    await page.evaluate(() => {
      const w = window as unknown as { __ASSET__: object }
      const iframe = document.querySelector<HTMLIFrameElement>('[data-widget]')!
      iframe.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
        structuredContent: { _omicosFigureStudioRefresh: { project: '/tmp/aspect', imported: { ...w.__ASSET__, id: 'live' } } },
      } }, '*')
    })
    await frame.locator('[data-card="live"]').press('Shift+Enter')
    const objects = frame.locator('[data-object-id]')
    await expect(objects).toHaveCount(2)
    const measure = () => objects.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      const image = element.querySelector<HTMLImageElement>('img:not([aria-hidden="true"])')!
      const drawn = image?.getBoundingClientRect()
      const rounded = (n: number) => Math.round(n * 1000) / 1000
      return { ratio: rounded(rect.width / rect.height), drawnRatio: drawn ? rounded(drawn.width / drawn.height) : 0,
        naturalRatio: image ? rounded(image.naturalWidth / image.naturalHeight) : 0 }
    }))
    const ratio = Math.round(width / height * 1000) / 1000
    const expected = Array.from({ length: 2 }, () => ({ ratio, drawnRatio: ratio, naturalRatio: ratio }))
    await expect.poll(measure).toEqual(expected)
    await expect.poll(() => page.evaluate(() => {
      const w = window as unknown as { __SAVED__: SavedCanvas | null }
      return w.__SAVED__?.canvases.reduce((n, canvas) => n + canvas.objects.length, 0)
    })).toBe(2)
    await page.evaluate(async () => {
      const w = window as unknown as { __OPEN__: { assets: object[]; canvasState?: SavedCanvas }; __ASSET__: object; __SAVED__: SavedCanvas }
      w.__OPEN__.assets.push({ ...w.__ASSET__, id: 'live' })
      w.__OPEN__.canvasState = w.__SAVED__
      const iframe = document.querySelector<HTMLIFrameElement>('[data-widget]')!
      await new Promise<void>((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true })
        iframe.contentWindow!.location.reload()
      })
    })
    await expect(objects).toHaveCount(2)
    await expect.poll(measure).toEqual(expected)
    await page.screenshot({ path: testInfo.outputPath(`${name}-restored.png`) })
  })
}
