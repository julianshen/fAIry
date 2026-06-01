import type { CSSProperties, ReactElement } from "react";
import { AGENTS, AGENT_ORDER } from "../agents";
import type { EmptyVariant, SuggestionGroup } from "../types";
import { Icon } from "./Icon";

type Vars = CSSProperties & Record<`--${string}`, string>;

export interface EmptyStateProps {
  variant: EmptyVariant;
  suggestions: SuggestionGroup[];
  onPick: (task: string) => void;
}

export function EmptyState({ variant, suggestions, onPick }: EmptyStateProps): ReactElement {
  const featured = suggestions[0]?.items[0];

  if (variant === "hero") {
    return (
      <div className="empty" data-empty="hero">
        <div className="hero-orb">
          <Icon name="sparkle" size={42} fill />
        </div>
        <div className="hero-title">Hi, I'm Fairy</div>
        <div className="hero-sub">
          Tell me a goal and my team will operate this tab for you — navigating, reading, and filling
          things in while you watch.
        </div>
        <div className="hero-chips">
          {(suggestions[0]?.items ?? []).map((s) => (
            <button key={s.id} className="hero-chip" onClick={() => onPick(s.task)}>
              {s.title}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "grid") {
    return (
      <div className="empty" data-empty="grid">
        <div className="eg-head">
          <b>Your agent team</b>
          <p>
            Four specialists that hand work off to each other. Give Shaka a goal and it routes the
            rest.
          </p>
        </div>
        <div className="eg-grid">
          {AGENT_ORDER.map((id) => {
            const a = AGENTS[id];
            return (
              <div key={id} className="eg-card">
                <div className="ec-top">
                  <span className="ec-pip" style={{ background: a.color }}>
                    <Icon name={a.icon} size={15} sw={2} />
                  </span>
                  <div>
                    <div className="ec-name">{a.name}</div>
                    <div className="ec-role">{a.role}</div>
                  </div>
                </div>
                <div className="ec-desc">{a.desc}</div>
              </div>
            );
          })}
        </div>
        {featured && (
          <button className="sug" onClick={() => onPick(featured.task)}>
            <span className="si" style={{ "--ag": "var(--accent)" } as Vars}>
              <Icon name={featured.icon} size={17} />
            </span>
            <span className="st">
              <b>{featured.title}</b>
              <span>{featured.sub}</span>
            </span>
            <span className="go">
              <Icon name="arrowR" size={16} />
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="empty" data-empty="suggestions">
      <div>
        <div className="empty-greet">
          Hi — I'm <span className="grad">Fairy</span>.<br />
          What should the team do on this tab?
        </div>
        <div className="empty-sub">
          I'll plan the task and route each step to a specialist. You can pause or take over anytime.
        </div>
      </div>
      {suggestions.map((grp, gi) => (
        <div key={gi} className="sug-list">
          <div className="sug-cap">{grp.cap}</div>
          {grp.items.map((s) => (
            <button key={s.id} className="sug" onClick={() => onPick(s.task)}>
              <span className="si">
                <Icon name={s.icon} size={17} />
              </span>
              <span className="st">
                <b>{s.title}</b>
                <span>{s.sub}</span>
              </span>
              <span className="go">
                <Icon name="arrowR" size={16} />
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
