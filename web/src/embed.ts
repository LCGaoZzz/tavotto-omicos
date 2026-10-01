/**
 * Published entry point (`tavotto-omicos-web`).
 *
 * The workbench is a Vite APP, not a library: its sources import through the
 * `@` / `@profiles` / `@glyphcoverage` aliases ~2900 times, and two of those
 * aliases reach OUTSIDE this directory into the Python package (the publication
 * profile and the glyph-coverage table, each of which must have exactly one
 * authoritative copy). Shipping raw sources would make every consumer
 * reproduce that build, so the npm package ships a BUILT bundle and this file
 * is its only public surface.
 *
 * Kept deliberately small — it is the whole contract a host application has to
 * hold on to. `react` and `react-dom` are peers: a second React copy in the
 * host's bundle breaks hooks.
 *
 * The stylesheet is NOT injected; import it once in the host:
 *   import 'tavotto-omicos-web/style.css'
 */
import './index.css'
import './omicos-theme.css'

export { App } from '@/App'
export { currentProjectId, setCurrentProjectId } from '@/lib/session'
export { migrateToProject } from '@/types/document'
export type {
  ObjectBase,
  PanelObject,
  TextObject,
  ArrowObject,
  ShapeObject,
  CanvasObject,
  ProjectDocument,
} from '@/types/document'
