import { renderHook, act } from "@testing-library/react";
import { usePanelController } from "./usePanelController";
import { initialState } from "./engine";

describe("usePanelController", () => {
  it("starts from the empty idle state", () => {
    const { result } = renderHook(() => usePanelController());
    expect(result.current.state).toEqual(initialState());
    expect(result.current.elapsed).toBe(0);
  });

  it("start() seeds a running task", () => {
    const { result } = renderHook(() => usePanelController());
    act(() => result.current.start("go now"));
    expect(result.current.state.run).toBe("running");
    expect(result.current.state.active).toBe("sage");
    expect(result.current.state.items[0]).toMatchObject({ type: "user", text: "go now" });
  });

  it("apply() pushes an agent beat into the feed", () => {
    const { result } = renderHook(() => usePanelController());
    act(() => result.current.apply({ kind: "say", agent: "sage", text: "on it" }));
    expect(result.current.state.items.some((i) => i.type === "say")).toBe(true);
  });

  it("answer(), toggleActions(), and take() drive item interactions", () => {
    const { result } = renderHook(() => usePanelController());
    act(() => result.current.apply({ kind: "confirm", agent: "sage", confirm: "Yes", decline: "No" }));
    const confirmKey = result.current.state.items[0]!.key;
    act(() => result.current.answer(confirmKey, "Yes"));
    expect(result.current.state.items[0]).toMatchObject({ answered: true, choice: "Yes" });
  });

  it("reset() clears everything", () => {
    const { result } = renderHook(() => usePanelController());
    act(() => result.current.start("go"));
    act(() => result.current.reset());
    expect(result.current.state).toEqual(initialState());
    expect(result.current.elapsed).toBe(0);
  });

  it("counts elapsed seconds only while running", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => usePanelController());
      act(() => result.current.start("go"));
      act(() => vi.advanceTimersByTime(3000));
      expect(result.current.elapsed).toBe(3);

      act(() => result.current.setRun("paused"));
      act(() => vi.advanceTimersByTime(5000));
      expect(result.current.elapsed).toBe(3); // frozen while paused
    } finally {
      vi.useRealTimers();
    }
  });
});
