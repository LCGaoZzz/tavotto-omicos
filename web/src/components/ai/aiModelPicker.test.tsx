/**
 * AI 执行器 / 模型与推理强度弹层。
 *
 * 要钉住的（修改前见
 * `docs/ux/img/ux-consistency-pass/before/zh-1440-ai-popover.png`：
 * 六档等宽按钮在 232px 弹层里两头都被切掉，正常状态还常驻一段快照说明）：
 *   1. 执行器与模型是**一个**紧凑选择器（审计 T37）；选不出第二项时不摆
 *      一个选不动的控件，但那一项写的是什么仍要看得见；
 *   2. 模型清单来自 caps，为空时不伪造模型；
 *   3. 推理强度是**真实能力数组驱动**的离散选项列表，选中的值就是
 *      efforts[i]，绝不生成数组里没有的值；
 *   4. 一档仍显示为可确认的选项；一档都没有时整块不出现；
 *   5. 键盘 Tab / Enter 可达并可调；
 *   6. 正常状态不常驻快照 / CLI / 实现说明（2026-09-11 起弹层里也没有技术详情折叠，
 *      那些内容在设置 → 编码 Agent 的详情页）；
 *   7. 切 Agent 各自保留模型与强度偏好。
 *
 * 合并只是**呈现**：底下仍是 aiStore 的 agent 与 models[agent] 两个字段。
 * 「切到 B 再切回 A，A 的模型还是我上次选的」这条正是那个结构在被检验。
 * 推理强度的选项列表按需展开，**当前档位在收起时就写着**——藏起来的是控件不是值。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AiCapabilities } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { agentCaps, claudeCaps } from '@/components/settings/testCaps'
import { useAiStore } from '@/store/aiStore'
import { useDocumentStore } from '@/store/documentStore'
import { emptyProject, type PanelObject } from '@/types/document'
import { ScopeAgentContent } from './AiPanel'

globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** OmicOS 路由的真实形状：供应商/模型 + 六档强度。 */
const codexSix = agentCaps({
  models: ['Zhipu Coding Plan/glm-5.3', 'Antigravity OAuth/Gemini 3.8 Flash'],
  default_model: 'Zhipu Coding Plan/glm-5.3',
  efforts: ['minimal', 'low', 'medium', 'high', 'max', 'xhigh'],
  default_effort: 'xhigh',
})

const capsOf = (...agents: AiCapabilities['agents']): AiCapabilities =>
  ({ agents, endpoints: [] }) as unknown as AiCapabilities

const panelOf = (): PanelObject =>
  ({
    id: 'p1', type: 'panel', x: 0, y: 0, w: 100, h: 75,
    fileId: 'Fig1.pdf', fileKind: 'pdf', nativeW: 100, nativeH: 75,
    script: '/tmp/figs/fig1_kinetics.py', overrides: [],
  }) as unknown as PanelObject

let root: Root
let host: HTMLDivElement

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <ScopeAgentContent
          panel={panelOf()}
          element={null}
          axes={null}
          scope="figure"
          scopes={['figure']}
        />
      </TooltipProvider>,
    )
  })
}

const textOf = () => host.textContent ?? ''
const buttons = () => Array.from(host.querySelectorAll('button'))
const range = () => host.querySelector('input[type="range"]') as HTMLInputElement | null
const effortOptions = () =>
  Array.from(host.querySelectorAll('[data-ai-effort="options"] [role="option"]')) as HTMLElement[]
const providerTrigger = () => host.querySelector('[data-ai-provider="select"] [role="combobox"]') as HTMLElement | null
const modelTrigger = () => host.querySelector('[data-ai-model="select"] [role="combobox"]') as HTMLElement | null
/** Radix 的选项挂在 body 的 Portal 上，不在 host 里。 */
const selectOptions = async (trigger: HTMLElement): Promise<HTMLElement[]> => {
  await act(async () => {
    trigger.click()
  })
  return [...document.body.querySelectorAll('[role="option"]')] as HTMLElement[]
}
const pickOption = async (trigger: HTMLElement, label: string) => {
  const opts = await selectOptions(trigger)
  const hit = opts.find((o) => o.textContent?.includes(label))
  expect(hit, `选项里没有「${label}」`).toBeTruthy()
  await act(async () => {
    hit!.click()
  })
}
/** 推理强度默认收起：要选档位先展开 */
const openEffort = async () => {
  const btn = buttons().find((b) => b.textContent?.includes('推理强度'))!
  await act(async () => {
    btn.click()
  })
}

beforeEach(async () => {
  localStorage.clear()
  document.body.innerHTML = ''
  await useDocumentStore.getState().switchDocument(emptyProject(), 'd_ai')
  useAiStore.setState({ caps: null, agent: null, models: {}, efforts: {} })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
})

