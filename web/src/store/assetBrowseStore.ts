/**
 * 素材库的**浏览状态**：搜索词与筛选条件。
 *
 * 它住在组件外面，是因为 `AssetBrowser` 会被卸载——切到左轨的别的页、
 * 收起抽屉再展开、窄断点让位，每一次都是一次 unmount。放在组件 state 里的
 * 输入就跟着没了：用户刚打了半个文件名、切去看一眼问题面板、回来清单又是
 * 全量的（UI 审计 T06）。
 *
 * 筛选仍只在内存里；素材隐藏状态则按项目落在 localStorage。这样重启不会把
 * 用户明确移除的卡片重新塞回来，同时换项目 `clear()` 会重新读取新项目自己的
 * 隐藏清单，不会串图库。
 */
import { create } from 'zustand'
import { currentProjectId } from '@/lib/session'

export type AssetTypeFilter = 'all' | 'pdf' | 'raster' | 'script' | 'runtime'
export type AssetSortKey = 'name' | 'recent' | 'used'

const HIDDEN_KEY = 'omicos.figure.hiddenAssets'
const projectKey = () => currentProjectId() ?? '__default__'

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    const value = raw ? JSON.parse(raw) : null
    const ids = value?.[projectKey()]
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeHidden(hiddenIds: string[]): void {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    const value = raw ? JSON.parse(raw) : {}
    const next = value && typeof value === 'object' ? { ...value } : {}
    next[projectKey()] = [...new Set(hiddenIds)]
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
  } catch {
    // 本地存储不可用时，仍保持本次会话内的隐藏状态。
  }
}

export interface AssetFilters {
  source: string
  type: AssetTypeFilter
  sort: AssetSortKey
  usedOnly: boolean
}

export const DEFAULT_ASSET_FILTERS: AssetFilters = {
  source: 'all',
  type: 'all',
  sort: 'name',
  usedOnly: false,
}

interface AssetBrowseState {
  query: string
  filters: AssetFilters
  /**
   * 「脚本」区展开着没有。图是这一栏的主区域，脚本是可以收起的第二层
   * （2026-09-13 审计 B07）；默认展开——「运行并发现图」是新项目的第一步，不能
   * 一开始就藏起来。与筛选一样只在内存里，换项目不重置（它不属于某个项目）。
   */
  scriptsOpen: boolean
  /**
   * 「图」区展开着没有。它与「脚本」区是同级的两个分区，用同一副可折叠的区头
   * （2026-09-15 左栏审计 L06：此前一个能收一个不能，两种骨架）；默认展开，图是主区域。
   */
  figuresOpen: boolean
  /** 当前项目素材栏中明确隐藏的素材 id；只影响浏览视图，不删除源文件或画布对象。 */
  hiddenIds: string[]
  setQuery: (query: string) => void
  setFilters: (filters: AssetFilters | ((prev: AssetFilters) => AssetFilters)) => void
  setScriptsOpen: (open: boolean) => void
  setFiguresOpen: (open: boolean) => void
  hideAsset: (id: string) => void
  hideAssets: (ids: string[]) => void
  /** 换项目：搜索词与筛选都属于旧项目 */
  clear: () => void
}

export const useAssetBrowseStore = create<AssetBrowseState>((set) => ({
  query: '',
  filters: DEFAULT_ASSET_FILTERS,
  scriptsOpen: true,
  figuresOpen: true,
  hiddenIds: readHidden(),
  setQuery: (query) => set({ query }),
  setFilters: (filters) =>
    set((s) => ({ filters: typeof filters === 'function' ? filters(s.filters) : filters })),
  setScriptsOpen: (scriptsOpen) => set({ scriptsOpen }),
  setFiguresOpen: (figuresOpen) => set({ figuresOpen }),
  hideAsset: (id) =>
    set((state) => {
      if (state.hiddenIds.includes(id)) return state
      const hiddenIds = [...state.hiddenIds, id]
      writeHidden(hiddenIds)
      return { hiddenIds }
    }),
  hideAssets: (ids) =>
    set((state) => {
      const hiddenIds = [...new Set([...state.hiddenIds, ...ids])]
      writeHidden(hiddenIds)
      return { hiddenIds }
    }),
  clear: () => set({ query: '', filters: DEFAULT_ASSET_FILTERS, hiddenIds: readHidden() }),
}))
