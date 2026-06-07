import { useState, type ReactElement } from "react";
import type { SaveProposal } from "../types";
import { Icon } from "./Icon";

const PREVIEW_LINES = 6;
const PREVIEW_MAX_CHARS = 1000;

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
  // Clip to the first few lines AND a char cap, so a single very long line (no
  // newlines) can't produce a huge DOM node.
  const preview = proposal.content.split("\n").slice(0, PREVIEW_LINES).join("\n").slice(0, PREVIEW_MAX_CHARS);
  // Lock on the first click too (not just once `resolved` round-trips back as a
  // prop), so a fast double-click can't fire onResolve — and thus a second save
  // request — twice before the parent re-renders.
  const [acted, setActed] = useState(false);
  const done = acted || resolved !== undefined;
  const resolve = (accept: boolean): void => {
    if (done) return;
    setActed(true);
    onResolve(accept);
  };
  return (
    <div className="proposal" data-resolved={resolved ?? ""}>
      <div className="proposal-head">
        <span className="proposal-ic">
          <Icon name="fileText" size={13} />
        </span>
        Save proposal · <span className="proposal-kind">{proposal.kind}</span>
      </div>
      <div className="proposal-name">{proposal.name}</div>
      {proposal.host && <div className="proposal-meta">Host: {proposal.host}</div>}
      {proposal.kind === "action" && proposal.attach !== undefined && (
        <div className="proposal-meta">Attach: {proposal.attach}</div>
      )}
      <pre className="proposal-preview">{preview}</pre>
      <div className="proposal-actions">
        <button type="button" className="btn primary flex" disabled={done} onClick={() => resolve(true)}>
          {resolved === "saved" ? "Saved" : "Save"}
        </button>
        <button type="button" className="btn flex" disabled={done} onClick={() => resolve(false)}>
          {resolved === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