/* ------------------------------- Provider -------------------------------- */

describe('供应商与模型', () => {
  it('按已配置的路由分别显示供应商和模型选择器', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    expect(providerTrigger()).toBeTruthy()
    expect(modelTrigger()).toBeTruthy()
    expect(textOf()).toContain('Zhipu Coding Plan')
    expect(textOf()).toContain('glm-5.3')
  })

  it('切换供应商时写入该供应商的完整 provider/model 路由', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    await pickOption(providerTrigger()!, 'Antigravity OAuth')
    expect(useAiStore.getState().models.codex).toBe('Antigravity OAuth/Gemini 3.8 Flash')
    expect(textOf()).toContain('Gemini 3.8 Flash')
  })

  it('模型选项来自当前供应商，选择后保留完整路由', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    await pickOption(providerTrigger()!, 'Antigravity OAuth')
    await pickOption(modelTrigger()!, 'Gemini 3.8 Flash')
    expect(useAiStore.getState().models.codex).toBe('Antigravity OAuth/Gemini 3.8 Flash')
  })

  it('一个可用的都没有时给恢复入口，不摆一个死掉的选择器', async () => {
    useAiStore.setState({ caps: capsOf(agentCaps({ usable: false, installed: false })) })
    await mount()
    expect(providerTrigger()).toBeNull()
    expect(modelTrigger()).toBeNull()
    expect(effortOptions()).toHaveLength(0)
    expect(buttons().some((b) => b.textContent?.includes('打开 OmicOS 设置'))).toBe(true)
  })

  /**
   * e2e 的三个锚点在这里钉住。
   *
   * `e2e/ux-consistency.spec.ts` 的流程 C 必须按机器上装没装 Agent 分支
   * （CI runner 上可能一个都没有），而**条件分支里的定位是假绿最好的藏身处**：
   * 审计 T37 把执行器从 radiogroup 换成 Select、把推理强度收进折叠区之后，
   * 那条用例按旧 role/文案找到 0 个元素，于是每一条断言都被静默跳过，
   * CI 一路绿（2026-09-07 复核才发现）。所以锚点的存在性由这里的正向用例负责，
   * e2e 那边的 `if` 才是安全的。
   */
  it('三个 e2e 锚点各自出现在它该出现的形态里', async () => {
    // 已配置供应商/模型 → 两个选择器形态
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    expect(document.body.querySelector('[data-ai-provider="select"]')).toBeTruthy()
    expect(document.body.querySelector('[data-ai-model="select"]')).toBeTruthy()
    // 支持推理强度 → 折叠入口在，默认收起
    const disclosure = document.body.querySelector('[data-ai-effort="disclosure"]')
    expect(disclosure).toBeTruthy()
    expect(disclosure!.getAttribute('aria-expanded')).toBe('false')

    // 清单为空 → 两个选择器都不出现
    await act(async () => {
      root?.unmount()
    })
    document.body.innerHTML = ''
    useAiStore.setState({ caps: capsOf(agentCaps({ models: [], default_model: null })) })
    await mount()
    expect(document.body.querySelector('[data-ai-provider="select"]')).toBeNull()
    expect(document.body.querySelector('[data-ai-model="select"]')).toBeNull()

    // 一个可用的都没有 → 两种形态都不出现，只剩恢复入口
    await act(async () => {
      root?.unmount()
    })
    document.body.innerHTML = ''
    useAiStore.setState({ caps: capsOf(agentCaps({ usable: false, installed: false })) })
    await mount()
    expect(document.body.querySelector('[data-ai-agent-model]')).toBeNull()
    expect(document.body.querySelector('[data-ai-open-settings]')).toBeTruthy()
  })

  it('切换供应商后仍保留各自的模型与强度偏好', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    useAiStore.getState().setEffort('codex', 'low')
    await mount()
    // 当前是 codex：展开强度后选项列表勾在 low
    await openEffort()
    expect(effortOptions().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toContain('低')
    await pickOption(providerTrigger()!, 'Antigravity OAuth')
    expect(textOf()).toContain('Gemini 3.8 Flash')
    await pickOption(providerTrigger()!, 'Zhipu Coding Plan')
    expect(effortOptions().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toContain('低')
  })

  it('记忆里的模型已不在清单里时回落到当前供应商的首项', async () => {
    useAiStore.setState({
      caps: capsOf(codexSix),
      models: { codex: '已下架的模型' },
    })
    await mount()
    expect(textOf()).toContain('glm-5.3')
  })
})

/* --------------------------------- 模型 ---------------------------------- */

