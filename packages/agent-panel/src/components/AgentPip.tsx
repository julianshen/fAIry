import type { ReactElement } from "react";
import { AGENTS } from "../agents";
import type { AgentId } from "../types";
import { Icon } from "./Icon";

export interface AgentPipProps {
  id: AgentId;
  size?: number;
  radius?: number;
  icon?: boolean;
}

/** A small rounded chip carrying an agent's color and glyph (or icon). */
export function AgentPip({
  id,
  size = 18,
  radius = 6,
  icon = false,
}: AgentPipProps): ReactElement | null {
  const agent = AGENTS[id];
  if (!agent) return null;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: agent.color,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        flex: "0 0 auto",
        fontSize: size * 0.42,
        fontWeight: 700,
      }}
    >
      {icon ? <Icon name={agent.icon} size={size * 0.6} sw={2} /> : agent.glyph}
    </span>
  );
}
