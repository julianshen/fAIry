import Foundation
import FairyShell

@MainActor
final class SettingsViewModel: ObservableObject {
  enum Phase: Equatable { case loading, ready, loadFailed(String) }
  @Published var phase: Phase = .loading
  @Published var form = SettingsForm(providers: [])
  @Published var status = ""
  @Published var saving = false

  private let client: SettingsClient
  init(client: SettingsClient) { self.client = client }

  func load() async {
    phase = .loading; status = ""
    switch await client.load() {
    case .success(let cfg): form = SettingsForm.from(cfg); phase = .ready
    case .failure(let e): phase = .loadFailed(Self.describe(e))
    }
  }

  func save() async {
    saving = true; status = ""
    switch await client.save(form.buildUpdate()) {
    case .success(let cfg): form = SettingsForm.from(cfg); status = "Saved."
    case .failure(let e): status = "Save failed: \(Self.describe(e))"
    }
    saving = false
  }

  func addCustomProvider(_ id: String) {
    let t = id.trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty, !form.providers.contains(where: { $0.id == t }) else { return }
    // Reject control chars / line breaks so a pasted id can't corrupt or spoof
    // the menu/form rendering (mirrors PairingReader's hardening).
    let forbidden = CharacterSet.controlCharacters.union(.newlines)
    guard t.rangeOfCharacter(from: forbidden) == nil else { return }
    form.providers.append(ProviderRow(id: t, hasKey: false))
  }

  static func describe(_ e: SettingsError) -> String {
    switch e {
    case .unreachable: return "couldn't reach the daemon — is it running?"
    case .unauthorized: return "unauthorized (401)"
    case .server(let s): return "daemon returned \(s)"
    case .decode: return "unexpected response"
    }
  }
}
