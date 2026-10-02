import type { Manifest } from '@/lib/api'
import { setEngineTransport, type EngineTransport } from '@/lib/engineTransport'
import type { PreviewMetadata } from '@/lib/previewBudget'
import { EngineError } from '@/lib/api'
import { msg } from '@/i18n'
import { appendEmbeddedSession, embeddedFileIdFor, registerEmbeddedMaterial, seedEmbeddedSession } from '@/embedded/session'
import { emptyProject } from '@/types/document'
import { newId } from '@/lib/id'
import { useAssetStore } from '@/store/assetStore'
import { useRuntimeAssetStore } from '@/store/runtimeAssetStore'
import { useScriptLibraryStore } from '@/store/scriptLibraryStore'
import { useDocumentStore } from '@/store/documentStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'
import type { PanelInfo } from '@/lib/api'
import type { AppsBridge, ToolCallResult } from './appsBridge'

/**
 * MCP 会话 ↔ Tavotto 前端的既有 store。
 *
 * **真相在服务端**：session_id、manifest、SVG、patch hash 全部来自
 * `tavotto_open_figure` / `tavotto_apply_overrides` 的响应。iframe 里只放
 * 「现在选中了哪个元素、面板摆在哪」这类临时 UI 状态；`localStorage` 与
 * `widgetState` **一个字节的业务数据都不存**——iframe 随时会被 host 重建，
 * 存在那里的东西就是随时会丢的东西。
 */

/** `tavotto_open_figure` 的结构化返回（server.py 的 structuredContent）。 */
export interface OpenFigureResult {
  ok: boolean
  session_id: string
  project: string
  stem: string
  script: string
  cost?: string
  manifest: Manifest
  svg: string | null
  patches?: import('@/types/document').PanelOverride[]
  /** 这一版的预览表示法（ADR 0022）；老 server 不返回它。 */
  preview?: PreviewMetadata
  /** `preview.mode === 'raster'` 时**同一次响应**里带回的受控尺寸位图。 */
  preview_png_base64?: string
  patch_hash: string
  render_revision?: number
  warnings?: string[]
  registry?: { parameterizable?: boolean | null; conflicts?: string[]; stems?: string[] }
  profile: { profile_id: string; profile_version: string; label?: string }
  preflight?: PreflightPayload
  /** Host-created project with no source/package yet.  This uses Tavotto's
   * native empty document model and intentionally has no engine session. */
  blank?: boolean
  assets?: BlankAssetPayload[]
}

export interface BlankAssetPayload {
  id: string
  name: string
  relativePath?: string
  mime?: string
  size?: number
  previewDataUrl?: string | null
}

export interface ImportedMaterialPayload extends BlankAssetPayload {
  sourceStem?: string | null
  sourceScript?: string | null
}

export interface PreflightIssuePayload {
  id: string
  severity: 'error' | 'warn' | 'not_verifiable' | 'suggestion'
  /** Python 侧渲染好的成文——只作没有 message（旧引擎）时的回退 */
  text: string
  /**
   * 可翻译描述符（issue #30）：宿主 webview 按自己的 locale 用
   * `errors:preflight.<key>` 渲染。key/params 与前端求值器逐字对齐
   * （golden vectors 看护）。
   */
  message?: { key: string; params: Record<string, unknown> }
  object_ids: string[]
  gids: string[]
  detail?: Record<string, unknown>
}

export interface PreflightPayload {
  counts: Record<string, number>
  blocking: boolean
  errors: PreflightIssuePayload[]
  warnings: PreflightIssuePayload[]
  not_verifiable: PreflightIssuePayload[]
  suggestions: PreflightIssuePayload[]
}

/** 面板 id ↔ MCP 会话。一个 widget 目前只端一张图，留表是为了以后多图拼版。 */
const sessionOf = new Map<string, string>()
/** Static image assets imported into a blank host project can render directly
 * from the host-provided data URL; they do not need an engine session. */
const staticPreviewOf = new Map<string, string>()

