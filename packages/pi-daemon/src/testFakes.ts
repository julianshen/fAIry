import { EventEmitter } from "node:events";
import type { ChildLike, ReadableLine } from "./jsonLineProcess";

// Shared test doubles for the "Pi never emits output" case — enough to exercise
// wiring (server bring-up, auth, the synchronous opening beats) without a real
// `pi` binary. Tests that DRIVE Pi output (piSession/conversation/jsonLineProcess)
// keep their own richer fakes — don't fold those in here.

/** A readable stream that never emits. */
export class SilentStream extends EventEmitter implements ReadableLine {
  setEncoding(): void {}
}

/** A Pi child that accepts writes but never produces output or exits. */
export class SilentChild extends EventEmitter implements ChildLike {
  stdout = new SilentStream();
  stderr = new SilentStream();
  stdin = { write: (): void => {} };
  kill(): boolean {
    return true;
  }
}

/** A {@link import("./jsonLineProcess").Spawner} yielding a fresh silent child. */
export const silentSpawn = (): ChildLike => new SilentChild();
