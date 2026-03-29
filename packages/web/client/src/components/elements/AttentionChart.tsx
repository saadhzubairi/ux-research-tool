import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { ElementAttention } from '@gazekit/shared'
import { truncateText } from '../../utils/formatters'
import EmptyState from '../common/EmptyState'

interface AttentionChartProps {
  elements: ElementAttention[]
}

const BAR_COLORS = [
  '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe',
  '#e0e7ff', '#4f46e5', '#4338ca', '#3730a3',
  '#312e81', '#eef2ff',
]

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{
    payload: {
      selector: string
      tag: string
      dwellMs: number
      fixations: number
      pct: number
    }
  }>
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.[0]) return null

  const data = payload[0].payload

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-md shadow-lg p-3 text-xs">
      <p className="font-mono text-surface-200 mb-1">{data.selector}</p>
      <p className="text-surface-400">
        &lt;{data.tag}&gt;
      </p>
      <div className="mt-2 space-y-0.5">
        <p className="text-surface-300">
          Dwell: {(data.dwellMs / 1000).toFixed(1)}s
        </p>
        <p className="text-surface-300">
          Fixations: {data.fixations}
        </p>
        <p className="text-surface-300">
          Attention: {data.pct.toFixed(1)}%
        </p>
      </div>
    </div>
  )
}

export default function AttentionChart({ elements }: AttentionChartProps) {
  if (elements.length === 0) {
    return (
      <EmptyState
        title="No chart data"
        description="Element attention data will be visualized here once available."
      />
    )
  }

  const top10 = [...elements]
    .sort((a, b) => b.totalDwellMs - a.totalDwellMs)
    .slice(0, 10)

  const chartData = top10.map((el) => ({
    label: truncateText(el.selector, 25),
    selector: el.selector,
    tag: el.tag,
    dwellMs: el.totalDwellMs,
    dwellSec: parseFloat((el.totalDwellMs / 1000).toFixed(1)),
    fixations: el.fixationCount,
    pct: el.percentOfTotalDwell,
  }))

  return (
    <div className="card">
      <h3 className="card-header">Top 10 Elements by Dwell Time</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#2a2a2a"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: '#737373', fontSize: 11 }}
              axisLine={{ stroke: '#3a3a3a' }}
              tickLine={{ stroke: '#3a3a3a' }}
              label={{
                value: 'Dwell Time (s)',
                position: 'insideBottom',
                offset: -2,
                style: { fill: '#525252', fontSize: 11 },
              }}
            />
            <YAxis
              dataKey="label"
              type="category"
              width={180}
              tick={{ fill: '#a3a3a3', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={{ stroke: '#3a3a3a' }}
              tickLine={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
            />
            <Bar dataKey="dwellSec" radius={0} barSize={20}>
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={BAR_COLORS[index % BAR_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
