import type { CSSProperties, ReactElement } from "react";

/**
 * Original line-icon set (Lucide-style geometry, drawn on a 24x24 grid with a
 * currentColor stroke). Each value is one or more SVG subpaths concatenated;
 * the renderer splits them on "M" so a single glyph can have several strokes.
 */
const ICON_PATHS = {
  sparkle:
    "M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6zM18.5 14.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3L15.5 17.5l2.3-.7z",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  image: "M4 5h16v14H4zM4 15l4-4 5 5M14 13l2-2 4 4M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  paperclip:
    "M20 11l-8.5 8.5a4 4 0 0 1-6-6L13 5a3 3 0 0 1 4 4l-8 8a1.5 1.5 0 0 1-2-2l7.5-7.5",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14 2h-4l-.3 2.4a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3L10 22h4l.3-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2",
  pause: "M9 5v14M15 5v14",
  play: "M7 5l11 7-11 7z",
  stop: "M7 7h10v10H7z",
  hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-4.3-1.8L4 16.5s-1-1 .2-2 2.3.4 2.3.4L8 16.5",
  x: "M6 6l12 12M18 6L6 18",
  chevDown: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  arrowR: "M5 12h14M13 6l6 6-6 6",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z",
  fileText: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  edit: "M4 20h4L19 9a2 2 0 0 0-3-3L5 17zM15 6l3 3",
  brain:
    "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 8 18a2.5 2.5 0 0 0 4 .5 2.5 2.5 0 0 0 4-.5 3 3 0 0 0 3-5.2A3 3 0 0 0 18 7a3 3 0 0 0-3-3 2.5 2.5 0 0 0-3 1 2.5 2.5 0 0 0-3-1zM12 5v13",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  nav: "M3 11l18-8-8 18-2-8z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  zap: "M13 2L4 14h7l-1 8 9-12h-7z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2",
  plane:
    "M21 16v-2l-8-5V4a1.5 1.5 0 0 0-3 0v5l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-3.5z",
  table: "M4 5h16v14H4zM4 10h16M10 5v14",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps {
  name: IconName;
  size?: number;
  sw?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 18,
  sw = 1.7,
  fill = false,
  className,
  style,
}: IconProps): ReactElement {
  const d: string = ICON_PATHS[name] ?? "";
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d
        .split("M")
        .filter(Boolean)
        .map((seg, i) => (
          <path key={i} d={"M" + seg} />
        ))}
    </svg>
  );
}
