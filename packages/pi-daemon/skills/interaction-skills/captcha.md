# Captcha

**Detect, never solve.** Captchas exist to filter you out; defeating them is hostile to the site, often violates ToS, and may be illegal depending on jurisdiction.

## Detect

The big four to watch for:

- **reCAPTCHA**: iframes from `google.com/recaptcha/` or `recaptcha.net`
- **hCaptcha**: iframes from `hcaptcha.com`
- **Cloudflare Turnstile**: iframes from `challenges.cloudflare.com`
- **Generic image-text**: a single visible `<img>` plus an input field labeled "type the characters" / "prove you're human"

Quick probe:

```
browser_evaluate({ expression: "[...document.querySelectorAll('iframe')].map(f => f.src).filter(s => /recaptcha|hcaptcha|turnstile|cloudflare.*challenge/.test(s))" })
```

If non-empty, a captcha is on the page.

## React appropriately

Tell the user the site is blocking automated access and ask them to clear the challenge manually. Then wait.

If the captcha is _also_ gating the user's normal usage (e.g., Cloudflare's "Checking your browser..." that everyone sees), let it run its 5-10 seconds and `browser_wait_for({ networkIdle: true, idleMs: 2000 })`. Don't click anything; many of these resolve on their own.

## Anti-bot heuristics

A site that suddenly serves captchas after working fine usually has detected unusual behavior — too-fast clicks, no mouse moves, repeated identical user-agent strings. The fix isn't to defeat the captcha; it's to slow down and act more like a human. Add small waits between actions. Don't click in machine-precise straight lines.
