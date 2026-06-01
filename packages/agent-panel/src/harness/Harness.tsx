import type { ReactElement } from "react";
import { Panel } from "../components/Panel";
import { useSimulation } from "./useSimulation";

/**
 * Dev harness: the real Panel wired to a scripted simulation. Lets us watch
 * every state — idle, planning, navigating, confirm, takeover, done — in a
 * browser without a daemon. Not part of the shipped package.
 */
export function Harness(): ReactElement {
  const panelProps = useSimulation();
  return (
    <div className="harness-stage">
      <Panel {...panelProps} />
    </div>
  );
}
