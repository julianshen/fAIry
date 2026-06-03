import type { ReactElement } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { A2UINode } from "./types";

type ChartNode = Extract<A2UINode, { type: "chart" }>;

/** Stable per-series palette (indexed by series order, wrapping past the end). */
const SERIES_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];
const colorFor = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length] as string;

/**
 * Renders an A2UI `chart` node via recharts. Cartesian kinds (bar/line/area)
 * share axes/grid/legend and draw one element per series; `pie` draws the first
 * series as slices labelled by the `x` field.
 */
export function A2UIChart({ node }: { node: ChartNode }): ReactElement {
  return (
    <div className="a2ui-chart" data-chart={node.chart}>
      {node.title && <div className="a2ui-chart-title">{node.title}</div>}
      <ResponsiveContainer width="100%" height={220}>
        {renderChart(node)}
      </ResponsiveContainer>
    </div>
  );
}

function renderChart(node: ChartNode): ReactElement {
  switch (node.chart) {
    case "bar":
      return (
        <BarChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Bar key={s} dataKey={s} fill={colorFor(i)} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Line key={s} type="monotone" dataKey={s} stroke={colorFor(i)} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Area key={s} type="monotone" dataKey={s} stroke={colorFor(i)} fill={colorFor(i)} fillOpacity={0.25} />
          ))}
        </AreaChart>
      );
    case "pie":
      // A2UI `chart` allows multiple series, but a pie shows a single dimension:
      // we slice by the first series, labelled by the `x` field. Extra series are
      // intentionally ignored (a multi-ring pie is out of scope for v1).
      return (
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie data={node.data} dataKey={node.series[0] ?? ""} nameKey={node.x} fill={colorFor(0)} label />
        </PieChart>
      );
  }
}
