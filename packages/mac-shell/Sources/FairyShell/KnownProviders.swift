/// Well-known Pi provider ids surfaced as ready rows in Settings. Not exhaustive
/// (the UI also allows a custom id) and may drift from Pi over time.
public enum KnownProviders {
  public static let ids: [String] = ["anthropic", "openai", "google", "openrouter", "groq"]
}
