import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Feed } from "./Feed";
import type { FeedItem } from "../types";

describe("Feed", () => {
  it("dispatches each item type to its renderer and tags the chat layout", () => {
    const items: FeedItem[] = [
      { type: "user", key: 1, text: "go" },
      { type: "say", key: 2, agent: "sage", text: "on it" },
      { type: "thinking", key: 3, agent: "atlas" },
      { type: "handoff", key: 4, from: "sage", to: "atlas" },
      { type: "plan", key: 5, steps: [{ txt: "step", who: "atlas", state: "pending" }] },
      { type: "actions", key: 6, agent: "atlas", title: "Nav", open: true, running: false, rows: [] },
    ];
    const { container } = render(
      <Feed
        items={items}
        chat="flat"
        actionStyle="timeline"
        onAnswer={() => {}}
        onTake={() => {}}
        onToggleActions={() => {}}
      />,
    );
    expect(container.querySelector(".feed")).toHaveAttribute("data-chat", "flat");
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(container.querySelector(".typing")).not.toBeNull();
    expect(container.querySelector(".handoff")).not.toBeNull();
    expect(container.querySelector(".plan")).not.toBeNull();
    expect(container.querySelector(".actions")).not.toBeNull();
  });

  it("routes confirm answers with the item key", async () => {
    const onAnswer = vi.fn();
    const items: FeedItem[] = [
      { type: "confirm", key: 9, agent: "sage", confirm: "Yes", decline: "No", answered: false },
    ];
    render(
      <Feed
        items={items}
        chat="flat"
        actionStyle="timeline"
        onAnswer={onAnswer}
        onTake={() => {}}
        onToggleActions={() => {}}
      />,
    );
    await userEvent.click(screen.getByText("Yes"));
    expect(onAnswer).toHaveBeenCalledWith(9, "Yes");
  });

  it("routes takeover and action-toggle callbacks with the item key", async () => {
    const onTake = vi.fn();
    const onToggleActions = vi.fn();
    const items: FeedItem[] = [
      { type: "actions", key: 6, agent: "atlas", title: "Nav", open: true, running: false, rows: [] },
      { type: "takeover", key: 7, agent: "forge", text: "your turn", taken: false },
    ];
    render(
      <Feed
        items={items}
        chat="flat"
        actionStyle="timeline"
        onAnswer={() => {}}
        onTake={onTake}
        onToggleActions={onToggleActions}
      />,
    );
    await userEvent.click(screen.getByText("Nav", { exact: false }));
    expect(onToggleActions).toHaveBeenCalledWith(6);
    await userEvent.click(screen.getByRole("button", { name: /take over/i }));
    expect(onTake).toHaveBeenCalledWith(7);
  });
});
