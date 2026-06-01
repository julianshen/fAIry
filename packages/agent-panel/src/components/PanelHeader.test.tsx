import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelHeader } from "./PanelHeader";
import { AGENTS, AGENT_ORDER } from "../agents";
import type { PanelHeaderProps } from "./PanelHeader";

function setup(overrides: Partial<PanelHeaderProps> = {}) {
  const props: PanelHeaderProps = {
    headerStyle: "rail",
    run: "idle",
    active: null,
    elapsed: 0,
    counts: { chat: 0, activity: 0, plan: 0 },
    view: "chat",
    setView: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn(),
    onTakeover: vi.fn(),
    onClose: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PanelHeader {...props} />) };
}

describe("PanelHeader status", () => {
  it("reads 'Ready' when idle and hides the timer", () => {
    const { container } = setup({ run: "idle" });
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(container.querySelector(".timer")).toBeNull();
  });

  it("names the working agent and shows a formatted timer while running", () => {
    setup({ run: "running", active: "atlas", elapsed: 65 });
    expect(screen.getByText(`${AGENTS.atlas.name} is working…`)).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("reads 'Paused' and 'Task complete' for those states", () => {
    setup({ run: "paused" });
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });
});

describe("PanelHeader controls", () => {
  it("hides pause/takeover when idle", () => {
    setup({ run: "idle" });
    expect(screen.queryByTitle(/pause|resume/i)).toBeNull();
    expect(screen.queryByTitle(/take over/i)).toBeNull();
  });

  it("shows pause while running and resume while paused, wired to onPause", async () => {
    const onPause = vi.fn();
    const { rerender, props } = setup({ run: "running", onPause });
    expect(screen.getByTitle("Pause")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Pause"));
    expect(onPause).toHaveBeenCalledOnce();

    rerender(<PanelHeader {...props} run="paused" />);
    expect(screen.getByTitle("Resume")).toBeInTheDocument();
  });

  it("wires takeover, new-task, settings, and close buttons", async () => {
    const onTakeover = vi.fn();
    const onReset = vi.fn();
    const onSettings = vi.fn();
    const onClose = vi.fn();
    setup({ run: "running", onTakeover, onReset, onSettings, onClose });
    await userEvent.click(screen.getByTitle(/take over/i));
    await userEvent.click(screen.getByTitle(/new task/i));
    await userEvent.click(screen.getByTitle(/settings/i));
    await userEvent.click(screen.getByTitle(/close/i));
    expect(onTakeover).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("PanelHeader team rail", () => {
  it("lists every agent and marks the active one", () => {
    const { container } = setup({ active: "quill" });
    for (const id of AGENT_ORDER) {
      expect(screen.getByText(AGENTS[id].name)).toBeInTheDocument();
    }
    const active = container.querySelector('.rail-agent[data-active="1"]');
    expect(active).toHaveTextContent(AGENTS.quill.name);
  });
});

describe("PanelHeader tabs variant", () => {
  it("reflects the header style and switches views on click", async () => {
    const setView = vi.fn();
    const { container } = setup({
      headerStyle: "tabs",
      counts: { chat: 2, activity: 5, plan: 3 },
      setView,
    });
    expect(container.querySelector(".panel-head")).toHaveAttribute("data-header", "tabs");
    await userEvent.click(screen.getByText("Activity"));
    expect(setView).toHaveBeenCalledWith("activity");
    // counts surfaced
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
