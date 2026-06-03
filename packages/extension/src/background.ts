// Background service worker. For the vertical slice it just opens the side panel
// (the conversation UI) when the toolbar icon is clicked. The browser-bridge
// executor (connectBridge + the chrome.* tool handlers) is wired in here in a
// later PR.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.error("[fairy] failed to set side-panel behavior", err);
});
