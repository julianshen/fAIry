import type { ReactElement, ReactNode } from "react";
import type { A2UINode } from "./types";
import { A2UIChart } from "./A2UIChart";
import { asArray } from "./safe";

/** Renders one A2UI message (a single root node), recursing into containers. */
export function A2UIView({ message }: { message: A2UINode }): ReactElement {
  return <div className="a2ui">{renderNode(message)}</div>;
}

/**
 * Table cells are opaque wire data: an object/array isn't a valid React child
 * and would throw. Pass primitives through; stringify anything else so the value
 * is at least visible instead of crashing the feed.
 */
function renderCell(cell: unknown): ReactNode {
  if (typeof cell === "string" || typeof cell === "number") return cell;
  return JSON.stringify(cell);
}

function renderNode(node: A2UINode, key?: number): ReactElement {
  if (node == null || typeof node !== "object") {
    // null/undefined/primitive wire data — can't switch on `.type`; degrade to
    // the unsupported fallback instead of throwing on the dereference.
    const type = node == null ? String(node) : typeof node;
    return (
      <div key={key} className="a2ui-unknown" data-type={type}>
        Unsupported component: {type}
      </div>
    );
  }
  switch (node.type) {
    case "text":
      return (
        <div key={key} className="a2ui-text" data-variant={node.variant ?? "body"}>
          {node.text}
        </div>
      );
    case "card":
      return (
        <div key={key} className="a2ui-card">
          {node.title && <div className="a2ui-card-title">{node.title}</div>}
          <div className="a2ui-card-body">{asArray(node.children).map((c, i) => renderNode(c, i))}</div>
        </div>
      );
    case "group":
      return (
        <div key={key} className="a2ui-group">
          {asArray(node.children).map((c, i) => renderNode(c, i))}
        </div>
      );
    case "list": {
      const items = asArray(node.items).map((it, i) => (
        <li key={i}>{typeof it === "string" ? it : renderNode(it)}</li>
      ));
      return node.ordered ? (
        <ol key={key} className="a2ui-list">
          {items}
        </ol>
      ) : (
        <ul key={key} className="a2ui-list">
          {items}
        </ul>
      );
    }
    case "table":
      // Wrapped so a wide table scrolls horizontally inside a narrow side panel
      // instead of overflowing the feed.
      return (
        <div key={key} className="a2ui-table-container">
          <table className="a2ui-table">
            {node.caption && <caption>{node.caption}</caption>}
            <thead>
              <tr>
                {asArray(node.columns).map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {asArray(node.rows).map((row, r) => (
                <tr key={r}>
                  {asArray(row).map((cell, c) => (
                    <td key={c}>{renderCell(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "chart":
      return <A2UIChart key={key} node={node} />;
    default:
      // Runtime-only branch: a `type` the schema doesn't cover (e.g. a future or
      // full-spec A2UI message). TS narrows `node` to `never` here, so read the
      // type defensively for the fallback label.
      return (
        <div key={key} className="a2ui-unknown" data-type={(node as { type: string }).type}>
          Unsupported component: {(node as { type: string }).type}
        </div>
      );
  }
}
