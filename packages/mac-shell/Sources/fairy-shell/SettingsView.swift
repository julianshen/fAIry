import SwiftUI
import FairyShell

struct SettingsView: View {
  @ObservedObject var model: SettingsViewModel
  @State private var customId = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Fairy Settings").font(.title2).bold()
      switch model.phase {
      case .loading:
        ProgressView("Loading…").frame(maxWidth: .infinity, maxHeight: .infinity)
      case .loadFailed(let why):
        VStack(alignment: .leading, spacing: 8) {
          Text("Couldn't load settings: \(why)").foregroundColor(.red)
          Button("Retry") { Task { await model.load() } }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      case .ready:
        readyForm
      }
    }
    .padding(20)
    .frame(width: 480, height: 560)
    .task { await model.load() }
  }

  private var readyForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          providersSection
          Divider(); defaultsSection
          Divider(); enabledModelsSection
        }
      }
      Divider()
      HStack {
        Text(model.status)
          .foregroundColor(model.status.hasPrefix("Save failed") ? .red : .secondary)
        Spacer()
        Button(model.saving ? "Saving…" : "Save") { Task { await model.save() } }
          .keyboardShortcut(.defaultAction).disabled(model.saving)
      }
    }
  }

  private var providersSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Providers").font(.headline)
      ForEach($model.form.providers) { $pr in
        HStack {
          Text(pr.id).frame(width: 110, alignment: .leading)
          if pr.removed {
            Text("removed").foregroundColor(.secondary)
            Button("Undo") { $pr.removed.wrappedValue = false }
          } else {
            SecureField(pr.hasKey ? "key is set — type to replace" : "API key",
                        text: $pr.keyInput).textFieldStyle(.roundedBorder)
            Button(role: .destructive) { $pr.removed.wrappedValue = true } label: {
              Image(systemName: "trash")
            }
          }
        }
      }
      HStack {
        TextField("Add custom provider id", text: $customId).textFieldStyle(.roundedBorder)
        Button("Add") { model.addCustomProvider(customId); customId = "" }
      }
    }
  }

  private var defaultsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Defaults").font(.headline)
      HStack {
        Text("Provider").frame(width: 110, alignment: .leading)
        TextField("e.g. anthropic",
                  text: Binding(get: { model.form.defaultProvider },
                                set: { model.form.defaultProvider = $0 })).textFieldStyle(.roundedBorder)
      }
      HStack {
        Text("Model").frame(width: 110, alignment: .leading)
        TextField("e.g. claude-sonnet-4-6",
                  text: Binding(get: { model.form.defaultModel },
                                set: { model.form.defaultModel = $0 })).textFieldStyle(.roundedBorder)
      }
    }
  }

  private var enabledModelsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Enabled models").font(.headline)
      // Plain strings have no stable identity, so this stays an index ForEach —
      // but the binding + remove are bounds-guarded so a mutation mid-render
      // can't read or delete out of range.
      ForEach(model.form.enabledModels.indices, id: \.self) { i in
        HStack {
          TextField("model id", text: Binding(
            get: { i < model.form.enabledModels.count ? model.form.enabledModels[i] : "" },
            set: { if i < model.form.enabledModels.count { model.form.enabledModels[i] = $0 } }))
            .textFieldStyle(.roundedBorder)
          Button(role: .destructive) {
            if i < model.form.enabledModels.count { model.form.enabledModels.remove(at: i) }
          } label: { Image(systemName: "minus.circle") }
        }
      }
      Button("Add model") { model.form.enabledModels.append("") }
    }
  }
}
