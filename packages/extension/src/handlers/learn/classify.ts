import type { ActionCategory, ClassifiedAction, Collected, CollectedForm, NetworkEndpoint, UrlAnalysis } from "./types";

const FORM_PATTERNS: { re: RegExp; category: ActionCategory }[] = [
  { re: /\b(create|add|new|post|submit|register|sign\s?up)\b/i, category: "crud" },
  { re: /\b(update|save|edit|apply)\b/i, category: "crud" },
  { re: /\b(delete|remove|trash)\b/i, category: "crud" },
  { re: /\b(export|download|csv|pdf)\b/i, category: "export" },
  { re: /\b(filter|sort|refine)\b/i, category: "filter" },
];

function formCategory(label: string): ActionCategory | null {
  for (const { re, category } of FORM_PATTERNS) if (re.test(label)) return category;
  return null;
}

function isLoginForm(form: CollectedForm): boolean {
  const hasPassword = form.fields.some((f) => f.type === "password");
  const hasUser = form.fields.some((f) => /email|user|login/i.test(f.name) || f.type === "email");
  return hasPassword && hasUser;
}

/**
 * Synthesize likely actions from the collected page data + URL analysis (+ any
 * observed network). Confidence ranks: site-declared `data-agent-action` (high,
 * authoritative) → search → forms → navigation (low) → observed endpoints. Pure.
 */
export function classify(
  collected: Collected,
  urlAnalysis: UrlAnalysis,
  network?: { endpoints: NetworkEndpoint[] },
): ClassifiedAction[] {
  const actions: ClassifiedAction[] = [];

  for (const da of collected.declaredActions) {
    actions.push({
      name: da.name,
      category: "custom",
      confidence: "high",
      elements: [{ tag: da.tag, label: da.label }],
      description: `Site-declared action "${da.name}".`,
    });
  }

  if (collected.searchInputs.length > 0) {
    actions.push({
      name: "search",
      category: "search",
      confidence: "high",
      elements: collected.searchInputs.map((s) => ({ tag: "input", label: s.label })),
      description: "Search the site.",
    });
  }

  for (const form of collected.forms) {
    if (isLoginForm(form)) {
      actions.push({ name: "login", category: "auth", confidence: "high", formFields: form.fields, description: "Sign in." });
      continue;
    }
    const label = form.submitLabel ?? "";
    const category = formCategory(label);
    if (category) {
      actions.push({
        name: label || category,
        category,
        confidence: "medium",
        formFields: form.fields,
        description: `Form action: ${label || category}.`,
      });
    }
  }

  for (const p of urlAnalysis.patterns) {
    if (p.count >= 5) {
      actions.push({
        name: `navigate ${p.pattern}`,
        category: "navigation",
        confidence: "low",
        description: `Navigation: ${p.count} links matching ${p.pattern}.`,
      });
    }
  }

  if (network) {
    for (const ep of network.endpoints) {
      actions.push({
        name: `${ep.method} ${ep.path}`,
        category: ep.auth ? "auth" : "custom",
        confidence: "low",
        observedEndpoint: { method: ep.method, path: ep.path },
        description: `Observed API: ${ep.method} ${ep.path}${ep.graphql ? " (GraphQL)" : ""}.`,
      });
    }
  }

  return actions;
}