/**
 * raster 档下最近一次渲染带回来的位图（ADR 0022）。
 *
 * **按变体存**，不是「最后一张」：同文件多变体时拿错一张就是「一个面板显示
 * 了另一个面板的图」——HTTP 那条路上正是为了这个才把 `/api/engine/png` 换成
 * 按 patches 出图的 `preview_png`。这里靠「与 manifest 同一次响应」天然配对，
 * 键只是把配对关系记下来。
 *
 * 一个会话只留最近一版：这是画布**此刻**要显示的东西，不是缓存。
 */
const rasterPngOf = new Map<string, { variant: string; url: string }>()

/** 拿到的是不是这一组 patches 自己的位图；不是就宁可没有。 */
function rasterPngFor(sessionId: string, patches: unknown[]): string | null {
  const hit = rasterPngOf.get(sessionId)
  return hit && hit.variant === JSON.stringify(patches) ? hit.url : null
}

function rememberRasterPng(sessionId: string, patches: unknown[], base64: unknown): void {
  // A successful raster render may omit the optional preview bytes when the
  // bridge has already materialized the image elsewhere.  Do not erase the
  // last-known image in that case: entering element edit with the same patches
  // would otherwise turn a visible figure into a blank panel while the hit
  // layer still works.  A different variant still fails closed in rasterPngFor.
  if (typeof base64 !== 'string' || !base64) return
  rasterPngOf.set(sessionId, {
    variant: JSON.stringify(patches),
    // data: URL 而不是 blob:——base64 是从 JSON-RPC 里拿的，转成 blob 只是
    // 多复制一份，还多一条要人记得 revoke 的生命周期。
    url: `data:image/png;base64,${base64}`,
  })
}

export const fileIdFor = embeddedFileIdFor

/** Seed a newly-created host project with Tavotto's own empty document. */
export async function seedBlankSession(open: OpenFigureResult): Promise<{ panelId: null }> {
  await useDocumentStore.getState().switchDocument(emptyProject(), newId('mcp-blank'))
  useRuntimeAssetStore.getState().clear()
  useRuntimeAssetStore.setState({ assets: [], assetsLoading: false, assetsError: null })
  useScriptLibraryStore.getState().clear()
  // No HTTP server exists inside an MCP iframe. An empty project has an empty
  // registry, not an offline registry; do not trigger ScriptLibrary's fetch.
  useScriptLibraryStore.setState({
    view: { source: 'mcp-session', scripts: {}, candidates: [], conflicts: {}, all_scripts: [] },
    loaded: true, loading: false, error: null,
  })

  const panels: PanelInfo[] = (open.assets ?? []).map((asset) => {
    const mime = asset.mime?.toLowerCase() ?? ''
    const kind: PanelInfo['kind'] = mime === 'application/pdf' || mime.includes('svg') ? 'pdf' : 'raster'
    return {
      id: asset.id,
      name: asset.name,
      folder: open.project,
      kind,
      native_w_mm: 100,
      native_h_mm: 75,
      mtime: 0,
      preview_url: asset.previewDataUrl ?? null,
    }
  })
  staticPreviewOf.clear()
  for (const panel of panels) {
    if (panel.preview_url) staticPreviewOf.set(panel.id, panel.preview_url)
  }
  useAssetStore.setState({
    byId: Object.fromEntries(panels.map((panel) => [panel.id, panel])),
    panels,
    figuresDir: open.project,
    loaded: true,
    loading: false,
    error: null,
  })
  useRenderStore.setState({ byKey: {}, tracked: {}, latest: {}, building: {} })
  useUiStore.getState().setElementPanel(null)
  useUiStore.getState().setLeftTab('assets')
  return { panelId: null }
}

export function sessionIdFor(fileId: string): string | null {
  return sessionOf.get(fileId) ?? null
}

