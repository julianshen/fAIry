/**
 * A2UI messages arrive as opaque LLM/wire data, so a node with a known `type`
 * may still be missing (or carry a non-array for) a required field. Coerce to an
 * array before mapping so malformed UI degrades to "render what's valid" instead
 * of throwing mid-render and blanking the whole feed.
 */
export function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
