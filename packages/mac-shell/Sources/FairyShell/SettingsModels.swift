import Foundation

/// One provider as `GET /settings` reports it: the id and whether a key is set
/// (never the key itself — the daemon redacts secrets).
public struct RedactedProvider: Decodable, Equatable, Sendable {
  public let id: String
  public let hasKey: Bool
  public init(id: String, hasKey: Bool) { self.id = id; self.hasKey = hasKey }
}

/// The redacted config returned by `GET /settings`. Keys are never present.
public struct RedactedConfig: Decodable, Equatable, Sendable {
  public let providers: [RedactedProvider]
  public let defaultProvider: String?
  public let defaultModel: String?
  public let enabledModels: [String]?
  public init(providers: [RedactedProvider], defaultProvider: String? = nil,
              defaultModel: String? = nil, enabledModels: [String]? = nil) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }
}

/// One provider in a `PUT /settings` body: id + the (possibly blank) key.
public struct ProviderPayload: Encodable, Equatable, Sendable {
  public let id: String
  public let apiKey: String
  public init(id: String, apiKey: String) { self.id = id; self.apiKey = apiKey }
}

/// The full config `PUT /settings` accepts. Nil optionals are omitted from the
/// JSON (synthesized `encodeIfPresent`), matching the daemon's optional-field rules.
public struct PiConfigPayload: Encodable, Equatable, Sendable {
  public let providers: [ProviderPayload]
  public let defaultProvider: String?
  public let defaultModel: String?
  public let enabledModels: [String]?
  public init(providers: [ProviderPayload], defaultProvider: String? = nil,
              defaultModel: String? = nil, enabledModels: [String]? = nil) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }
}
