import { Fragment, type ReactElement } from "react";

/**
 * Minimal inline formatter for agent messages: `**bold**` → <b>, `` `code` ``
 * → <code>. Everything else is plain text. Matches the prototype's parser;
 * deliberately not a full Markdown engine — agent copy only uses these two.
 */
export function RichText({ text }: { text: string }): ReactElement {
  const parts = String(text)
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
        if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
