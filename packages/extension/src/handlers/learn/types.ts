/** Shapes for the learnPageActions page scanner (see the design doc). */

export type LearnArgs = { mode?: "passive" | "active"; observeMs?: number };

export interface CollectedElement {
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
}
export interface CollectedFormField {
  name: string;
  type: string;
}
export interface CollectedForm {
  action: string;
  method: string;
  fields: CollectedFormField[];
  submitLabel: string | null;
}
export interface CollectedNav {
  label: string | null;
  links: { label: string; href: string }[];
}
export interface DeclaredAction {
  name: string;
  tag: string;
  label: string;
}

/** What the page-side collector script returns (one DOM pass). */
export interface Collected {
  origin: string;
  url: string;
  elementsByRole: Record<string, number>;
  interactive: CollectedElement[];
  searchInputs: { label: string }[];
  forms: CollectedForm[];
  nav: CollectedNav[];
  hrefs: string[];
  declaredActions: DeclaredAction[];
}

export interface UrlAnalysis {
  patterns: { pattern: string; count: number }[];
  queryParams: string[];
}

export type ActionCategory =
  | "crud"
  | "navigation"
  | "filter"
  | "auth"
  | "export"
  | "search"
  | "upload"
  | "custom";

export interface ClassifiedAction {
  name: string;
  category: ActionCategory;
  confidence: "high" | "medium" | "low";
  elements?: { tag: string; label: string }[];
  formFields?: CollectedFormField[];
  observedEndpoint?: { method: string; path: string };
  description: string;
}

export interface NetworkEndpoint {
  method: string;
  path: string;
  graphql?: boolean;
  auth?: boolean;
}

export interface LearnResult {
  origin: string;
  url: string;
  perception: {
    elementsByRole: Record<string, number>;
    interactive: CollectedElement[];
    searchInputs: { label: string }[];
    forms: CollectedForm[];
    nav: CollectedNav[];
  };
  urlAnalysis: UrlAnalysis;
  declaredActions: DeclaredAction[];
  network?: { endpoints: NetworkEndpoint[] };
  classification: ClassifiedAction[];
}
