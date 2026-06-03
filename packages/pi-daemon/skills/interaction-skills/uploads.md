# Uploads

**Never click an `<input type="file">`.** It opens the OS file picker, which you can't drive.

## Set the file via CDP

```
browser_evaluate({ expression: "document.querySelector('input[type=file]').getAttribute('name')" })
// confirm the right input

browser_cdp({
  method: "DOM.setFileInputFiles",
  params: { files: ["/absolute/path/to/file.pdf"], objectId: "<remoteObjectId>" }
})
```

You need a remote object id for the input. Get it via `DOM.querySelector` → `DOM.resolveNode`, or use a `RemoteObjectId` from a `Runtime.evaluate` with `returnByValue: false`.

## Easier: pre-resolve in one shot

```
browser_evaluate({ expression: "Object.defineProperty(document.querySelector('input[type=file]'), 'files', { value: '__PLACEHOLDER__' })" })
```

No — that won't work (`files` is readonly). Stick with CDP `DOM.setFileInputFiles`.

## Drag-and-drop dropzones

Many sites use a styled `<div>` dropzone over a hidden `<input type=file>`. The hidden input is still there — query it directly and use the CDP method above. The visible dropzone is for human eyes only.

## Multi-file inputs

`files` accepts an array. Validate the input has `multiple` attribute first.

## After upload

The file isn't _submitted_ yet — that's a separate click on a "Submit" button. After setting the file, the page usually shows a preview; screenshot to verify before clicking submit.
