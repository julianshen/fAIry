import { initialState, reduce, counts } from "./engine";
import type { FeedItem, PanelState, ResultCard } from "./types";

const RESULT: ResultCard = {
  by: "Pythagoras's pick",
  badge: "NH",
  badgeColor: "#1e3a8a",
  title: "10:55 → 14:30+1",
  sub: "ANA NH7 · 10h 35m · Nonstop · 92% on-time",
  price: "$842",
  tag: "cheapest nonstop",
};

/** Apply a sequence of actions from the initial state. */
function run(...actions: Parameters<typeof reduce>[1][]): PanelState {
  return actions.reduce((s, a) => reduce(s, a), initialState());
}

function only<T extends FeedItem["type"]>(s: PanelState, type: T) {
  return s.items.filter((i) => i.type === type) as Extract<
    FeedItem,
    { type: T }
  >[];
}

describe("initialState", () => {
  it("starts empty, idle, with no active agent", () => {
    const s = initialState();
    expect(s.items).toEqual([]);
    expect(s.run).toBe("idle");
    expect(s.active).toBeNull();
    expect(s.seq).toBe(0);
  });
});

describe("reduce — message beats", () => {
  it("appends a user message with a stable incrementing key", () => {
    const s = run({ kind: "user", text: "book a flight" });
    expect(s.items).toHaveLength(1);
    const item = s.items[0]!;
    expect(item).toMatchObject({ type: "user", text: "book a flight" });
    expect(item.key).toBe(1);
    expect(s.seq).toBe(1);
  });

  it("adds a thinking indicator and marks that agent active", () => {
    const s = run({ kind: "thinking", agent: "sage" });
    expect(only(s, "thinking")).toHaveLength(1);
    expect(s.active).toBe("sage");
  });

  it("replaces a trailing thinking indicator with the say, reusing its key", () => {
    const s = run(
      { kind: "thinking", agent: "sage" },
      { kind: "say", agent: "sage", text: "on it", time: "3:00 PM" },
    );
    expect(only(s, "thinking")).toHaveLength(0);
    const says = only(s, "say");
    expect(says).toHaveLength(1);
    expect(says[0]).toMatchObject({ text: "on it", time: "3:00 PM", agent: "sage" });
    expect(says[0]!.key).toBe(1); // reused the thinking item's key
    expect(s.seq).toBe(1); // no new key minted
  });

  it("appends a say with no preceding thinking", () => {
    const s = run({ kind: "say", agent: "quill", text: "ranked them" });
    expect(only(s, "say")).toHaveLength(1);
    expect(s.active).toBe("quill");
  });

  it("only replaces a thinking bubble belonging to the same agent", () => {
    const s = run(
      { kind: "thinking", agent: "atlas" },
      { kind: "say", agent: "quill", text: "different speaker" },
    );
    expect(only(s, "thinking")).toHaveLength(1);
    expect(only(s, "say")).toHaveLength(1);
  });
});

describe("reduce — plan beats", () => {
  it("adds a plan with all steps pending", () => {
    const s = run({
      kind: "plan",
      steps: [
        { txt: "open site", who: "atlas" },
        { txt: "read fares", who: "quill" },
      ],
    });
    const plan = only(s, "plan")[0]!;
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.every((st) => st.state === "pending")).toBe(true);
  });

  it("advances a single plan step by index", () => {
    const s = run(
      { kind: "plan", steps: [{ txt: "a", who: "atlas" }, { txt: "b", who: "quill" }] },
      { kind: "planStep", i: 1, state: "done" },
    );
    const plan = only(s, "plan")[0]!;
    expect(plan.steps[0]!.state).toBe("pending");
    expect(plan.steps[1]!.state).toBe("done");
  });

  it("ignores planStep when there is no plan", () => {
    const s = run({ kind: "planStep", i: 0, state: "done" });
    expect(s.items).toHaveLength(0);
  });
});

describe("reduce — handoff and status", () => {
  it("records a handoff and makes the recipient active", () => {
    const s = run({ kind: "handoff", from: "sage", to: "atlas" });
    expect(only(s, "handoff")[0]).toMatchObject({ from: "sage", to: "atlas" });
    expect(s.active).toBe("atlas");
  });

  it("sets the run state", () => {
    expect(run({ kind: "status", run: "done" }).run).toBe("done");
  });
});

