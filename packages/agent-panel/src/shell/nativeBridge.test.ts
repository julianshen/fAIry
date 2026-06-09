import { describe, it, expect, vi } from "vitest";
import { createNativeBridge } from "./nativeBridge";

describe("createNativeBridge", () => {
  it("start posts a start command with the task", () => {
    const post = vi.fn();
    createNativeBridge(post).start("do it");
    expect(post).toHaveBeenCalledWith({ type: "start", task: "do it" });
  });
  it("stop posts a stop command", () => {
    const post = vi.fn();
    createNativeBridge(post).stop();
    expect(post).toHaveBeenCalledWith({ type: "stop" });
  });
  it("resolveProposal posts the proposal verbatim", () => {
    const post = vi.fn();
    const proposal = { kind: "skill", name: "x" };
    createNativeBridge(post).resolveProposal(proposal);
    expect(post).toHaveBeenCalledWith({ type: "resolveProposal", proposal });
  });
});
