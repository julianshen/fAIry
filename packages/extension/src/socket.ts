/** Minimal client-side socket surface — satisfied by a browser `WebSocket` via a thin adapter. */
export interface ClientSocket {
  send(data: string): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

/** Builds the socket for a URL; injected so the clients are testable without a real WebSocket. */
export type SocketFactory = (url: string) => ClientSocket;

/* v8 ignore start -- thin browser WebSocket adapter; exercised by the E2E, not units */
export const defaultSocketFactory: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    onOpen: (h) => ws.addEventListener("open", () => h()),
    onMessage: (h) => ws.addEventListener("message", (e) => h(String(e.data))),
    onClose: (h) => ws.addEventListener("close", () => h()),
    close: () => ws.close(),
  };
};
/* v8 ignore stop */
