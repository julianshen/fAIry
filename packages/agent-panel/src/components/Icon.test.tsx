import { render } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("renders an svg sized by the size prop on a 24x24 viewBox", () => {
    const { container } = render(<Icon name="check" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("emits one <path> per M-segment of the glyph", () => {
    // "sparkle" has two subpaths (the big + small star).
    const { container } = render(<Icon name="sparkle" />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    // "check" is a single subpath.
    const { container: c2 } = render(<Icon name="check" />);
    expect(c2.querySelectorAll("path")).toHaveLength(1);
  });

  it("strokes by default and fills when fill is set", () => {
    const { container } = render(<Icon name="zap" />);
    const stroke = container.querySelector("svg")!;
    expect(stroke).toHaveAttribute("stroke", "currentColor");
    expect(stroke).toHaveAttribute("fill", "none");

    const { container: c2 } = render(<Icon name="zap" fill />);
    const filled = c2.querySelector("svg")!;
    expect(filled).toHaveAttribute("fill", "currentColor");
    expect(filled).toHaveAttribute("stroke", "none");
  });

  it("renders nothing path-wise for an unknown glyph but stays a valid svg", () => {
    const { container } = render(
      <Icon name={"nope" as never} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });
});
