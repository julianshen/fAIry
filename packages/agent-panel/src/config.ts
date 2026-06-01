import type { PanelConfig } from "./types";

/** Font stacks selectable in the design; key is the human-facing name. */
export const FONT_STACK: Record<string, string> = {
  Geist: '"Geist", ui-sans-serif, system-ui, sans-serif',
  "General Sans": '"General Sans", ui-sans-serif, system-ui, sans-serif',
  "Space Grotesk": '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
};

/** The design's default look (the EDITMODE defaults from the prototype). */
export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  theme: "dark",
  accent: "#7c6cff",
  font: "Geist",
  panelW: 432,
  density: "regular",
  visualStyle: "glass",
  headerStyle: "rail",
  chatLayout: "flat",
  actionStyle: "timeline",
  emptyState: "suggestions",
};

export function resolveFont(font: string): string {
  return FONT_STACK[font] ?? FONT_STACK.Geist!;
}
