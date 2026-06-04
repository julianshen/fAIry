import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("./A2UIChart", () => ({
  A2UIChart: ({ node }: { node: { chart: string } }) => (
    <div data-testid="chart" data-chart={node.chart} />
  ),
}));

import { A2UIView } from "./renderA2UI";
import type { A2UINode } from "./types";

describe("A2UIView", () => {
  it("wraps output in an .a2ui container", () => {
    const { container } = render(<A2UIView message={{ type: "text", text: "hi" }} />);
    expect(container.querySelector(".a2ui")).not.toBeNull();
  });

  it("renders text with the default body variant and an explicit variant", () => {
    const { container, rerender } = render(<A2UIView message={{ type: "text", text: "plain" }} />);
    expect(container.querySelector(".a2ui-text")).toHaveAttribute("data-variant", "body");
    expect(screen.getByText("plain")).toBeInTheDocument();
    rerender(<A2UIView message={{ type: "text", text: "Title", variant: "heading" }} />);
    expect(container.querySelector(".a2ui-text")).toHaveAttribute("data-variant", "heading");
  });

  it("renders a card with its title and nested children", () => {
    const message: A2UINode = {
      type: "card",
      title: "Summary",
      children: [
        { type: "text", text: "inside" },
        { type: "table", columns: ["A"], rows: [["1"]] },
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector(".a2ui-card-title")).toHaveTextContent("Summary");
    expect(screen.getByText("inside")).toBeInTheDocument();
    expect(container.querySelector(".a2ui-card .a2ui-table")).not.toBeNull();
  });

  it("renders a group's children with no chrome of its own", () => {
    const message: A2UINode = {
      type: "group",
      children: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector(".a2ui-group")).not.toBeNull();
    expect(container.querySelectorAll(".a2ui-group .a2ui-text")).toHaveLength(2);
  });

  it("renders an unordered list of strings", () => {
    const { container } = render(
      <A2UIView message={{ type: "list", items: ["alpha", "beta"] }} />,
    );
    expect(container.querySelector("ul.a2ui-list")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("renders an ordered list and supports node items", () => {
    const message: A2UINode = {
      type: "list",
      ordered: true,
      items: ["first", { type: "card", title: "nested", children: [] }],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector("ol.a2ui-list")).not.toBeNull();
    expect(container.querySelector("li .a2ui-card-title")).toHaveTextContent("nested");
  });

  it("renders a table with caption, header columns, and body cells", () => {
    const message: A2UINode = {
      type: "table",
      caption: "Fares",
      columns: ["Airline", "Price"],
      rows: [
        ["ANA", 842],
        ["JAL", 910],
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector(".a2ui-table-container > table.a2ui-table")).not.toBeNull();
    expect(container.querySelector("caption")).toHaveTextContent("Fares");
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("842")).toBeInTheDocument();
  });

  it("routes a chart node to A2UIChart", () => {
    render(<A2UIView message={{ type: "chart", chart: "bar", x: "m", series: ["a"], data: [] }} />);
    expect(screen.getByTestId("chart")).toHaveAttribute("data-chart", "bar");
  });

  it("renders a fallback for an unknown node type", () => {
    const bogus = { type: "widget" } as unknown as A2UINode;
    const { container } = render(<A2UIView message={bogus} />);
    const unknown = container.querySelector(".a2ui-unknown");
    expect(unknown).toHaveAttribute("data-type", "widget");
    expect(unknown).toHaveTextContent("widget");
  });
});
