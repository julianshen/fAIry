import { useCallback, useRef } from "react";
import { usePanelController } from "../usePanelController";
import type { PanelProps } from "../components/Panel";
import { SCRIPT } from "./script";

const nowTime = (): string =>
  new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

interface SimState {
  cancelled: boolean;
  paused: boolean;
  resumeIdx: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Dev-only driver: plays the scripted run through the real controller so every
 * panel state can be eyeballed. Production replaces this with a feed of beats
 * from the pi-daemon — the Panel and controller stay identical.
 */
export function useSimulation(): PanelProps {
  const ctrl = usePanelController();
  const sim = useRef<SimState>({ cancelled: false, paused: false, resumeIdx: 0, timer: undefined });
  const runRef = useRef<(i: number) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (sim.current.timer) clearTimeout(sim.current.timer);
    sim.current.timer = undefined;
  }, []);

  const runFrom = useCallback(
    (i: number) => {
      const st = sim.current;
      if (st.cancelled || st.paused) {
        st.resumeIdx = i;
        return;
      }
      if (i >= SCRIPT.length) return;
      const beat = SCRIPT[i]!;
      st.resumeIdx = i;
      st.timer = setTimeout(() => {
        if (st.cancelled || st.paused) return;
        if (beat.kind === "say") {
          // Two-step: typing indicator, then the message.
          ctrl.apply({ kind: "thinking", agent: beat.agent });
          st.timer = setTimeout(() => {
            if (st.cancelled || st.paused) return;
            ctrl.apply({ kind: "say", agent: beat.agent, text: beat.text, time: nowTime() });
            runRef.current(i + 1);
          }, 620);
          return;
        }
        ctrl.apply(beat);
        if (beat.kind === "confirm") {
          // Hold until the user answers (onAnswer resumes).
          st.resumeIdx = i + 1;
          return;
        }
        runRef.current(i + 1);
      }, beat.wait ?? 400);
    },
    [ctrl],
  );
  runRef.current = runFrom;

  const start = useCallback(
    (task: string) => {
      clearTimer();
      sim.current = { cancelled: false, paused: false, resumeIdx: 0, timer: undefined };
      ctrl.start(task);
      sim.current.timer = setTimeout(() => runRef.current(0), 30);
    },
    [ctrl, clearTimer],
  );

  const togglePause = useCallback(() => {
    const st = sim.current;
    if (st.paused) {
      st.paused = false;
      ctrl.setRun("running");
      runRef.current(st.resumeIdx);
    } else {
      st.paused = true;
      clearTimer();
      ctrl.setRun("paused");
    }
  }, [ctrl, clearTimer]);

  const halt = useCallback(() => {
    sim.current.paused = true;
    clearTimer();
    ctrl.setRun("paused");
  }, [ctrl, clearTimer]);

  const reset = useCallback(() => {
    sim.current.cancelled = true;
    clearTimer();
    ctrl.reset();
  }, [ctrl, clearTimer]);

  const answer = useCallback(
    (key: number, choice: string) => {
      ctrl.answer(key, choice);
      const affirmative = /yes|continue/i.test(choice);
      if (affirmative) {
        sim.current.paused = false;
        runRef.current(sim.current.resumeIdx);
      } else {
        halt();
      }
    },
    [ctrl, halt],
  );

  return {
    state: ctrl.state,
    elapsed: ctrl.elapsed,
    site: "skylark.com",
    onSend: start,
    onReset: reset,
    onPause: togglePause,
    onTakeover: halt,
    onStop: halt,
    onAnswer: answer,
    onToggleActions: ctrl.toggleActions,
    onTake: ctrl.take,
    onResolveProposal: (item, accept) => ctrl.resolveProposal(item.key, accept),
  };
}
