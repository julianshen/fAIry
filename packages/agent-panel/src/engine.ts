import type {
  ActRow,
  FeedCounts,
  FeedItem,
  PanelAction,
  PanelState,
} from "./types";

export function initialState(): PanelState {
  return { items: [], run: "idle", active: null, seq: 0 };
}

/** Index of the last item satisfying `pred`, or -1. */
function findLastIndex(items: FeedItem[], pred: (it: FeedItem) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && pred(it)) return i;
  }
  return -1;
}

/** Index of the most recent action group still accepting rows. */
function runningActionsIndex(items: FeedItem[]): number {
  return findLastIndex(items, (it) => it.type === "actions" && it.running);
}

/** Index of the most recent plan card. */
function lastPlanIndex(items: FeedItem[]): number {
  return findLastIndex(items, (it) => it.type === "plan");
}

/** Mark a running action group (if any) complete: rows done, spinner off. */
function finalizeActions(items: FeedItem[]): FeedItem[] {
  // Common case (no open group): nothing to do — avoid the array copy.
  if (runningActionsIndex(items) === -1) return items;
  return items.map((it) =>
    it.type === "actions" && it.running
      ? { ...it, running: false, rows: it.rows.map((r) => ({ ...r, state: "done" })) }
      : it,
  );
}

/**
 * Pure transition. Every transition — agent beat or user action — flows
 * through here, so the panel's whole behavior is reproducible from a list of
 * actions. No timers, no DOM: the React layer schedules beats and this decides
 * the resulting state.
 */