describe('模型选择', () => {
  it('模型清单来自 caps', async () => {
    useAiStore.setState({ caps: capsOf(claudeCaps()) })
    await mount()
    expect(modelTrigger()).toBeTruthy()
    expect(textOf()).toContain('sonnet')
  })

  it('清单为空 = 跟随 CLI 默认，不伪造一个模型名', async () => {
    useAiStore.setState({
      caps: capsOf(agentCaps({ models: [], default_model: null })),
    })
    await mount()
    expect(providerTrigger()).toBeNull()
    expect(modelTrigger()).toBeNull()
    // 静态那一行也不出现：没有模型名可写，编一个才是错的
    expect(textOf()).not.toContain('执行器与模型')
  })
})

/* ------------------------------- 推理强度 -------------------------------- */

describe('推理强度离散选择器', () => {
  it('选项数 = caps 的真实数组长度', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    await openEffort()
    expect(effortOptions()).toHaveLength(codexSix.efforts.length)
    expect(effortOptions().map((o) => o.getAttribute('data-ai-effort-option'))).toEqual(codexSix.efforts)
  })

  it('选择第 i 项写的就是 efforts[i]，不生成数组里没有的值', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    const list = codexSix.efforts
    for (const [i, expected] of list.entries()) {
      await openEffort()
      await act(async () => {
        effortOptions()[i].click()
      })
      expect(useAiStore.getState().efforts.codex).toBe(expected)
      expect(list).toContain(useAiStore.getState().efforts.codex)
    }
  })

  it('收起时当前档位就写着；展开后选项勾选与它一致（审计 T37）', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    useAiStore.getState().setEffort('codex', 'high')
    await mount()
    // 按需展示的是**控件**，不是值：没展开也读得出现在是哪一档
    expect(effortOptions()).toHaveLength(0)
    expect(textOf()).toContain('推理强度')
    expect(textOf()).toContain('高')
    await openEffort()
    const selected = effortOptions().find((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected?.textContent).toContain('高')
  })

  it('CLI 声明了表里没有的档位时回退原文，不显示空白', async () => {
    useAiStore.setState({
      caps: capsOf(agentCaps({ efforts: ['low', 'turbo'], default_effort: 'turbo' })),
    })
    await mount()
    await openEffort()
    expect(effortOptions().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toBe('turbo')
  })

  it('只有一档时仍使用可见的离散选项', async () => {
    useAiStore.setState({
      caps: capsOf(agentCaps({ efforts: ['medium'], default_effort: 'medium' })),
    })
    await mount()
    await openEffort()
    expect(effortOptions()).toHaveLength(1)
    expect(effortOptions()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('没有强度能力时整块不出现', async () => {
    useAiStore.setState({ caps: capsOf(claudeCaps()) })
    await mount()
    expect(effortOptions()).toHaveLength(0)
    expect(textOf()).not.toContain('推理强度')
  })

  it('记忆里的档位已不在清单里时回落到第一格，不越界', async () => {
    useAiStore.setState({ caps: capsOf(codexSix), efforts: { codex: '不存在的档位' } })
    await mount()
    await openEffort()
    expect(effortOptions()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('不用连续 range，离散选项有可达名和选中状态', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    await openEffort()
    expect(range()).toBeNull()
    expect(host.querySelector('[data-ai-effort="options"]')?.getAttribute('role')).toBe('listbox')
    expect(host.querySelector('[data-ai-effort="options"]')?.getAttribute('aria-label')).toBe('推理强度')
    expect(effortOptions().every((o) => o.getAttribute('role') === 'option')).toBe(true)
  })
})

/* ------------------------------- 文案减负 -------------------------------- */

describe('正常状态的文案', () => {
  it('不常驻快照 / CLI 版本 / 路径说明', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    expect(textOf()).not.toContain('自动快照')
    expect(textOf()).not.toContain('codex-cli')
    expect(textOf()).not.toContain('/opt/homebrew')
    expect(textOf()).not.toContain('fig1_kinetics.py')
  })

  /**
   * 2026-09-11 组件工作台批次把弹层里的「技术详情」折叠整个去掉了：快照说明、
   * CLI 包名、解释器路径不再在这个弹层里出现（它们在设置 → 编码 Agent 的详情页）。
   * 守住的仍是第 6 条：正常状态一个字都不常驻。
   */
  it('正常状态不常驻快照 / CLI / 实现说明（弹层里也没有技术详情折叠）', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    await mount()
    expect(textOf()).not.toContain('自动快照')
    expect(textOf()).not.toContain('codex-cli')
    expect(textOf()).not.toContain('/opt/homebrew')
    expect(buttons().find((b) => b.textContent?.trim() === '技术详情')).toBeUndefined()
  })

  it('强度的原始值不出现在弹层里（正常状态给的是当前语言的名字）', async () => {
    useAiStore.setState({ caps: capsOf(codexSix) })
    useAiStore.getState().setEffort('codex', 'xhigh')
    await mount()
    expect(textOf()).toContain('极高')
    expect(textOf()).not.toContain('xhigh')
  })
})
