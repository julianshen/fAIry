import { render } from "@testing-library/react";
import { AgentPip } from "./AgentPip";
import { AGENTS } from "../agents";

describe("AgentPip", () => {
  it("shows the agent's glyph by default", () => {
    const { container } = render(<AgentPip id="sage" />);
    const pip = container.firstChild as HTMLElement;
    expect(pip).toHaveTextContent(AGENTS.sage.glyph);
    expect(pip.style.background).toBe(AGENTS.sage.color);
  });

  it("shows the agent icon instead of the glyph when icon is set", () => {
    const { container } = render(<AgentPip id="atlas" icon />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstChild).not.toHaveTextContent(AGENTS.atlas.glyph);
  });

  it("renders nothing for an unknown agent", () => {
    const { container } = render(<AgentPip id={"ghost" as never} />);
    expect(container.firstChild).toBeNull();
  });
});
