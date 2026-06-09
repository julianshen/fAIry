import { Panel, usePanelController, type Beat, type SavedActionView } from "../index";
import "../styles/index.css";
import { StrictMode, useEffect, useRef, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createNativeBridge, type NativeBridge } from "./nativeBridge";

declare global {
  interface Window {
    __fairyBridge?: { onBeat: (beat: unknown) => void };
    webkit?: { messageHandlers?: { fairy?: { postMessage: (msg: unknown) => void } } };
  }
}

function App(): ReactElement {
  const controller = usePanelController();
  const bridgeRef = useRef<NativeBridge | null>(null);

  useEffect(() => {
    // native → JS: the Swift side calls window.__fairyBridge.onBeat(beat) per beat.
    window.__fairyBridge = { onBeat: (beat) => controller.apply(beat as Beat) };
    // JS → native: commands post to the "fairy" handler the shell registered.
    bridgeRef.current = createNativeBridge((msg) => window.webkit?.messageHandlers?.fairy?.postMessage(msg));
    return () => { window.__fairyBridge = undefined; };
  }, [controller.apply]);

  // No chrome tab-binding here (the native shell has no tabs); a browser tool with
  // no extension-bound tab returns the daemon's "no tab bound" as an error beat.
  const send = (task: string): void => { controller.reset(); bridgeRef.current?.start(task); };
  const runAction = (action: SavedActionView): void => { controller.reset(); bridgeRef.current?.start(action.content); };
  const stop = (): void => bridgeRef.current?.stop();

  return (
    <Panel
      state={controller.state}
      elapsed={controller.elapsed}
      onSend={send}
      onRunAction={runAction}
      onReset={controller.reset}
      onPause={stop}
      onTakeover={stop}
      onStop={stop}
      onAnswer={controller.answer}
      onToggleActions={controller.toggleActions}
      onTake={controller.take}
      onResolveProposal={(item, accept) => {
        controller.resolveProposal(item.key, accept);
        if (accept) bridgeRef.current?.resolveProposal(item.proposal);
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
