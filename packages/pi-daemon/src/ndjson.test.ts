import { encodeLine, LineDecoder } from "./ndjson";

describe("encodeLine", () => {
  it("serializes a value and terminates it with a single newline", () => {
    expect(encodeLine({ type: "prompt", message: "hi" })).toBe(
      '{"type":"prompt","message":"hi"}\n',
    );
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
