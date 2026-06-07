// Public API of @fairy/agent-panel.
// Import "./styles/index.css" alongside this in your host app.

export { Panel } from "./components/Panel";
export type { PanelProps } from "./components/Panel";

export { usePanelController } from "./usePanelController";
export type { PanelController } from "./usePanelController";

export { initialState, reduce, counts } from "./engine";

export { AGENTS, AGENT_ORDER } from "./agents";
export { DEFAULT_PANEL_CONFIG, FONT_STACK, resolveFont } from "./config";
export { DEFAULT_SUGGESTIONS } from "./suggestions";

export { Icon } from "./components/Icon";
export type { IconName } from "./components/Icon";

export { A2UIView } from "./a2ui/renderA2UI";
export type { A2UIMessage, A2UINode, A2UIChartKind, A2UITextVariant } from "./a2ui/types";

export type {
  AgentId,
  Agent,
  RunState,
  Beat,
  UiAction,
  PanelAction,
  PanelState,
  FeedItem,
  FeedItemType,
  FeedCounts,
  PlanStep,
  ActRow,
  ResultCard,
  Suggestion,
  SuggestionGroup,
  PanelConfig,
  ThemeMode,
  Density,
  VisualStyle,
  HeaderStyle,
  ChatLayout,
  ActionStyle,
  EmptyVariant,
  HeaderView,
  SavedActionView,
} from "./types";
