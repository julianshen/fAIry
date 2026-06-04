import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Panel } from "./Panel";
import { initialState, reduce } from "../engine";
import type { PanelProps } from "./Panel";
import type { PanelState } from "../types";

function base(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    state: initialState(),
    elapsed: 0,
    onSend: vi.fn(),
    onReset: vi.fn(),
    onPause: vi.fn(),
    onTakeover: vi.fn(),
    onStop: vi.fn(),
    onAnswer: vi.fn(),
    onToggleActions: vi.fn(),
    onTake: vi.fn(),
    onSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

const withItems = (...beats: Parameters<typeof reduce>[1][]): PanelState =>
  beats.reduce((s, b) => reduce(s, b), initialState());

describe("Panel body", () => {
  it("shows the empty state before a task starts", () => {
    render(<Panel {...base()} />);
    expect(screen.getByText(/what should the team do/i)).toBeInTheDocument();
  });

  it("shows the feed once there are items", () => {
    const state = withItems({ kind: "user", text: "go now" });
    const { container } = render(<Panel {...base({ state })} />);
    expect(container.querySelector(".feed")).not.toBeNull();
    expect(screen.getByText("go now")).toBeInTheDocument();
  });
});

describe("Panel config", () => {
  it("applies theme, density, accent, width, and surface style to the root", () => {
    const { container } = render(
      <Panel
        {...base({
          config: { theme: "light", density: "comfy", accent: "#34d3b5", panelW: 400, visualStyle: "solid" },
        })}
      />,
    );
    const root = container.querySelector(".fairy-root") as HTMLElement;
    expect(root).toHaveAttribute("data-theme", "light");
    expect(root).toHaveAttribute("data-density", "comfy");
    expect(root.style.getPropertyValue("--accent")).toBe("#34d3b5");
    expect(root.style.getPropertyValue("--panel-w")).toBe("400px");
    expect(container.querySelector(".panel")).toHaveAttribute("data-style", "solid");
  });
});

describe("Panel composer", () => {
  it("sends typed input through onSend", async () => {
    const onSend = vi.fn();
    render(<Panel {...base({ onSend })} />);
    await userEvent.type(screen.getByPlaceholderText(/ask fairy/i), "do it");
    await userEvent.click(screen.getByTitle("Send"));
    expect(onSend).toHaveBeenCalledWith("do it");
  });

  it("sends a picked suggestion through onSend", async () => {
    const onSend = vi.fn();
    render(<Panel {...base({ onSend })} />);
    await userEvent.click(screen.getByText("Summarize this page"));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("Summarize"));
  });

  it("stops a run through onStop", async () => {
    const onStop = vi.fn();
    const state = withItems({ kind: "user", text: "go" }, { kind: "status", run: "running" });
    render(<Panel {...base({ state, onStop })} />);
    await userEvent.click(screen.getByTitle("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("Panel optional props", () => {
  it("shows the site and model when provided", () => {
    render(<Panel {...base({ site: "skylark.com", model: "Fairy Max" })} />);
    expect(screen.getByText("skylark.com")).toBeInTheDocument();
    expect(screen.getByText("Fairy Max")).toBeInTheDocument();
  });

  it("tolerates missing onSettings/onClose handlers", async () => {
    const props = base();
    delete (props as Partial<PanelProps>).onSettings;
    delete (props as Partial<PanelProps>).onClose;
    render(<Panel {...props} />);
    // Clicking the defaulted no-op handlers must not throw.
    await userEvent.click(screen.getByTitle(/settings/i));
    await userEvent.click(screen.getByTitle(/close/i));
    expect(screen.getByTitle(/close/i)).toBeInTheDocument();
  });
});

describe("Panel header wiring", () => {
  it("routes header controls to their callbacks", async () => {
    const onReset = vi.fn();
    const onSettings = vi.fn();
    const onClose = vi.fn();
    render(<Panel {...base({ onReset, onSettings, onClose })} />);
    await userEvent.click(screen.getByTitle(/new task/i));
    await userEvent.click(screen.getByTitle(/settings/i));
    await userEvent.click(screen.getByTitle(/close/i));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Panel feed wiring", () => {
  it("routes confirm answers to onAnswer with the item key", async () => {
    const onAnswer = vi.fn();
    const state = withItems({ kind: "confirm", agent: "sage", confirm: "Yes", decline: "No" });
    const key = state.items[0]!.key;
    render(<Panel {...base({ state, onAnswer })} />);
    await userEvent.click(screen.getByText("Yes"));
    expect(onAnswer).toHaveBeenCalledWith(key, "Yes");
  });
});

describe("Panel tabs filtering", () => {
  it("filters the feed by the selected tab when the header is tabbed", async () => {
    const state = withItems(
      { kind: "user", text: "go now" },
      { kind: "handoff", from: "sage", to: "atlas" },
      { kind: "actGroup", agent: "atlas", title: "Navigating" },
      { kind: "act", agent: "atlas", verb: "Opened", target: "skylark.com" },
    );
    render(<Panel {...base({ state, config: { headerStyle: "tabs" } })} />);
    // default view = chat → the user message shows, the action group does not
    expect(screen.getByText("go now")).toBeInTheDocument();
    expect(screen.queryByText("Navigating", { exact: false })).toBeNull();
    // switch to activity → the action group shows, the user message hides
    await userEvent.click(screen.getByText("Activity"));
    expect(screen.getByText("Navigating", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("go now")).toBeNull();
  });

  it("keeps ui (A2UI) items in the chat tab, matching their chat count", () => {
    const state = withItems(
      { kind: "ui", a2ui: { type: "text", text: "generated panel" } },
      { kind: "actGroup", agent: "atlas", title: "Navigating" },
    );
    render(<Panel {...base({ state, config: { headerStyle: "tabs" } })} />);
    // default view = chat → the A2UI message shows (it is counted as chat), the
    // action group does not.
    expect(screen.getByText("generated panel")).toBeInTheDocument();
    expect(screen.queryByText("Navigating", { exact: false })).toBeNull();
  });
});
