import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer";
import type { ComposerProps } from "./Composer";

function setup(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    value: "",
    setValue: vi.fn(),
    onSend: vi.fn(),
    running: false,
    onStop: vi.fn(),
    planFirst: true,
    setPlanFirst: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<Composer {...props} />) };
}

describe("Composer input", () => {
  it("shows the placeholder and current value", () => {
    setup({ value: "draft text" });
    const input = screen.getByPlaceholderText(/ask fairy/i) as HTMLTextAreaElement;
    expect(input.value).toBe("draft text");
  });

  it("reports edits through setValue", async () => {
    const setValue = vi.fn();
    setup({ setValue });
    await userEvent.type(screen.getByPlaceholderText(/ask fairy/i), "a");
    expect(setValue).toHaveBeenCalledWith("a");
  });
});

describe("Composer sending", () => {
  it("sends the trimmed value on Enter", async () => {
    const onSend = vi.fn();
    setup({ value: "  go now  ", onSend });
    const input = screen.getByPlaceholderText(/ask fairy/i);
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("go now");
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    setup({ value: "go", onSend });
    screen.getByPlaceholderText(/ask fairy/i).focus();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button when empty", () => {
    setup({ value: "   " });
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  it("sends on click when there is content", async () => {
    const onSend = vi.fn();
    setup({ value: "hello", onSend });
    await userEvent.click(screen.getByTitle("Send"));
    expect(onSend).toHaveBeenCalledWith("hello");
  });
});

describe("Composer while running", () => {
  it("swaps send for a stop button and ignores Enter", async () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    setup({ value: "queued", running: true, onStop, onSend });
    expect(screen.queryByTitle("Send")).toBeNull();
    screen.getByPlaceholderText(/ask fairy/i).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTitle("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("Composer plan-first toggle", () => {
  it("reflects and flips the plan-first preference", async () => {
    const setPlanFirst = vi.fn();
    const { container } = setup({ planFirst: true, setPlanFirst });
    const pill = container.querySelector('.comp-pill[data-on="1"]');
    expect(pill).not.toBeNull();
    await userEvent.click(screen.getByText(/plan first/i));
    expect(setPlanFirst).toHaveBeenCalledWith(false);
  });
});

describe("Composer site pill", () => {
  it("shows the current site when provided", () => {
    setup({ site: "skylark.com" });
    expect(screen.getByText("skylark.com")).toBeInTheDocument();
  });

  it("omits the site pill when not provided", () => {
    const { container } = setup();
    expect(container.querySelector(".comp-pill .icon-globe")).toBeNull();
  });
});
