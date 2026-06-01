import type { SuggestionGroup } from "./types";

/** Default starter prompts shown in the empty state. */
export const DEFAULT_SUGGESTIONS: SuggestionGroup[] = [
  {
    cap: "Pick up where you'd start",
    items: [
      {
        id: "flight",
        icon: "plane",
        title: "Book the cheapest nonstop to Tokyo",
        sub: "SFO → HND · Mar 14 · under $900 · window seat",
        task: "Book me the cheapest nonstop flight from SFO to Tokyo on March 14 under $900, window seat.",
      },
      {
        id: "extract",
        icon: "table",
        title: "Extract these results to a table",
        sub: "Pull every fare on the page into CSV",
        task: "Extract all flights on this page into a table with airline, times, stops and price.",
      },
      {
        id: "summarize",
        icon: "fileText",
        title: "Summarize this page",
        sub: "TL;DR + the 3 things that matter",
        task: "Summarize this page and tell me the 3 things I should know.",
      },
    ],
  },
];
