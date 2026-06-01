import type { CSSProperties, ReactElement } from "react";
import { AGENTS } from "../agents";
import type { ActionStyle, FeedItem } from "../types";
import { Icon } from "./Icon";
import { RichText } from "./RichText";

type Item<T extends FeedItem["type"]> = Extract<FeedItem, { type: T }>;

/** CSS custom properties are not in React's CSSProperties type. */
type Vars = CSSProperties & Record<`--${string}`, string>;

export function MsgItem({ item }: { item: Item<"user"> | Item<"say"> }): ReactElement {
  if (item.type === "user") {
    return (
      <div className="msg user">
        <span className="msg-av user">
          <Icon name="user" size={14} />
        </span>
        <div className="msg-col">
          <div className="msg-text">
            <RichText text={item.text} />
          </div>
        </div>
      </div>
    );
  }
  const agent = AGENTS[item.agent];
  return (
    <div className="msg agent" style={{ "--mn": agent.color } as Vars}>
      <span className="msg-av" style={{ background: agent.color }}>
        {agent.glyph}
      </span>
      <div className="msg-col">
        <div className="msg-meta">
          <span className="msg-name">{agent.name}</span>
          <span className="msg-role">{agent.role}</span>
          {item.time && <span className="msg-time">{item.time}</span>}
        </div>
        <div className="msg-text">
          <RichText text={item.text} />
        </div>
      </div>
    </div>
  );
}

export function ThinkingItem({ item }: { item: Item<"thinking"> }): ReactElement {
  const agent = AGENTS[item.agent];
  return (
    <div className="msg agent" style={{ "--mn": agent.color } as Vars}>
      <span className="msg-av" style={{ background: agent.color }}>
        {agent.glyph}
      </span>
      <div className="msg-col">
        <div className="msg-meta">
          <span className="msg-name">{agent.name}</span>
          <span className="msg-role">{agent.role}</span>
        </div>
        <div className="typing">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

export function HandoffItem({ item }: { item: Item<"handoff"> }): ReactElement {
  const from = AGENTS[item.from];
  const to = AGENTS[item.to];
  return (
    <div className="handoff">
      <span className="pair">
        <span className="pip" style={{ background: from.color }}>
          {from.glyph}
        </span>
        <span className="pip" style={{ background: to.color }}>
          {to.glyph}
        </span>
      </span>
      <span>
        <b>{from.name}</b> handed off to <b>{to.name}</b> · {to.role}
      </span>
    </div>
  );
}

export function PlanItem({ item }: { item: Item<"plan"> }): ReactElement {
  const done = item.steps.filter((s) => s.state === "done").length;
  return (
    <div className="plan">
      <div className="plan-head">
        <span className="pic">
          <Icon name="list" size={14} sw={2} />
        </span>
        <b>Plan</b>
        <span className="badge">
          {done}/{item.steps.length} done
        </span>
      </div>
      <div className="plan-steps">
        {item.steps.map((s, i) => {
          const agent = AGENTS[s.who];
          return (
            <div
              key={i}
              className="plan-step"
              data-state={s.state}
              style={{ "--ag": agent.color } as Vars}
            >
              <span className="num">
                {s.state === "done" ? <Icon name="check" size={12} sw={3} /> : i + 1}
              </span>
              <span className="txt">{s.txt}</span>
              <span className="who">
                <span className="d" />
                {agent.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActionsItem({
  item,
  actionStyle,
  onToggle,
}: {
  item: Item<"actions">;
  actionStyle: ActionStyle;
  onToggle: () => void;
}): ReactElement {
  const agent = AGENTS[item.agent];
  return (
    <div className="actions" data-open={item.open ? "1" : "0"}>
      <div
        className="act-head"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="ag-pip" style={{ background: agent.color }}>
          <Icon name={agent.icon} size={11} sw={2} />
        </span>
        <span>
          <b>{agent.name}</b> · {item.title}
        </span>
        {item.running ? (
          <span className="spin" style={{ marginLeft: "auto" }} />
        ) : (
          <span className="chev">
            <Icon name="chevDown" size={16} />
          </span>
        )}
      </div>
      <div className="act-body" data-actions={actionStyle}>
        {item.rows.map((r, i) => (
          <div key={i} className="act-row" data-state={r.state} style={{ "--ag": agent.color } as Vars}>
            <span className="tick">{r.state === "done" && <Icon name="check" size={11} sw={3} />}</span>
            <div className="act-main">
              <div className="act-verb">
                <b>{r.verb}</b> <span className="act-target">{r.target}</span>
              </div>
              {r.sub && <div className="act-sub">{r.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResultItem({ item }: { item: Item<"result"> }): ReactElement {
  const r = item.result;
  return (
    <div className="result">
      <div className="result-top">
        <span className="q">
          <Icon name="zap" size={13} fill />
        </span>
        {r.by}
      </div>
      <div className="result-flight">
        <div className="result-air" style={{ background: r.badgeColor, color: "#fff" }}>
          {r.badge}
        </div>
        <div className="result-mid">
          <div className="result-route">{r.title}</div>
          <div className="result-sub">{r.sub}</div>
        </div>
        <div className="result-price">
          <b>{r.price}</b>
          <span className="tag">{r.tag}</span>
        </div>
      </div>
    </div>
  );
}

export function ConfirmItem({
  item,
  onAnswer,
}: {
  item: Item<"confirm">;
  onAnswer: (choice: string) => void;
}): ReactElement {
  if (item.answered) {
    return (
      <div className="handoff" style={{ alignSelf: "flex-start" }}>
        <Icon name="check" size={14} sw={2.5} style={{ color: "var(--ok)" }} />
        <span>
          You chose <b>{item.choice}</b>
        </span>
      </div>
    );
  }
  return (
    <div className="result-foot" style={{ padding: 0, gap: 8 }}>
      <button className="btn primary flex" onClick={() => onAnswer(item.confirm)}>
        <Icon name="check" size={15} sw={2.4} />
        {item.confirm}
      </button>
      <button className="btn flex" onClick={() => onAnswer(item.decline)}>
        {item.decline}
      </button>
    </div>
  );
}

export function TakeoverItem({
  item,
  onTake,
}: {
  item: Item<"takeover">;
  onTake: () => void;
}): ReactElement {
  return (
    <div className="takeover">
      <span className="ic">
        <Icon name="hand" size={20} />
      </span>
      <div className="tx">
        <b>Your turn</b>
        <span>
          <RichText text={item.text} />
        </span>
      </div>
      {!item.taken && (
        <button className="btn" onClick={onTake} style={{ borderColor: "var(--border-3)" }}>
          Take over
        </button>
      )}
    </div>
  );
}