export function reduce(state: PanelState, action: PanelAction): PanelState {
  switch (action.kind) {
    case "reset":
      return initialState();

    case "startTask": {
      const seq = state.seq + 1;
      return {
        items: [{ type: "user", key: seq, text: action.text }],
        run: "running",
        active: "sage",
        seq,
      };
    }

    case "user": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...state.items, { type: "user", key: seq, text: action.text }],
      };
    }

    case "thinking": {
      const seq = state.seq + 1;
      return {
        ...state,
        active: action.agent,
        seq,
        items: [...finalizeActions(state.items), { type: "thinking", key: seq, agent: action.agent }],
      };
    }

    case "say": {
      const items = finalizeActions(state.items);
      const last = items[items.length - 1];
      if (last && last.type === "thinking" && last.agent === action.agent) {
        // Replace the typing bubble in place so the node (and its key) persists.
        const replaced: FeedItem = {
          type: "say",
          key: last.key,
          agent: action.agent,
          text: action.text,
          ...(action.time ? { time: action.time } : {}),
        };
        return {
          ...state,
          active: action.agent,
          items: [...items.slice(0, -1), replaced],
        };
      }
      const seq = state.seq + 1;
      return {
        ...state,
        active: action.agent,
        seq,
        items: [
          ...items,
          {
            type: "say",
            key: seq,
            agent: action.agent,
            text: action.text,
            ...(action.time ? { time: action.time } : {}),
          },
        ],
      };
    }

    case "plan": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          {
            type: "plan",
            key: seq,
            steps: action.steps.map((s) => ({ ...s, state: "pending" })),
          },
        ],
      };
    }

    case "planStep": {
      const items = finalizeActions(state.items);
      const idx = lastPlanIndex(items);
      if (idx === -1) return { ...state, items };
      const plan = items[idx] as Extract<FeedItem, { type: "plan" }>;
      const steps = plan.steps.map((s, i) =>
        i === action.i ? { ...s, state: action.state } : s,
      );
      return { ...state, items: items.map((it, i) => (i === idx ? { ...plan, steps } : it)) };
    }

    case "handoff": {
      const seq = state.seq + 1;
      return {
        ...state,
        active: action.to,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "handoff", key: seq, from: action.from, to: action.to },
        ],
      };
    }

    case "status":
      return { ...state, run: action.run, items: finalizeActions(state.items) };

    case "actGroup": {
      const seq = state.seq + 1;
      return {
        ...state,
        active: action.agent,
        seq,
        items: [
          ...finalizeActions(state.items),
          {
            type: "actions",
            key: seq,
            agent: action.agent,
            title: action.title,
            open: true,
            running: true,
            rows: [],
          },
        ],
      };
    }

    case "act": {
      const idx = runningActionsIndex(state.items);
      if (idx === -1) return state;
      const group = state.items[idx] as Extract<FeedItem, { type: "actions" }>;
      const row: ActRow = {
        verb: action.verb,
        target: action.target,
        ...(action.sub ? { sub: action.sub } : {}),
        state: "active",
      };
      // Only the trailing row can still be "active"; flip just that one
      // instead of re-copying every prior (already-done) row.
      const prev = group.rows;
      const last = prev[prev.length - 1];
      const rows: ActRow[] =
        last && last.state !== "done"
          ? [...prev.slice(0, -1), { ...last, state: "done" }, row]
          : [...prev, row];
      return {
        ...state,
        active: action.agent,
        items: state.items.map((it, i) => (i === idx ? { ...group, rows } : it)),
      };
    }

    case "result": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "result", key: seq, result: action.result },
        ],
      };
    }

    case "ui": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "ui", key: seq, a2ui: action.a2ui },
        ],
      };
    }

    case "confirm": {
      const seq = state.seq + 1;
      return {
        ...state,
        active: action.agent,
        seq,
        items: [
          ...finalizeActions(state.items),
          {
            type: "confirm",
            key: seq,
            agent: action.agent,
            confirm: action.confirm,
            decline: action.decline,
            answered: false,
          },
        ],
      };
    }

    case "takeover": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "takeover", key: seq, agent: action.agent, text: action.text, taken: false },
        ],
      };
    }

    case "proposal": {
      // The panel is the trust boundary for opaque wire data: drop a malformed
      // proposal (non-object / missing name|content) rather than render a card
      // that would crash on `proposal.content`. Mirrors the a2ui fallback stance.
      const p = action.proposal as
        | { kind?: unknown; name?: unknown; content?: unknown; host?: unknown; attach?: unknown }
        | null;
      // Every field the card renders must be safe — a non-string host/attach would
      // throw "Objects are not valid as a React child" in ProposalCard.
      if (
        typeof p !== "object" ||
        p === null ||
        (p.kind !== "skill" && p.kind !== "action") ||
        typeof p.name !== "string" ||
        typeof p.content !== "string" ||
        (p.host !== undefined && typeof p.host !== "string") ||
        (p.attach !== undefined && typeof p.attach !== "string")
      ) {
        return state;
      }
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...finalizeActions(state.items), { type: "proposal", key: seq, proposal: action.proposal }],
      };
    }

    case "resolveProposal":
      return {
        ...state,
        items: state.items.map((it) =>
          it.type === "proposal" && it.key === action.key && it.resolved === undefined
            ? { ...it, resolved: action.accept ? "saved" : "dismissed" }
            : it,
        ),
      };

    case "answerConfirm":
      return {
        ...state,
        items: state.items.map((it) =>
          it.type === "confirm" && it.key === action.key
            ? { ...it, answered: true, choice: action.choice }
            : it,
        ),
      };

    case "toggleActions":
      return {
        ...state,
        items: state.items.map((it) =>
          it.type === "actions" && it.key === action.key ? { ...it, open: !it.open } : it,
        ),
      };

    case "takeItem":
      return {
        ...state,
        items: state.items.map((it) =>
          it.type === "takeover" && it.key === action.key ? { ...it, taken: true } : it,
        ),
      };
  }
}

/** Tally for the optional tabbed header (chat / activity / plan). */
export function counts(items: FeedItem[]): FeedCounts {
  let chat = 0;
  let activity = 0;
  let plan = 0;
  for (const it of items) {
    if (it.type === "user" || it.type === "say" || it.type === "result" || it.type === "confirm" || it.type === "takeover" || it.type === "ui" || it.type === "proposal") {
      chat += 1;
    } else if (it.type === "actions") {
      activity += it.rows.length;
    } else if (it.type === "plan") {
      plan += it.steps.length;
    }
  }
  return { chat, activity, plan };
}
