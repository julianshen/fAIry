import { useEffect, useRef, type ReactElement } from "react";
import { Icon } from "./Icon";

export interface ComposerProps {
  value: string;
  setValue: (value: string) => void;
  onSend: (task: string) => void;
  running: boolean;
  onStop: () => void;
  planFirst: boolean;
  setPlanFirst: (planFirst: boolean) => void;
  /** Host of the current tab, shown as a context pill. */
  site?: string;
  /** Label of the active model, shown in the model chip. */
  model?: string;
}

const MAX_HEIGHT = 130;

export function Composer({
  value,
  setValue,
  onSend,
  running,
  onStop,
  planFirst,
  setPlanFirst,
  site,
  model = "Fairy Pro",
}: ComposerProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea with its content up to a cap, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + "px";
  }, [value]);

  const submit = (): void => {
    if (running) return;
    const trimmed = value.trim();
    if (trimmed) onSend(trimmed);
  };

  return (
    <div className="composer">
      <div className="composer-glow" />
      <div className="comp-box">
        <div className="comp-pills">
          <button
            className="comp-pill"
            data-on={planFirst ? "1" : "0"}
            onClick={() => setPlanFirst(!planFirst)}
            title="Show the plan before acting"
          >
            <Icon name="list" size={12} sw={2} />
            Plan first
          </button>
          {site && (
            <button className="comp-pill">
              <Icon name="globe" size={12} sw={2} />
              {site}
            </button>
          )}
        </div>
        <textarea
          ref={ref}
          className="comp-input"
          rows={1}
          value={value}
          placeholder="Ask Fairy to do something on this page…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="comp-bar">
          <button className="comp-tool" title="Attach">
            <Icon name="paperclip" size={17} />
          </button>
          <button className="comp-tool" title="Screenshot">
            <Icon name="image" size={17} />
          </button>
          <span className="comp-grow" />
          <button className="comp-model" title="Model">
            <Icon name="sparkle" size={13} fill />
            {model}
            <Icon name="chevDown" size={13} />
          </button>
          {running ? (
            <button className="send-btn stop" onClick={onStop} title="Stop">
              <Icon name="stop" size={14} fill />
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!value.trim()} title="Send">
              <Icon name="arrowUp" size={17} sw={2.2} />
            </button>
          )}
        </div>
      </div>
      <div className="comp-foot">
        Fairy can act on this page. Review sensitive steps before confirming.
      </div>
    </div>
  );
}
