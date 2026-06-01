import { render, screen } from "@testing-library/react";
import { RichText } from "./RichText";

describe("RichText", () => {
  it("renders plain text unchanged", () => {
    render(<RichText text="just plain words" />);
    expect(screen.getByText("just plain words")).toBeInTheDocument();
  });

  it("renders **bold** spans as <b>", () => {
    const { container } = render(<RichText text="pick ANA NH7" />);
    expect(container.querySelector("b")).toBeNull();

    const { container: c2 } = render(<RichText text="pick **ANA NH7** today" />);
    const bold = c2.querySelector("b");
    expect(bold).not.toBeNull();
    expect(bold).toHaveTextContent("ANA NH7");
    // surrounding text is preserved
    expect(c2.textContent).toBe("pick ANA NH7 today");
  });

  it("renders `code` spans as <code>", () => {
    const { container } = render(<RichText text="open `skylark.com` now" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent("skylark.com");
    expect(container.textContent).toBe("open skylark.com now");
  });

  it("handles bold and code in the same string", () => {
    const { container } = render(
      <RichText text="**ANA** costs `$842` total" />,
    );
    expect(container.querySelector("b")).toHaveTextContent("ANA");
    expect(container.querySelector("code")).toHaveTextContent("$842");
    expect(container.textContent).toBe("ANA costs $842 total");
  });

  it("coerces non-string input to a string", () => {
    // Defensive: agent payloads can be numbers.
    render(<RichText text={42 as unknown as string} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
