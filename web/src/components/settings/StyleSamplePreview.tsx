import { useTranslation } from 'react-i18next'
import { t as translate } from '@/i18n'
import { sampleFitScale, styleSampleGeometry } from '@/lib/styleSample'

const st = (key: string, values?: Record<string, unknown>) =>
  translate(`profiles.${key}`, { ns: 'dialogs', ...(values ?? {}) })

/**
 * 样式页的示例图（审计 T42）：一张固定的小图，字号 / 线宽 / 边框 / 字体族按
 * 当前样式现算（`lib/styleSample.ts`），编辑字段时同步变。
 *
 * 示例使用 OmicOS 自己的细胞状态分组图，避免把上游教程的动力学曲线当作产品
 * 示例；它仍然覆盖标题、轴标题、刻度、图例、柱形和折线这些可检查的元素。
 */
export function StyleSamplePreview({ data }: { data: Record<string, unknown> | null | undefined }) {
  useTranslation('dialogs')
  const raw = styleSampleGeometry(data)
  // 读屏那句话说的是**样式里的真实数字**，示例图画的是缩过的——缩放是示例自己
  // 的排版手段，不该被读成“这套样式的字号是 14pt”。
  const k = sampleFitScale(raw)
  const g =
    k === 1
      ? raw
      : {
          ...raw,
          titlePt: raw.titlePt * k,
          axisPt: raw.axisPt * k,
          tickPt: raw.tickPt * k,
          legendPt: raw.legendPt * k,
        }
  const label = st('previewAria', {
    title: raw.titlePt,
    axis: raw.axisPt,
    tick: raw.tickPt,
    legend: raw.legendPt,
    line: raw.lineWidthPt,
    spine: raw.spinePt,
  })
  const [c1, c2] = g.colors
  const box = { x: 34, y: 6 + g.titlePt * 1.6, w: 150, h: 70 }
  const bottom = box.y + box.h
  const states = ['Naive', 'Memory', 'Effector', 'Cycling']
  const control = [0.34, 0.48, 0.22, 0.12]
  const treated = [0.18, 0.37, 0.44, 0.29]
  const barWidth = 7
  const groupStep = box.w / states.length
  const center = (i: number) => box.x + groupStep * (i + 0.5)
  const yScale = (value: number) => bottom - value * box.h * 0.92

  return (
    <figure data-style-preview className="m-0 flex flex-col gap-1">
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 200 128"
        className="h-auto w-full max-w-[360px] rounded-sm border border-border bg-white"
        style={{ fontFamily: g.fontFamily }}
      >
        <text x={box.x + box.w / 2} y={6 + g.titlePt} fontSize={g.titlePt} textAnchor="middle" fill="#111">
          Cell-state scores
        </text>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#111" strokeWidth={g.spinePt} />
        {[0, 0.5, 1].map((fraction) => {
          const y = bottom - fraction * box.h
          return (
            <g key={fraction}>
              <line x1={box.x} y1={y} x2={box.x + box.w} y2={y} stroke="#d7ddd9" strokeWidth={Math.max(0.35, g.spinePt * 0.6)} />
              <line x1={box.x} y1={y} x2={box.x - 3} y2={y} stroke="#111" strokeWidth={g.spinePt} />
              <text x={box.x - 2.5} y={y + g.tickPt * 0.35} fontSize={g.tickPt} textAnchor="end" fill="#111">
                {Math.round(fraction * 100)}
              </text>
            </g>
          )
        })}
        {states.map((state, i) => {
          const x = center(i)
          const h1 = control[i] * box.h * 0.92
          const h2 = treated[i] * box.h * 0.92
          return (
            <g key={state}>
              <rect x={x - barWidth - 1} y={bottom - h1} width={barWidth} height={h1} fill={c1} opacity={0.82} />
              <rect x={x + 1} y={bottom - h2} width={barWidth} height={h2} fill={c2} opacity={0.82} />
              <text x={x} y={bottom + g.tickPt + 2} fontSize={Math.max(3.5, g.tickPt * 0.82)} textAnchor="middle" fill="#111">
                {state}
              </text>
            </g>
          )
        })}
        {/* 折线仍然展示样式页的真实线宽，同时表达每组均值趋势。 */}
        <polyline
          fill="none"
          stroke={c1}
          strokeWidth={g.lineWidthPt}
          points={control.map((value, i) => `${center(i) - barWidth / 2 - 1},${yScale(value)}`).join(' ')}
        />
        <polyline
          fill="none"
          stroke={c2}
          strokeWidth={g.lineWidthPt}
          strokeDasharray={`${Math.max(2, g.lineWidthPt * 4)} ${Math.max(1.5, g.lineWidthPt * 2.5)}`}
          points={treated.map((value, i) => `${center(i) + barWidth / 2 + 1},${yScale(value)}`).join(' ')}
        />
        <line
          x1={box.x + box.w - 64}
          y1={box.y + 10 + g.legendPt * 0.35}
          x2={box.x + box.w - 54}
          y2={box.y + 10 + g.legendPt * 0.35}
          stroke={c1}
          strokeWidth={g.lineWidthPt}
        />
        <text x={box.x + box.w - 51} y={box.y + 10 + g.legendPt * 0.7} fontSize={g.legendPt} fill="#111">
          Control
        </text>
        <line
          x1={box.x + box.w - 64}
          y1={box.y + 16 + g.legendPt * 0.35}
          x2={box.x + box.w - 54}
          y2={box.y + 16 + g.legendPt * 0.35}
          stroke={c2}
          strokeWidth={g.lineWidthPt}
        />
        <text x={box.x + box.w - 51} y={box.y + 16 + g.legendPt * 0.7} fontSize={g.legendPt} fill="#111">
          Treated
        </text>
        <text
          x={box.x + box.w / 2}
          y={bottom + g.tickPt + 4 + g.axisPt}
          fontSize={g.axisPt}
          textAnchor="middle"
          fill="#111"
        >
          Cell state
        </text>
        <text
          transform={`translate(${8 + g.axisPt * 0.35} ${box.y + box.h / 2}) rotate(-90)`}
          fontSize={g.axisPt}
          textAnchor="middle"
          fill="#111"
        >
          Score (%)
        </text>
      </svg>
    </figure>
  )
}