/** 工具结果 → 结构化负载；`isError` 一律转成带原因的异常，绝不静默当成成功。 */
export function unwrap(res: ToolCallResult): Record<string, unknown> {
  const body = (res.structuredContent ?? {}) as Record<string, unknown>
  if (res.isError || body.ok === false) {
    const code = typeof body.code === 'string' ? body.code : ''
    const message =
      (typeof body.error === 'string' && body.error) ||
      res.content?.map((c) => c.text).join('\n') ||
      '工具调用失败'
    // traceback / module 要穿透：BridgeError.payload 带着它们，丢掉的话
    // 内嵌画布上 script_error 的本地化包装拿不到诊断末行、ErrorBlock 也
    // 没有可展开的 traceback（HTTP 那条路一直有）
    throw new EngineError(
      message,
      typeof body.traceback === 'string' ? body.traceback : '',
      code,
      typeof body.module === 'string' ? body.module : '',
    )
  }
  return body
}

/**
 * 装一条走 MCP `tools/call` 的引擎传输。
 *
 * 这**不是第二套渲染路径**：`tavotto_apply_overrides` 落到的是同一个
 * `pool.EngineWorker.override`。换掉的只是「消息怎么送过去」——
 * iframe 里没有可连的 HTTP 服务（sidecar 端口是动态的，MCP Apps 的 CSP
 * 也不允许连），所以走 host 的 JSON-RPC。
 */
export function installMcpTransport(bridge: AppsBridge): () => void {
  const transport: EngineTransport = {
    async render(id, patches, opts) {
      const sid = sessionIdFor(id)
      if (!sid) throw new EngineError(`没有这个面板的 MCP 会话: ${id}`, '', 'no_session', '')
      // signal 必须转下去：renderStore 的看门狗（按脚本 cost 分 2/5/15 分钟）
      // 就靠它取消，丢掉的话内嵌画布里一次卡死的渲染永远转下去
      const res = await bridge.callTool(
        'tavotto_apply_overrides',
        {
          session_id: sid,
          patches,
          ...(opts?.previewDpi ? { preview_dpi: opts.previewDpi } : {}),
        },
        undefined,
        opts?.signal,
      )
      const body = unwrap(res)
      // raster 档的位图与 manifest 在**同一次响应**里（bridge `_render`）：
      // 另开一跳去取，取回来的可能已经是另一组 patches 的像素。
      rememberRasterPng(sid, patches, body.preview_png_base64)
      return {
        rev: Number(body.render_revision ?? 0),
        manifest: body.manifest as Manifest,
        svg: (body.svg as string) ?? undefined,
        preview: (body.preview as PreviewMetadata) ?? undefined,
        warnings: (body.warnings as string[]) ?? [],
        timings: (body.timings as Record<string, number>) ?? {},
      }
    },
    // 位图预览：MCP 那侧回 base64，转成 data URL 就是 `<img src>`。
    // 纯矢量的图不会走到这里（显示用 SVG），**raster 档非走不可**——
    // iframe 里没有可连的 HTTP 服务，拿不到位图就是整张图空白。
    async previewPngUrl(id, patches) {
      const sid = sessionIdFor(id)
      const url = sid ? rasterPngFor(sid, patches) : null
      if (url) return url
      throw new EngineError(
        'MCP 画布这一版没有位图预览（矢量图显示走引擎 SVG）', '', 'not_supported', '')
    },
    // iframe 里没有可寻址的 HTTP 资源：回 null，PanelView 退回 SVG 显示。
    panelSrc: (id) => staticPreviewOf.get(id) ?? null,
  }
  return setEngineTransport(transport)
}

/**
 * 把 `tavotto_open_figure` 的结果灌进既有 stores，让画布把它当成一个普通面板。
 *
 * 种子逻辑在 `embedded/session.ts`（浏览器 playground 与这里共用同一份，
 * 不许各自复制然后漂移）；MCP 特有的只有「fileId ↔ session_id」这张表。
 */
