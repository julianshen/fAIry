import { StrictMode, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { saveConnection } from "../connection";
import { discover } from "../discovery";

// The daemon's fixed HTTP anchor (FAIRY_HTTP_PORT default). The pairing code is
// redeemed here for the token, then /info gives the WS ports (see discover()).
const DAEMON_HTTP_BASE = "http://127.0.0.1:51789";

function Options(): ReactElement {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const pair = async (): Promise<void> => {
    setBusy(true);
    setStatus("Pairing…");
    try {
      const conn = await discover({ httpBase: DAEMON_HTTP_BASE, code: code.trim() });
      await saveConnection(conn);
      setStatus("Paired! Open Fairy from the toolbar.");
    } catch (err) {
      setStatus(`Pairing failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 440 }}>
      <h1 style={{ fontSize: 20 }}>Pair Fairy</h1>
      <p>Paste the pairing code shown by the Fairy app, then click Pair.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="pairing code"
        spellCheck={false}
        style={{ width: "100%", padding: 8, fontFamily: "monospace", boxSizing: "border-box" }}
      />
      <button onClick={pair} disabled={busy || code.trim() === ""} style={{ marginTop: 12, padding: "8px 16px" }}>
        Pair
      </button>
      {status !== "" && <p style={{ marginTop: 12 }}>{status}</p>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
