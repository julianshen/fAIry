import { createRoot } from "react-dom/client";
import "./styles/index.css";
import "./harness/harness.css";
import { Harness } from "./harness/Harness";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// No StrictMode here: the harness's scripted runner schedules real timers
// imperatively, which StrictMode's intentional double-invoke would duplicate.
// The shipped Panel/engine are StrictMode-safe (pure render + reducer).
createRoot(root).render(<Harness />);