export function seedSession(open: OpenFigureResult): { panelId: string; fileId: string } {
  staticPreviewOf.clear()
  sessionOf.set(fileIdFor(open.stem), open.session_id)
  // 打开就是 raster 的图（#181 那一类）：第一帧的位图也在这次响应里。
  // 不记下来的话画布要等到用户改第一个值才有东西可显示。
  // 同一个 session id 重新打开时先丢掉旧图，避免矢量会话继承上一张 raster。
  rasterPngOf.delete(open.session_id)
  rememberRasterPng(open.session_id, open.patches ?? [], open.preview_png_base64)
  return seedEmbeddedSession(
    {
      stem: open.stem,
      project: open.project,
      script: open.script,
      cost: open.cost,
      manifest: open.manifest,
      svg: open.svg,
      overrides: open.patches,
      preview: open.preview,
      renderRevision: open.render_revision,
      warnings: open.warnings,
      previewPngBase64: open.preview_png_base64,
    },
    msg('history.mcpOpenFigure', undefined, 'workspace'),
  )
}

/** Append one complete sibling session returned by the official batch-open path. */
export function appendSession(open: OpenFigureResult): { panelId: string; fileId: string } {
  sessionOf.set(fileIdFor(open.stem), open.session_id)
  rememberRasterPng(open.session_id, open.patches ?? [], open.preview_png_base64)
  return appendEmbeddedSession(
    {
      stem: open.stem,
      project: open.project,
      script: open.script,
      cost: open.cost,
      manifest: open.manifest,
      svg: open.svg,
      preview: open.preview,
      renderRevision: open.render_revision,
      warnings: open.warnings,
      previewPngBase64: open.preview_png_base64,
      overrides: open.patches,
    },
    msg('history.mcpOpenFigure', undefined, 'workspace'),
  )
}

/** Add one host-imported file to the materials store without inserting it on
 * the current page. A managed source is opened only to obtain its real
 * manifest/preview and session id; `registerEmbeddedMaterial` intentionally
 * leaves document objects and selection untouched. */
export async function appendImportedMaterial(
  bridge: AppsBridge,
  project: string,
  imported: ImportedMaterialPayload,
): Promise<void> {
  if (!imported.id) return
  if (imported.sourceStem && project) {
    try {
      const opened = unwrap(await bridge.callTool('tavotto_open_figure', {
        project_path: project,
        stem: imported.sourceStem,
      }))
      if (
        typeof opened.session_id === 'string' &&
        typeof opened.project === 'string' &&
        typeof opened.stem === 'string' &&
        typeof opened.script === 'string' &&
        !!opened.manifest &&
        !!opened.profile
      ) {
        const figure = opened as unknown as OpenFigureResult
        sessionOf.set(fileIdFor(figure.stem), figure.session_id)
        rememberRasterPng(figure.session_id, figure.patches ?? [], figure.preview_png_base64)
        registerEmbeddedMaterial({
          stem: figure.stem,
          project: figure.project,
          script: figure.script,
          cost: figure.cost,
          manifest: figure.manifest,
          svg: figure.svg,
          preview: figure.preview,
          renderRevision: figure.render_revision,
          warnings: figure.warnings,
          previewPngBase64: figure.preview_png_base64,
          overrides: figure.patches,
        })
        return
      }
    } catch (error) {
      console.warn('[tavotto] imported material source unavailable', error)
    }
  }

  const mime = imported.mime?.toLowerCase() ?? ''
  const fileId = imported.id
  const info: PanelInfo = {
    id: fileId,
    name: imported.name,
    folder: project,
    kind: mime === 'application/pdf' || mime.includes('svg') ? 'pdf' : 'raster',
    native_w_mm: 100,
    native_h_mm: 75,
    mtime: 0,
    script: imported.sourceScript || undefined,
    preview_url: imported.previewDataUrl ?? null,
  }
  useAssetStore.setState((s) => ({
    byId: { ...s.byId, [fileId]: info },
    panels: s.panels.some((p) => p.id === fileId) ? s.panels : [...s.panels, info],
    figuresDir: project,
    loaded: true,
    loading: false,
    error: null,
  }))
  if (info.preview_url) staticPreviewOf.set(fileId, info.preview_url)
}
