# Network spying

The CDP subscribe/collect pair is for watching what the page _does_ in response to an action — not what it displays.

## Pattern: subscribe → act → collect

```
browser_cdp_subscribe({ method: "Network.responseReceived" })
browser_click({ x, y })                              // checkout button
browser_wait_for({ networkIdleMs: 600 })
const events = await browser_cdp_collect({ method: "Network.responseReceived" })
```

Each event has `requestId`, `response.url`, `response.status`, `response.mimeType`, and `response.headers`. To get the body:

```
browser_cdp({ method: "Network.getResponseBody", params: { requestId: "..." } })
```

## Useful events to subscribe to

| Method                           | Why                                          |
| -------------------------------- | -------------------------------------------- |
| `Network.responseReceived`       | What URLs got hit and with what status       |
| `Network.requestWillBeSent`      | What request payloads went out (POST bodies) |
| `Network.webSocketFrameReceived` | Live data: chat, stock tickers, push updates |
| `Page.frameNavigated`            | Confirm navigation actually happened         |
| `Page.javascriptDialogOpening`   | Pre-arm before clicks that might `confirm()` |
| `Runtime.consoleAPICalled`       | Capture the page's own console output        |

## Buffers are capped

200 events per method. If a chatty event fires faster than you collect, you keep the _latest_ 200, not the first 200. Drain more often if you're watching something busy.

## Subscriptions persist across turns

Subscribe once. The bridge keeps the listener bound across `detach`/`reattach` cycles. Unsubscribe explicitly when you're done — `browser_cdp_unsubscribe({ method })` for one, or `browser_cdp_unsubscribe({})` to clear all.

## Don't subscribe to everything

`Network.dataReceived` fires for every chunk of every response. Enabling it on a video page will swamp your buffer. Subscribe to the narrowest event that answers your question.
