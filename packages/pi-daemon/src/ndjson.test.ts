import { encodeLine, LineDecoder } from "./ndjson";

describe("encodeLine", () => {
  it("serializes a value and terminates it with a single newline", () => {
    expect(encodeLine({ type: "prompt", message: "hi" })).toBe(
      '{"type":"prompt","message":"hi"}\n',
    );
  });

  it("throws on values that don't serialize to JSON instead of emitting a bad line", () => {
    // JSON.stringify returns undefined for these — appending "\n" would emit
    // the literal "undefined\n", which the other end can't parse.
    expect(() => encodeLine(undefined)).toThrow(TypeError);
    expect(() => encodeLine(() => {})).toThrow(TypeError);
    expect(() => encodeLine(Symbol("x"))).toThrow(TypeError);
  });

  it("round-trips with the decoder", () => {
    const d = new LineDecoder();
    const value = { id: "1", tool: "click", args: { x: 10 } };
    expect(d.push(encodeLine(value))).toEqual([value]);
  });
});

describe("LineDecoder", () => {
  it("returns nothing until a line is terminated", () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}')).toEqual([]);
    expect(d.pending).toBe('{"a":1}');
    expect(d.push("\n")).toEqual([{ a: 1 }]);
    expect(d.pending).toBe("");
  });

  it("parses several objects delivered in one chunk", () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n{"c":3}\n')).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("reassembles an object split across chunks", () => {
    const d = new LineDecoder();
    expect(d.push('{"long":')).toEqual([]);
    expect(d.push('"value"}')).toEqual([]);
    expect(d.push("\n")).toEqual([{ long: "value" }]);
  });

  it("tolerates CRLF line endings", () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}\r\n{"b":2}\r\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips blank lines", () => {
    const d = new LineDecoder();
    expect(d.push('\n{"a":1}\n\n\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("throws on a malformed line when no error handler is set", () => {
    const d = new LineDecoder();
    expect(() => d.push("not json\n")).toThrow(/malformed/i);
  });

  it("preserves the original parse error as the thrown error's cause", () => {
    const d = new LineDecoder();
    try {
      d.push("not json\n");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).cause).toBeInstanceOf(SyntaxError);
    }
  });

  it("drops the consumed lines after a thrown error so a caught stream resumes cleanly", () => {
    const d = new LineDecoder();
    expect(() => d.push('{"a":1}\nbad\n{"b":2}\n')).toThrow(/malformed/i);
    // The good line before the error was returned-then-lost on throw; the line
    // after it stays buffered and is delivered on the next push — not re-parsed.
    expect(d.push('{"c":3}\n')).toEqual([{ b: 2 }, { c: 3 }]);
  });

  it("routes malformed lines to onError and keeps the surrounding valid ones", () => {
    const errors: Array<{ line: string; message: string }> = [];
    const d = new LineDecoder((line, err) => errors.push({ line, message: err.message }));
    const out = d.push('{"a":1}\nboom\n{"b":2}\n');
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe("boom");
  });

  it("keeps decoding across pushes after a recovered error", () => {
    const d = new LineDecoder(() => {});
    d.push("bad\n");
    expect(d.push('{"ok":true}\n')).toEqual([{ ok: true }]);
  });
});
