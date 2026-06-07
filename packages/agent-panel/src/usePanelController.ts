import { useCallback, useEffect, useReducer, useState } from "react";
import { initialState, reduce } from "./engine";
import type { Beat, PanelState, RunState } from "./types";

export interface PanelController {
  state: PanelState;
  elapsed: number;
  /** Begin a new task (clears the feed, runs as the orchestrator). */
  start: (task: string) => void;
  /** Push an agent-produced beat into the feed. */
  apply: (beat: Beat) => void;
  /** Set the run lifecycle directly (pause/resume/done). */
  setRun: (run: RunState) => void;
  reset: () => void;
  answer: (key: number, choice: string) => void;
  toggleActions: (key: number) => void;
  take: (key: number) => void;
  resolveProposal: (key: number, accept: boolean) => void;
}

/**
 * Owns panel run state and the elapsed-time counter. The beat *source* is the
 * caller's concern — the dev harness feeds it a script; production feeds it the
 * daemon's agent-event stream — but state shape and timing live here.
 */
export function usePanelController(): PanelController {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state.run !== "running") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state.run]);

  const start = useCallback((task: string) => {
    setElapsed(0);
    dispatch({ kind: "startTask", text: task });
  }, []);

  const apply = useCallback((beat: Beat) => dispatch(beat), []);
  const setRun = useCallback((run: RunState) => dispatch({ kind: "status", run }), []);
  const reset = useCallback(() => {
    setElapsed(0);
    dispatch({ kind: "reset" });
  }, []);
  const answer = useCallback(
    (key: number, choice: string) => dispatch({ kind: "answerConfirm", key, choice }),
    [],
  );
  const toggleActions = useCallback((key: number) => dispatch({ kind: "toggleActions", key }), []);
  const take = useCallback((key: number) => dispatch({ kind: "takeItem", key }), []);
  const resolveProposal = useCallback(
    (key: number, accept: boolean) => dispatch({ kind: "resolveProposal", key, accept }),
    [],
  );

  return {
    state,
    elapsed,
    start,
    apply,
    setRun,
    reset,
    answer,
    toggleActions,
    take,
    resolveProposal,
  };
}
