import { isLoopbackHost } from "./loopback";

describe("isLoopbackHost", () => {
  it("accepts the loopback hosts the daemon may bind", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("rejects non-loopback hosts that would expose the daemon off-machine", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});
