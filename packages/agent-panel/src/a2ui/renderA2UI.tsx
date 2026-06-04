import type { ReactElement } from "react";
import type { A2UINode } from "./types";
import { A2UIChart } from "./A2UIChart";
import { asArray } from "./safe";

/** Renders one A2UI message (a single root node), recursing into containers. */
export function A2UIView({ message }: { message: A2UINode }): ReactElement {
  return <div className="a2ui">{renderNode(message)}</div>;
}

function renderNode(node: A2UINode, key?: number): ReactElement {
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
                    <td key={c}>{cell}</td>
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
