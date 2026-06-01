import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";
import { AGENTS, AGENT_ORDER } from "../agents";
import type { SuggestionGroup } from "../types";

const GROUPS: SuggestionGroup[] = [
  {
    cap: "Pick up where you'd start",
    items: [
      { id: "flight", icon: "plane", title: "Book a flight", sub: "SFO → HND", task: "book the flight" },
      { id: "extract", icon: "table", title: "Extract to a table", sub: "every fare", task: "extract the fares" },
    ],
  },
];

describe("EmptyState — suggestions", () => {
  it("lists suggestions and sends the task on click", async () => {
    const onPick = vi.fn();
    render(<EmptyState variant="suggestions" suggestions={GROUPS} onPick={onPick} />);
    expect(screen.getByText("Book a flight")).toBeInTheDocument();
    expect(screen.getByText("Extract to a table")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Book a flight"));
    expect(onPick).toHaveBeenCalledWith("book the flight");
  });
});

describe("EmptyState — hero", () => {
  it("renders the hero greeting and chips that send tasks", async () => {
    const onPick = vi.fn();
    const { container } = render(
      <EmptyState variant="hero" suggestions={GROUPS} onPick={onPick} />,
    );
    expect(container.querySelector('[data-empty="hero"]')).not.toBeNull();
    await userEvent.click(screen.getByText("Book a flight"));
    expect(onPick).toHaveBeenCalledWith("book the flight");
  });
});

describe("EmptyState — grid", () => {
  it("shows the whole agent team and a featured suggestion", async () => {
    const onPick = vi.fn();
    const { container } = render(
      <EmptyState variant="grid" suggestions={GROUPS} onPick={onPick} />,
    );
    expect(container.querySelector('[data-empty="grid"]')).not.toBeNull();
    for (const id of AGENT_ORDER) {
      expect(screen.getByText(AGENTS[id].name)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByText("Book a flight"));
    expect(onPick).toHaveBeenCalledWith("book the flight");
  });
});
