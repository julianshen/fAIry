import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalCard } from "./ProposalCard";
import type { SaveProposal } from "../types";

const proposal: SaveProposal = {
  kind: "skill",
  name: "checkout",
  content: "# notes\nstep 1",
  host: "shop.example",
};

describe("ProposalCard", () => {
  it("shows the name, host, a content preview, and Save/Dismiss", () => {
    render(<ProposalCard proposal={proposal} onResolve={() => {}} />);
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText(/shop\.example/)).toBeInTheDocument();
    expect(screen.getByText(/step 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("truncates the preview to the first few lines", () => {
    const long: SaveProposal = {
      ...proposal,
      content: ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"].join("\n"),
    };
    const { container } = render(<ProposalCard proposal={long} onResolve={() => {}} />);
    const pre = container.querySelector(".proposal-preview");
    expect(pre?.textContent).toContain("l6");
    expect(pre?.textContent).not.toContain("l7");
  });

  it("shows the attach line only for action proposals", () => {
    const action: SaveProposal = { kind: "action", name: "buy", content: "x", attach: "activeTab" };
    render(<ProposalCard proposal={action} onResolve={() => {}} />);
    expect(screen.getByText(/activeTab/)).toBeInTheDocument();
  });

  it("calls onResolve(true) on Save and onResolve(false) on Dismiss", async () => {
    const onResolve = vi.fn();
    render(<ProposalCard proposal={proposal} onResolve={onResolve} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onResolve.mock.calls).toEqual([[true], [false]]);
  });

  it("disables the buttons and reflects the saved label once resolved", () => {
    render(<ProposalCard proposal={proposal} resolved="saved" onResolve={() => {}} />);
    const save = screen.getByRole("button", { name: /saved/i }) as HTMLButtonElement;
    const dismiss = screen.getByRole("button", { name: /dismiss/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(dismiss.disabled).toBe(true);
  });

  it("reflects the dismissed label once dismissed", () => {
    render(<ProposalCard proposal={proposal} resolved="dismissed" onResolve={() => {}} />);
    const dismiss = screen.getByRole("button", { name: /dismissed/i }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);
  });
});
