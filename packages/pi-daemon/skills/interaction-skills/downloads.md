# Downloads

Two strategies depending on what you need.

## You want the _file_

Don't click "Download" — many sites trigger a navigation to a blob URL or send a `Content-Disposition: attachment` response. Instead, find the underlying URL and fetch it directly:

```
browser_evaluate({ expression: "document.querySelector('a.download-link').href" })
// now fetch with the page's cookies via:
browser_evaluate({ expression: "fetch('<url>', { credentials: 'include' }).then(r => r.blob()).then(b => b.size)" })
```

For the actual bytes, prefer `browser_cdp({ method: "Network.getResponseBody", params: { requestId } })` — but that needs a requestId from a `Network.responseReceived` event. Subscribe before the click:

```
browser_cdp_subscribe({ method: "Network.responseReceived" })
browser_click({ x, y })   // download trigger
browser_cdp_collect({ method: "Network.responseReceived" })
// find the file's requestId, then:
browser_cdp({ method: "Network.getResponseBody", params: { requestId: "..." } })
```

## You want the user to _get_ the file

Just click. Horizon's `DownloadManager` handles the prompt and writes to the OS download dir. No special handling needed.

## CSV/JSON endpoints

Look for an `Export` link first — most sites have a JSON or CSV endpoint behind their fancy UI. The export URL is usually right in the page DOM or a `data-` attribute.
