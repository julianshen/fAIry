import Foundation

/// One editable provider row in the Settings form.
public struct ProviderRow: Equatable, Sendable {
  public var id: String
  public var hasKey: Bool       // a key is already stored (from the redacted GET)
  public var keyInput: String   // what the user typed; blank = leave the stored key
  public var removed: Bool      // user dropped this provider (omitting it clears its key)
  public init(id: String, hasKey: Bool, keyInput: String = "", removed: Bool = false) {
    self.id = id; self.hasKey = hasKey; self.keyInput = keyInput; self.removed = removed
  }
}

/// The editable Settings state, built from the redacted config + known providers.
/// `buildUpdate()` encodes the daemon's merge contract into a `PUT` payload.
public struct SettingsForm: Equatable, Sendable {
  public var providers: [ProviderRow]
  public var defaultProvider: String
  public var defaultModel: String
  public var enabledModels: [String]
  public init(providers: [ProviderRow], defaultProvider: String = "",
              defaultModel: String = "", enabledModels: [String] = []) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }

  /// Build the editable form from a redacted config, unioned with the known
  /// provider ids (known ids absent from the config appear as empty rows).
  public static func from(_ redacted: RedactedConfig, known: [String] = KnownProviders.ids) -> SettingsForm {
    var rows = redacted.providers.map { ProviderRow(id: $0.id, hasKey: $0.hasKey) }
    let present = Set(rows.map(\.id))
    for id in known where !present.contains(id) { rows.append(ProviderRow(id: id, hasKey: false)) }
    return SettingsForm(
      providers: rows,
      defaultProvider: redacted.defaultProvider ?? "",
      defaultModel: redacted.defaultModel ?? "",
      enabledModels: redacted.enabledModels ?? []
    )
  }

  /// Encode the form to a `PUT /settings` payload, honoring the merge contract:
  /// a row is sent iff it isn't removed and either has a stored key or a typed
  /// one; its `apiKey` is the typed value (blank → daemon keeps the stored key);
  /// removed/empty rows are omitted (the only way to clear a key). Empty defaults
  /// and an empty enabledModels list are omitted (nil) so they don't overwrite.
  public func buildUpdate() -> PiConfigPayload {
    let provs = providers
      .filter { !$0.removed && ($0.hasKey || !$0.keyInput.trimmingCharacters(in: .whitespaces).isEmpty) }
      .map { ProviderPayload(id: $0.id, apiKey: $0.keyInput) }
    let models = enabledModels
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    return PiConfigPayload(
      providers: provs,
      defaultProvider: nonEmpty(defaultProvider),
      defaultModel: nonEmpty(defaultModel),
      enabledModels: models.isEmpty ? nil : models
    )
  }

  private func nonEmpty(_ s: String) -> String? {
    let t = s.trimmingCharacters(in: .whitespaces)
    return t.isEmpty ? nil : t
  }
}
