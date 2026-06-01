import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { DEFAULT_PANEL_CONFIG, resolveFont } from "../config";
import { counts } from "../engine";
import { DEFAULT_SUGGESTIONS } from "../suggestions";
import type {
  FeedItem,
  HeaderView,
  PanelConfig,
  PanelState,
  SuggestionGroup,
} from "../types";
import { PanelHeader } from "./PanelHeader";
import { EmptyState } from "./EmptyState";
import { Feed } from "./Feed";
import { Composer } from "./Composer";

type Vars = CSSProperties & Record<`--${string}`, string>;

export interface PanelProps {
  state: PanelState;
  elapsed: number;
  config?: Partial<PanelConfig>;
  suggestions?: SuggestionGroup[];
  site?: string;
  model?: string;
  onSend: (task: string) => void;
  onReset: () => void;
  onPause: () => void;
  onTakeover: () => void;
  onStop: () => void;
  onAnswer: (key: number, choice: string) => void;
  onToggleActions: (key: number) => void;
  onTake: (key: number) => void;
  onSettings?: () => void;
  onClose?: () => void;
}

const VIEW_TYPES: Record<HeaderView, FeedItem["type"][]> = {
  chat: ["user", "say", "result", "confirm", "takeover", "thinking"],
  activity: ["actions", "handoff"],
  plan: ["plan"],
};

const noop = (): void => {};

/**
 * The Fairy agent panel — header + body (empty state or feed) + composer.
 * Fully controlled: all run state arrives via `state`/`elapsed` and every
 * interaction leaves through a callback. Only ephemeral UI (draft text,
 * plan-first toggle, active tab) is held locally.
 */
export function Panel(props: PanelProps): ReactElement {
  const { state, elapsed, site, model } = props;
  const config = { ...DEFAULT_PANEL_CONFIG, ...props.config };
  const suggestions = props.suggestions ?? DEFAULT_SUGGESTIONS;

  const [input, setInput] = useState("");
  const [planFirst, setPlanFirst] = useState(true);
  const [view, setView] = useState<HeaderView>("chat");
  const bodyRef = useRef<HTMLDivElement>(null);

  const started = state.items.length > 0;
  const tabbed = config.headerStyle === "tabs";

  const shown = useMemo(() => {
    if (!tabbed) return state.items;
    const allowed = VIEW_TYPES[view];
    return state.items.filter((it) => allowed.includes(it.type));
  }, [tabbed, view, state.items]);

  // The elapsed timer re-renders every second; don't re-scan the feed each time.
  const feedCounts = useMemo(() => counts(state.items), [state.items]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  const send = (task: string): void => {
    props.onSend(task);
    setInput("");
  };

  const rootStyle: Vars = {
    "--accent": config.accent,
    "--panel-w": config.panelW + "px",
    "--font-ui": resolveFont(config.font),
  };

  return (
    <div
      className="fairy-root"
      data-theme={config.theme}
      data-density={config.density}
      style={rootStyle}
    >
      <div className="panel" data-style={config.visualStyle}>
        <PanelHeader
          headerStyle={config.headerStyle}
          run={state.run}
          active={state.active}
          elapsed={elapsed}
          counts={feedCounts}
          view={view}
          setView={setView}
          onPause={props.onPause}
          onReset={props.onReset}
          onTakeover={props.onTakeover}
          onClose={props.onClose ?? noop}
          onSettings={props.onSettings ?? noop}
        />
        <div className="panel-body" ref={bodyRef}>
          {started ? (
            <Feed
              items={shown}
              chat={config.chatLayout}
              actionStyle={config.actionStyle}
              onAnswer={props.onAnswer}
              onTake={props.onTake}
              onToggleActions={props.onToggleActions}
            />
          ) : (
            <EmptyState variant={config.emptyState} suggestions={suggestions} onPick={send} />
          )}
        </div>
        <Composer
          value={input}
          setValue={setInput}
          onSend={send}
          running={state.run === "running"}
          onStop={props.onStop}
          planFirst={planFirst}
          setPlanFirst={setPlanFirst}
          site={site}
          model={model}
        />
      </div>
    </div>
  );
}