describe("reduce — action log", () => {
  it("opens a running action group", () => {
    const s = run({ kind: "actGroup", agent: "atlas", title: "Navigating" });
    const a = only(s, "actions")[0]!;
    expect(a).toMatchObject({ title: "Navigating", open: true, running: true });
    expect(a.rows).toEqual([]);
    expect(s.active).toBe("atlas");
  });

  it("appends an active row and marks prior rows done", () => {
    const s = run(
      { kind: "actGroup", agent: "atlas", title: "Navigating" },
      { kind: "act", agent: "atlas", verb: "Opened", target: "skylark.com" },
      { kind: "act", agent: "atlas", verb: "Toggled", target: "Nonstop", sub: "filter applied" },
    );
    const rows = only(s, "actions")[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.state).toBe("done");
    expect(rows[1]).toMatchObject({ verb: "Toggled", target: "Nonstop", sub: "filter applied", state: "active" });
  });

  it("ignores act when no group is open", () => {
    const s = run({ kind: "act", agent: "atlas", verb: "Opened", target: "x" });
    expect(only(s, "actions")).toHaveLength(0);
  });

  it("finalizes a running group when a non-action beat arrives", () => {
    const s = run(
      { kind: "actGroup", agent: "atlas", title: "Navigating" },
      { kind: "act", agent: "atlas", verb: "Opened", target: "skylark.com" },
      { kind: "say", agent: "atlas", text: "done navigating" },
    );
    const a = only(s, "actions")[0]!;
    expect(a.running).toBe(false);
    expect(a.rows.every((r) => r.state === "done")).toBe(true);
  });

  it("finalizes the previous group when a new group opens", () => {
    const s = run(
      { kind: "actGroup", agent: "atlas", title: "Navigating" },
      { kind: "act", agent: "atlas", verb: "Opened", target: "x" },
      { kind: "actGroup", agent: "quill", title: "Reading" },
    );
    const groups = only(s, "actions");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.running).toBe(false);
    expect(groups[1]!.running).toBe(true);
  });
});

describe("reduce — result, confirm, takeover", () => {
  it("adds a result card", () => {
    const s = run({ kind: "result", result: RESULT });
    expect(only(s, "result")[0]!.result).toEqual(RESULT);
  });

  it("adds a ui card from a ui beat", () => {
    const s = run({ kind: "ui", a2ui: { type: "text", text: "hello" } });
    const ui = only(s, "ui");
    expect(ui).toHaveLength(1);
    expect(ui[0]!.a2ui).toEqual({ type: "text", text: "hello" });
  });

  it("adds an unanswered confirm and marks the agent active", () => {
    const s = run({ kind: "confirm", agent: "sage", confirm: "Yes", decline: "No" });
    const c = only(s, "confirm")[0]!;
    expect(c).toMatchObject({ confirm: "Yes", decline: "No", answered: false });
    expect(s.active).toBe("sage");
  });

  it("adds an un-taken takeover banner", () => {
    const s = run({ kind: "takeover", agent: "forge", text: "your turn" });
    expect(only(s, "takeover")[0]).toMatchObject({ taken: false, text: "your turn" });
  });
});

describe("reduce — UI actions", () => {
  it("startTask clears the feed and seeds the user message running as sage", () => {
    const seeded = run(
      { kind: "say", agent: "quill", text: "old" },
      { kind: "startTask", text: "new task" },
    );
    expect(seeded.items).toHaveLength(1);
    expect(seeded.items[0]).toMatchObject({ type: "user", text: "new task" });
    expect(seeded.run).toBe("running");
    expect(seeded.active).toBe("sage");
  });

  it("reset returns to the initial state", () => {
    const s = run(
      { kind: "user", text: "x" },
      { kind: "status", run: "running" },
      { kind: "reset" },
    );
    expect(s).toEqual(initialState());
  });

  it("answerConfirm records the choice on the matching item", () => {
    const base = run({ kind: "confirm", agent: "sage", confirm: "Yes", decline: "No" });
    const key = only(base, "confirm")[0]!.key;
    const s = reduce(base, { kind: "answerConfirm", key, choice: "Yes" });
    const c = only(s, "confirm")[0]!;
    expect(c.answered).toBe(true);
    expect(c.choice).toBe("Yes");
  });

  it("toggleActions flips the open flag of the matching group", () => {
    const base = run({ kind: "actGroup", agent: "atlas", title: "Navigating" });
    const key = only(base, "actions")[0]!.key;
    const s = reduce(base, { kind: "toggleActions", key });
    expect(only(s, "actions")[0]!.open).toBe(false);
    const s2 = reduce(s, { kind: "toggleActions", key });
    expect(only(s2, "actions")[0]!.open).toBe(true);
  });

  it("takeItem marks the takeover banner taken", () => {
    const base = run({ kind: "takeover", agent: "forge", text: "your turn" });
    const key = only(base, "takeover")[0]!.key;
    const s = reduce(base, { kind: "takeItem", key });
    expect(only(s, "takeover")[0]!.taken).toBe(true);
  });

  it("does not mutate the previous state object", () => {
    const a = initialState();
    const b = reduce(a, { kind: "user", text: "x" });
    expect(a.items).toHaveLength(0);
    expect(b).not.toBe(a);
  });
});

