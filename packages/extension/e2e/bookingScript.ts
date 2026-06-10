/** The deterministic booking sequence fake-pi replays on the demo flight site.
 *  Coordinates are the fixed element centers from fixtures/flight-site (a fixed
 *  viewport). click focuses a field; type fills the focused field. */
export function bookingScript(fixtureUrl: string): Array<{ tool: string; args: Record<string, unknown> }> {
  return [
    { tool: "navigate", args: { url: fixtureUrl } },
    { tool: "click", args: { x: 160, y: 94 } },   // #from
    { tool: "type", args: { text: "SFO" } },
    { tool: "click", args: { x: 160, y: 144 } },  // #to
    { tool: "type", args: { text: "JFK" } },
    { tool: "click", args: { x: 160, y: 194 } },  // #date
    { tool: "type", args: { text: "2026-07-01" } },
    { tool: "click", args: { x: 140, y: 246 } },  // #search
    { tool: "click", args: { x: 260, y: 305 } },  // #select-0 (first result)
    { tool: "click", args: { x: 140, y: 446 } },  // #book
  ];
}
