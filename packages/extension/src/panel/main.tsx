import { Panel, usePanelController, type Beat } from "@fairy/agent-panel";
import "@fairy/agent-panel/styles";
import { StrictMode, useEffect, useRef, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { connectConversation, type ConversationClient } from "../conversationClient";
import { loadConnection } from "../connection";

function App(): ReactElement {
  const controller = usePanelController();
  const clientRef = useRef<ConversationClient | null>(null);

  // Connect to the daemon's conversation WS once (using the paired connection)
  // and stream its beats into the panel controller.
  useEffect(() => {
    let cancelled = false;
    let client: ConversationClient | undefined;
    loadConnection()
      .then((conn) => {
        if (cancelled || !conn) return; // unmounted before the read resolved
        client = connectConversation({
          url: `ws://127.0.0.1:${conn.conversationPort}`,
          token: conn.token,
          onBeat: (beat) => controller.apply(beat as Beat),
        });
        clientRef.current = client;
      })
      .catch((err) => console.error("[fairy] could not load the paired connection", err));
    return () => {
      cancelled = true;
      client?.close();
    };
    // controller.apply is stable (useCallback); connect only on mount.
  }, [controller.apply]);

  const send = (task: string): void => {
    controller.reset(); // clear the previous run; the daemon re-echoes the task as a beat
    clientRef.current?.start(task);
  };
  const stop = (): void => clientRef.current?.stop();

  return (
    <Panel
      state={controller.state}
      elapsed={controller.elapsed}
      onSend={send}
      onReset={controller.reset}
      onPause={stop}
      onTakeover={stop}
      onStop={stop}
      onAnswer={controller.answer}
      onToggleActions={controller.toggleActions}
      onTake={controller.take}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
