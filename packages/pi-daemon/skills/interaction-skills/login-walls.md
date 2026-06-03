# Login walls

**Stop and ask the user.** Don't type credentials from anything you read on screen.

## Detect

After a navigate, check the URL and page text:

```
const url = await browser_getUrl()
const title = await browser_getTitle()
// /login, /signin, /auth/, "Sign in", "Log in" — surface to the user
```

The accessibility tree often makes login pages obvious — a single form with `role=textbox name=email` and `role=textbox name=password`.

## Hand off

Tell the user clearly:

> "The site requires me to log in. I won't enter your credentials. Please sign in in this tab, then tell me to continue."

Then **wait**. Don't keep clicking around — most "I made it past the login" probes leak info you shouldn't be probing for.

## After the user signs in

Resume from where you were. The session cookies persist on the same tab automatically. You can verify auth with a probe:

```
const html = (await browser_evaluate({ expression: "document.title + '|' + document.querySelector('header')?.textContent?.slice(0,100)" })).value
```

## Single-sign-on flows (OAuth, SAML)

These often redirect through 2-3 hosts. If the user clears the prompt at the SSO provider, the final redirect should land back on the target site with cookies set. Same rule: don't drive the SSO flow yourself.

## Credentials in URLs

Never. URLs with `?password=...` leak into history, referer headers, and server logs. If a site has that pattern, refuse it.