describe("reduce — proposal", () => {
  const PROPOSAL = { kind: "skill", name: "checkout", content: "# notes", host: "shop.example" } as const;

  it("a proposal beat appends a proposal feed item", () => {
    const s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
    const it = s.items.at(-1)!;
    expect(it.type).toBe("proposal");
    expect((it as { proposal: unknown }).proposal).toEqual(PROPOSAL);
    expect((it as { resolved?: string }).resolved).toBeUndefined();
  });

  it("drops a malformed proposal beat (renders nothing)", () => {
    // Opaque wire data: a non-object / missing name|content proposal must not
    // produce a feed item (it would crash the card on proposal.content).
    const bads = [
      null,
      "nope",
      { name: "x" },
      { content: "y" },
      { kind: "mystery", name: "x", content: "y" },
      { kind: { obj: 1 }, name: "x", content: "y" },
      { kind: "skill", name: "x", content: "y", host: { obj: 1 } }, // object host → would crash the card
      { kind: "action", name: "x", content: "y", attach: { obj: 1 } }, // object attach
    ];
    for (const bad of bads) {
      const s = reduce(initialState(), { kind: "proposal", proposal: bad as never });
      expect(s.items).toEqual([]);
    }
  });

  it("resolveProposal(accept) marks the item saved", () => {
    let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
    const key = s.items.at(-1)!.key;
    s = reduce(s, { kind: "resolveProposal", key, accept: true });
    expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("saved");
  });

  it("resolveProposal(dismiss) marks the item dismissed", () => {
    let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
    const key = s.items.at(-1)!.key;
    s = reduce(s, { kind: "resolveProposal", key, accept: false });
    expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("dismissed");
  });

  it("resolving an already-resolved proposal is a no-op", () => {
    let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
    const key = s.items.at(-1)!.key;
    s = reduce(s, { kind: "resolveProposal", key, accept: true });
    s = reduce(s, { kind: "resolveProposal", key, accept: false });
    expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("saved");
  });
});

describe("reduce — actions (savedActions)", () => {
  const ACTIONS = [{ name: "reorder", content: "re-buy", attach: "none" as const }];

  it("an actions beat replaces savedActions (non-feed state)", () => {
    const s = reduce(initialState(), { kind: "actions", actions: ACTIONS });
    expect(s.savedActions).toEqual(ACTIONS);
    expect(s.items).toEqual([]); // not a feed item
  });

  it("reset clears the feed but preserves savedActions (the run-chips survive)", () => {
    let s = reduce(initialState(), { kind: "actions", actions: ACTIONS });
    s = reduce(s, { kind: "user", text: "hi" });
    s = reduce(s, { kind: "reset" });
    expect(s.items).toEqual([]);
    expect(s.savedActions).toEqual(ACTIONS);
  });

  it("a second actions beat replaces (not appends)", () => {
    let s = reduce(initialState(), { kind: "actions", actions: ACTIONS });
    s = reduce(s, { kind: "actions", actions: [] });
    expect(s.savedActions).toEqual([]);
  });

  it("drops malformed actions entries (defensive)", () => {
    const s = reduce(initialState(), {
      kind: "actions",
      actions: [{ name: "ok", content: "c", attach: "none" }, { name: 1 }, null, "x"] as never,
    });
    expect(s.savedActions).toEqual([{ name: "ok", content: "c", attach: "none" }]);
  });

  it("ignores a non-array actions payload", () => {
    const s = reduce(initialState(), { kind: "actions", actions: "nope" as never });
    expect(s.savedActions).toEqual([]);
  });
});

describe("counts", () => {
  it("tallies chat, activity rows, and plan steps", () => {
    const s = run(
      { kind: "user", text: "go" },
      { kind: "plan", steps: [{ txt: "a", who: "atlas" }, { txt: "b", who: "quill" }] },
      { kind: "actGroup", agent: "atlas", title: "Nav" },
      { kind: "act", agent: "atlas", verb: "Opened", target: "x" },
      { kind: "act", agent: "atlas", verb: "Clicked", target: "y" },
      { kind: "say", agent: "atlas", text: "hi" },
      { kind: "result", result: RESULT },
      { kind: "ui", a2ui: { type: "text", text: "x" } },
    );
    expect(counts(s.items)).toEqual({ chat: 4, activity: 2, plan: 2 });
  });
});
