import type { Beat, ResultCard } from "../types";

/** A scripted beat plus how long to wait before firing it. */
export type ScriptBeat = Beat & { wait?: number };

const ANA: ResultCard = {
  by: "Pythagoras's pick",
  badge: "NH",
  badgeColor: "#1e3a8a",
  title: "10:55 → 14:30+1",
  sub: "ANA NH7 · 10h 35m · Nonstop · 92% on-time",
  price: "$842",
  tag: "cheapest nonstop",
};

/**
 * The design's scripted run, retyped to the panel's beat model. The
 * prototype's browser-overlay fields (hl/scrollTo/set/fill) are dropped —
 * they drove the fake page, which the panel no longer owns.
 */
export const SCRIPT: ScriptBeat[] = [
  { kind: "say", agent: "sage", wait: 600, text: "On it. I'll break this into steps and route each to the right specialist on the team." },
  {
    kind: "plan",
    wait: 900,
    steps: [
      { txt: "Open Skylark, set SFO → Tokyo for Mar 14", who: "atlas" },
      { txt: "Apply Nonstop + max $900, sort by price", who: "atlas" },
      { txt: "Read remaining fares & rank them", who: "quill" },
      { txt: "Recommend the best — confirm with you", who: "sage" },
      { txt: "Fill passenger details + window seat", who: "forge" },
    ],
  },
  { kind: "status", run: "running", wait: 500 },
  { kind: "handoff", from: "sage", to: "atlas", wait: 700 },

  { kind: "actGroup", agent: "atlas", title: "Navigating Skylark", wait: 500 },
  { kind: "act", agent: "atlas", wait: 850, verb: "Opened", target: "skylark.com/flights", sub: "search loaded · 5 results" },
  { kind: "act", agent: "atlas", wait: 1100, verb: "Toggled", target: "Nonstop", sub: "filter applied" },
  { kind: "act", agent: "atlas", wait: 1100, verb: "Set", target: "Max price = $900", sub: "1 fare hidden" },
  { kind: "act", agent: "atlas", wait: 1000, verb: "Sorted by", target: "Lowest price" },
  { kind: "planStep", i: 0, state: "done", wait: 200 },
  { kind: "planStep", i: 1, state: "done", wait: 100 },

  { kind: "handoff", from: "atlas", to: "quill", wait: 800 },
  { kind: "actGroup", agent: "quill", title: "Reading fares", wait: 400 },
  { kind: "act", agent: "quill", wait: 950, verb: "Scanned", target: "5 fare rows", sub: "extracted airline · times · stops · price" },
  { kind: "act", agent: "quill", wait: 1100, verb: "Ranked", target: "3 nonstops under $900", sub: "cheapest = ANA NH7 · $842" },
  { kind: "say", agent: "quill", wait: 700, text: "3 nonstop options clear the budget. Cheapest is **ANA NH7 at $842**, departs 10:55, 10h 35m, 92% on-time." },
  { kind: "result", result: ANA, wait: 500 },
  { kind: "planStep", i: 2, state: "done", wait: 200 },

  { kind: "handoff", from: "quill", to: "sage", wait: 800 },
  { kind: "say", agent: "sage", wait: 800, text: "My pick is **ANA NH7** — cheapest nonstop and the best on-time record of the three. Continue to passenger details?" },
  { kind: "confirm", agent: "sage", wait: 400, confirm: "Yes, continue", decline: "Let me choose" },
  { kind: "planStep", i: 3, state: "done", wait: 100 },

  { kind: "handoff", from: "sage", to: "forge", wait: 700 },
  { kind: "actGroup", agent: "forge", title: "Filling passenger details", wait: 450 },
  { kind: "act", agent: "forge", wait: 900, verb: "Selected", target: "ANA NH7 · $842", sub: "added to booking" },
  { kind: "act", agent: "forge", wait: 1000, verb: "Filled", target: "Passenger name", sub: "from your profile" },
  { kind: "act", agent: "forge", wait: 950, verb: "Filled", target: "Frequent flyer #", sub: "Mileage Club · ••• 4471" },
  { kind: "act", agent: "forge", wait: 1000, verb: "Selected", target: "Seat 14A", sub: "window · forward cabin" },
  { kind: "planStep", i: 4, state: "done", wait: 200 },

  { kind: "takeover", agent: "forge", wait: 500, text: "Everything's filled — but **payment needs your card**, so I'll hand control back to you here." },
  { kind: "status", run: "done", wait: 200 },
  { kind: "say", agent: "sage", wait: 600, text: "Done — ANA NH7, window seat 14A, $842, ready at checkout. Want me to set a price-drop watch on the return leg too?" },
];
