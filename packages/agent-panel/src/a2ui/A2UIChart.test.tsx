import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("recharts", () => {
  type StubProps = { children?: ReactNode; dataKey?: string; nameKey?: string; data?: unknown[] };
  const stub =
    (testid: string) =>
    ({ children, dataKey, nameKey, data }: StubProps) =>
      (
        <div
          data-testid={testid}
          data-key={dataKey ?? ""}
          data-namekey={nameKey ?? ""}
          data-len={data ? String(data.length) : ""}
        >
          {children}
        </div>
      );
  return {
    ResponsiveContainer: stub("responsive"),
    BarChart: stub("barchart"),
    LineChart: stub("linechart"),
    AreaChart: stub("areachart"),
    PieChart: stub("piechart"),
    Bar: stub("bar"),
    Line: stub("line"),
    Area: stub("area"),
    Pie: stub("pie"),
    XAxis: stub("xaxis"),
    YAxis: stub("yaxis"),
    CartesianGrid: stub("grid"),
    Tooltip: stub("tooltip"),
    Legend: stub("legend"),
  };
});

import { A2UIChart } from "./A2UIChart";
import type { A2UINode } from "./types";

type ChartNode = Extract<A2UINode, { type: "chart" }>;

const bar: ChartNode = {
  type: "chart",
  chart: "bar",
  title: "Quarterly",
  x: "month",
  series: ["plan", "actual"],
  data: [
    { month: "Jan", plan: 10, actual: 8 },
    { month: "Feb", plan: 12, actual: 14 },
    { month: "Mar", plan: 9, actual: 11 },
  ],
};

describe("A2UIChart", () => {
  it("renders a bar chart: one Bar per series, x-axis bound to the x key, title shown", () => {
    const { container } = render(<A2UIChart node={bar} />);
    expect(container.querySelector(".a2ui-chart")).toHaveAttribute("data-chart", "bar");
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
    expect(screen.getByTestId("barchart")).toHaveAttribute("data-len", "3");
    expect(screen.getByTestId("xaxis")).toHaveAttribute("data-key", "month");
    expect(screen.getAllByTestId("bar")).toHaveLength(2);
  });

  it("renders a line chart with one Line per series", () => {
    const node: ChartNode = { ...bar, chart: "line", series: ["plan"] };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("linechart")).toBeInTheDocument();
    expect(screen.getAllByTestId("line")).toHaveLength(1);
  });

  it("renders an area chart with one Area per series", () => {
    const node: ChartNode = { ...bar, chart: "area", series: ["plan"] };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("areachart")).toBeInTheDocument();
    expect(screen.getAllByTestId("area")).toHaveLength(1);
  });

  it("renders a pie chart keyed on the first series and named by the x field", () => {
    const node: ChartNode = { ...bar, chart: "pie", title: undefined };
    render(<A2UIChart node={node} />);
    const pie = screen.getByTestId("pie");
    expect(pie).toHaveAttribute("data-key", "plan");
    expect(pie).toHaveAttribute("data-namekey", "month");
  });

  it("tolerates a pie chart with no series (empty data-key)", () => {
    const node: ChartNode = { ...bar, chart: "pie", series: [], title: undefined };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("pie")).toHaveAttribute("data-key", "");
  });

  it("cycles the palette for more series than colors", () => {
    const node: ChartNode = {
      ...bar,
      series: ["a", "b", "c", "d", "e", "f", "g"],
      data: [{ month: "Jan", a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }],
    };
    render(<A2UIChart node={node} />);
    expect(screen.getAllByTestId("bar")).toHaveLength(7);
  });
});
