import type { ReactElement } from "react";
import type { SaveProposal } from "../types";
import { Icon } from "./Icon";

const PREVIEW_LINES = 6;

/**
 * A user-reviewed proposal to save a skill or action. Renders the proposed
 * name/host plus a clipped content preview, with Save/Dismiss. Once resolved the
 * buttons lock and reflect the outcome; the actual persistence is the host's job
 * (Save sends the proposal back to the daemon).
 */
export function ProposalCard({
  proposal,
  resolved,
  onResolve,
}: {
  proposal: SaveProposal;
  resolved?: "saved" | "dismissed";
  onResolve: (accept: boolean) => void;
}): ReactElement {
  const preview = proposal.content.split("\n").slice(0, PREVIEW_LINES).join("\n");
  const done = resolved !== undefined;
  return (
    <div className="proposal" data-resolved={resolved ?? ""}>
      <div className="proposal-head">
        <span className="proposal-ic">
          <Icon name="fileText" size={13} />
        </span>
        Save proposal · <span className="proposal-kind">{proposal.kind}</span>
      </div>
      <div className="proposal-name">{proposal.name}</div>
      {proposal.host !== undefined && <div className="proposal-meta">Host: {proposal.host}</div>}
      {proposal.kind === "action" && proposal.attach !== undefined && (
        <div className="proposal-meta">Attach: {proposal.attach}</div>
      )}
      <pre className="proposal-preview">{preview}</pre>
      <div className="proposal-actions">
        <button
          type="button"
          className="btn primary flex"
          disabled={done}
          onClick={() => onResolve(true)}
        >
          {resolved === "saved" ? "Saved" : "Save"}
        </button>
        <button type="button" className="btn flex" disabled={done} onClick={() => onResolve(false)}>
          {resolved === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
