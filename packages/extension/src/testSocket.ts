import type { ClientSocket } from "./socket";

/**
 * A controllable {@link ClientSocket} for tests: drive `open`/`message`/`close`
 * from the test and inspect what was `sent`. Shared by the client tests.
 */
export class FakeSocket implements ClientSocket {
  sent: string[] = [];
  closed = false;
  private openCb?: () => void;
  private msgCb?: (d: string) => void;
  private closeCb?: () => void;

  send(data: string): void {
    this.sent.push(data);
  }
  onOpen(h: () => void): void {
    this.openCb = h;
  }
  onMessage(h: (d: string) => void): void {
    this.msgCb = h;
  }
  onClose(h: () => void): void {
    this.closeCb = h;
  }
  close(): void {
    this.closed = true;
  }

  // ─── test drivers ───
  fireOpen(): void {
    this.openCb?.();
  }
  fireMessage(value: unknown): void {
    this.msgCb?.(JSON.stringify(value));
  }
  fireRaw(data: string): void {
    this.msgCb?.(data);
  }
  fireClose(): void {
    this.closeCb?.();
  }
  /** The frames sent so far, JSON-parsed. */
  parsed(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}
