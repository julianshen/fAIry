import type { CSSProperties, ReactElement } from "react";
import { AGENTS, AGENT_ORDER } from "../agents";
import type { AgentId, FeedCounts, HeaderStyle, HeaderView, RunState } from "../types";
import { Icon } from "./Icon";
import { AgentPip } from "./AgentPip";

type Vars = CSSProperties & Record<`--${string}`, string>;

export interface PanelHeaderProps {
  headerStyle: HeaderStyle;
  run: RunState;
  active: AgentId | null;
  elapsed: number;
  counts: FeedCounts;
  view: HeaderView;
  setView: (view: HeaderView) => void;
  onPause: () => void;
  onReset: () => void;
  onTakeover: () => void;
  onClose: () => void;
  onSettings: () => void;
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const TABS: Array<[HeaderView, string]> = [
  ["chat", "Chat"],
  ["activity", "Activity"],
  ["plan", "Plan"],
];

export function PanelHeader(props: PanelHeaderProps): ReactElement {
  const { headerStyle, run, active, elapsed, counts, view, setView } = props;
  const agent = active ? AGENTS[active] : null;
  const showControls = run === "running" || run === "paused";
  const paused = run === "paused";
  const statusText: Record<RunState, string> = {
    idle: "Ready",
    running: agent ? `${agent.name} is working…` : "Working…",
    paused: "Paused",
    done: "Task complete",
  };
  const tabCount: Record<HeaderView, number> = {
    chat: counts.chat,
    activity: counts.activity,
    plan: counts.plan,
  };

  return (
    <div className="panel-head" data-header={headerStyle}>
      <div className="head-top">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="sparkle" size={17} fill />
          </span>
          <span className="brand-name">
            Fairy<small>browser agents</small>
          </span>
        </div>
        <div className="head-actions">
          {showControls && (
            <button
              className={"ico-btn" + (paused ? " active" : "")}
              title={paused ? "Resume" : "Pause"}
              onClick={props.onPause}
            >
              <Icon name={paused ? "play" : "pause"} size={16} fill={paused} />
            </button>
          )}
          {showControls && (
            <button className="ico-btn" title="Take over the browser" onClick={props.onTakeover}>
              <Icon name="hand" size={17} />
            </button>
          )}
          <button className="ico-btn" title="New task / history" onClick={props.onReset}>
            <Icon name="history" size={16} />
          </button>
          <button className="ico-btn" title="Settings & tweaks" onClick={props.onSettings}>
            <Icon name="settings" size={16} />
          </button>
          <button className="ico-btn" title="Close panel" onClick={props.onClose}>
            <Icon name="x" size={17} />
          </button>
        </div>
      </div>

      <div className="agent-rail">
        {AGENT_ORDER.map((id) => {
          const ag = AGENTS[id];
          return (
            <div
              key={id}
              className="rail-agent"
              data-active={active === id ? "1" : "0"}
              style={{ "--ag": ag.color } as Vars}
              title={`${ag.name} · ${ag.role}`}
            >
              <span className="pip" style={{ background: ag.color }}>
                {ag.glyph}
              </span>
              {ag.name}
            </div>
          );
        })}
      </div>

      <div className="head-tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className="head-tab"
            data-active={view === key ? "1" : "0"}
            onClick={() => setView(key)}
          >
            {label}
            {tabCount[key] > 0 && <span className="cnt">{tabCount[key]}</span>}
          </button>
        ))}
      </div>

      <div className="head-status" data-run={run}>
        <span className="dot" />
        {agent && run !== "idle" && run !== "done" ? <AgentPip id={active!} size={16} /> : null}
        <span>{statusText[run]}</span>
        <span className="grow" />
        {run !== "idle" && (
          <span className="timer">
            <Icon name="clock" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {fmt(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}
