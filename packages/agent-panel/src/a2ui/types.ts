/**
 * A pragmatic NESTED-TREE subset of A2UI v0.8's component types — the shapes the
 * panel renders. A message is a single root node; container nodes nest children.
 * Unknown `type` values are tolerated at render time (forward-compatible), so the
 * feed degrades gracefully rather than crashing on future/full-spec messages.
 */
export type A2UITextVariant = "body" | "heading" | "caption";

/** Chart kinds the panel can draw (a fAIry extension over A2UI core). */
export type A2UIChartKind = "bar" | "line" | "area" | "pie";

export type A2UINode =
  | { type: "text"; text: string; variant?: A2UITextVariant }
  | { type: "card"; title?: string; children: A2UINode[] }
  | { type: "group"; children: A2UINode[] }
  | { type: "list"; ordered?: boolean; items: Array<string | A2UINode> }
  | { type: "table"; caption?: string; columns: string[]; rows: Array<Array<string | number>> }
  | {
      type: "chart";
      chart: A2UIChartKind;
      title?: string;
      data: Array<Record<string, string | number>>;
      x: string;
      series: string[];
    };

/** A single A2UI message is one root node (which may nest children). */
export type A2UIMessage = A2UINode;
