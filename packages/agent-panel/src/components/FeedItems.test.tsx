import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
  UiItem,
} from "./FeedItems";
import { AGENTS } from "../agents";
import type { FeedItem, ResultCard } from "../types";

type Item<T extends FeedItem["type"]> = Extract<FeedItem, { type: T }>;

describe("MsgItem", () => {
  it("renders a user message with no agent meta", () => {
    const item: Item<"user"> = { type: "user", key: 1, text: "book a flight" };
    const { container } = render(<MsgItem item={item} />);
    expect(screen.getByText("book a flight")).toBeInTheDocument();
    expect(container.querySelector(".msg-name")).toBeNull();
    expect(container.querySelector(".msg.user")).not.toBeNull();
  });

  it("renders an agent message with name, role, time, and bold formatting", () => {
    const item: Item<"say"> = {
      type: "say",
      key: 2,
      agent: "quill",
      text: "cheapest is **ANA**",
      time: "3:00 PM",
    };
    const { container } = render(<MsgItem item={item} />);
    expect(screen.getByText(AGENTS.quill.name)).toBeInTheDocument();
    expect(screen.getByText(AGENTS.quill.role)).toBeInTheDocument();
    expect(screen.getByText("3:00 PM")).toBeInTheDocument();
    expect(container.querySelector("b")).toHaveTextContent("ANA");
  });
});

describe("ThinkingItem", () => {
  it("shows a typing indicator for the agent", () => {
    const item: Item<"thinking"> = { type: "thinking", key: 1, agent: "sage" };
    const { container } = render(<ThinkingItem item={item} />);
    expect(screen.getByText(AGENTS.sage.name)).toBeInTheDocument();
    expect(container.querySelectorAll(".typing i")).toHaveLength(3);
  });
});

describe("HandoffItem", () => {
  it("names both agents in the handoff", () => {
    const item: Item<"handoff"> = { type: "handoff", key: 1, from: "sage", to: "atlas" };
    render(<HandoffItem item={item} />);
    expect(screen.getByText(AGENTS.sage.name)).toBeInTheDocument();
    expect(screen.getByText(AGENTS.atlas.name)).toBeInTheDocument();
    expect(screen.getByText(AGENTS.atlas.role, { exact: false })).toBeInTheDocument();
  });
});

describe("PlanItem", () => {
  it("shows the done badge and per-step state", () => {
    const item: Item<"plan"> = {
      type: "plan",
      key: 1,
      steps: [
        { txt: "open site", who: "atlas", state: "done" },
        { txt: "read fares", who: "quill", state: "pending" },
      ],
    };
    const { container } = render(<PlanItem item={item} />);
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    const steps = container.querySelectorAll(".plan-step");
    expect(steps[0]).toHaveAttribute("data-state", "done");
    expect(steps[1]).toHaveAttribute("data-state", "pending");
    expect(screen.getByText("open site")).toBeInTheDocument();
  });
});

describe("ActionsItem", () => {
  const item: Item<"actions"> = {
    type: "actions",
    key: 1,
    agent: "atlas",
    title: "Navigating",
    open: true,
    running: true,
    rows: [
      { verb: "Opened", target: "skylark.com", sub: "loaded", state: "done" },
      { verb: "Toggled", target: "Nonstop", state: "active" },
    ],
  };

  it("renders title, rows, and a spinner while running", () => {
    const { container } = render(
      <ActionsItem item={item} actionStyle="timeline" onToggle={() => {}} />,
    );
    expect(screen.getByText("Navigating", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(screen.getByText("Nonstop")).toBeInTheDocument();
    expect(container.querySelector(".spin")).not.toBeNull();
    expect(container.querySelector(".actions")).toHaveAttribute("data-open", "1");
  });

  it("shows a chevron (not a spinner) once finished and reflects collapsed state", () => {
    const done = { ...item, running: false, open: false };
    const { container } = render(
      <ActionsItem item={done} actionStyle="timeline" onToggle={() => {}} />,
    );
    expect(container.querySelector(".spin")).toBeNull();
    expect(container.querySelector(".chev")).not.toBeNull();
    expect(container.querySelector(".actions")).toHaveAttribute("data-open", "0");
  });

  it("calls onToggle when the header is clicked", async () => {
    const onToggle = vi.fn();
    render(<ActionsItem item={item} actionStyle="timeline" onToggle={onToggle} />);
    await userEvent.click(screen.getByText("Navigating", { exact: false }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("exposes the header as a keyboard-operable button", async () => {
    const onToggle = vi.fn();
    render(<ActionsItem item={item} actionStyle="timeline" onToggle={onToggle} />);
    const header = screen.getByRole("button", { name: /navigating/i });
    expect(header).toHaveAttribute("tabindex", "0");
    header.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});

describe("ResultItem", () => {
  it("renders the structured result card", () => {
    const result: ResultCard = {
      by: "Pythagoras's pick",
      badge: "NH",
      badgeColor: "#1e3a8a",
      title: "10:55 → 14:30+1",
      sub: "ANA NH7 · Nonstop",
      price: "$842",
      tag: "cheapest nonstop",
    };
    const item: Item<"result"> = { type: "result", key: 1, result };
    render(<ResultItem item={item} />);
    expect(screen.getByText("Pythagoras's pick")).toBeInTheDocument();
    expect(screen.getByText("$842")).toBeInTheDocument();
    expect(screen.getByText("cheapest nonstop")).toBeInTheDocument();
    expect(screen.getByText("NH")).toBeInTheDocument();
  });
});

describe("ConfirmItem", () => {
  const base: Item<"confirm"> = {
    type: "confirm",
    key: 1,
    agent: "sage",
    confirm: "Yes, continue",
    decline: "Let me choose",
    answered: false,
  };

  it("offers both choices and reports the picked one", async () => {
    const onAnswer = vi.fn();
    render(<ConfirmItem item={base} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByText("Yes, continue"));
    expect(onAnswer).toHaveBeenCalledWith("Yes, continue");
  });

  it("shows the recorded choice once answered", () => {
    render(<ConfirmItem item={{ ...base, answered: true, choice: "Yes, continue" }} onAnswer={() => {}} />);
    expect(screen.getByText("Yes, continue", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TakeoverItem", () => {
  const base: Item<"takeover"> = {
    type: "takeover",
    key: 1,
    agent: "forge",
    text: "payment needs your card",
    taken: false,
  };

  it("offers a take-over button that fires onTake", async () => {
    const onTake = vi.fn();
    render(<TakeoverItem item={base} onTake={onTake} />);
    expect(screen.getByText("payment needs your card", { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /take over/i }));
    expect(onTake).toHaveBeenCalledOnce();
  });

  it("hides the button once control has been taken", () => {
    render(<TakeoverItem item={{ ...base, taken: true }} onTake={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("UiItem", () => {
  it("renders the A2UI message inside a ui-item wrapper", () => {
    const item: Item<"ui"> = { type: "ui", key: 1, a2ui: { type: "text", text: "rendered" } };
    const { container } = render(<UiItem item={item} />);
    expect(screen.getByText("rendered")).toBeInTheDocument();
    expect(container.querySelector(".ui-item .a2ui")).not.toBeNull();
  });
});
