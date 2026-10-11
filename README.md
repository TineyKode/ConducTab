# ConducTab

Manifest V3 browser extension that plays and pauses audio and video across tabs.

The project page in this repo is [index.html](index.html). GitHub Pages publishes it at <https://tineykode.github.io/ConducTab/>.

## What it does

- Finds tabs whose `video` or `audio` element has a source and a duration over 5 seconds
- Play or pause one tab, or every detected tab
- Keyboard shortcuts, which you can change at `chrome://extensions/shortcuts`
- Groups tabs by site when more than one site is playing
- Click a title to switch to that tab
- Dark and light popup
- Manual refresh, which scans open tabs again

| Shortcut | Action |
| --- | --- |
| Alt+Shift+M | Toggle the current tab |
| Alt+Shift+P | Pause all |
| Alt+Shift+O | Play all |

If a site blocks `play()`, ConducTab clicks YouTube's play button when that button is on the page.

## What it does not do

- It does not see media inside a cross-origin iframe, or players that never create a `video` or `audio` element.
- It does not sell Premium or Pro. The volume row is visible and locked. A license key is ignored until a server marks the record `serverValidated`.

## Install

1. Open Chrome, Edge, or another Chromium browser.
2. Go to `chrome://extensions`.
3. Turn on Developer mode.
4. Choose **Load unpacked** and select the `extension/` folder.

## Files

```text
extension/
  manifest.json    Manifest V3
  background.js    The only writer of the tab list. Also plays and pauses.
  popup.html       Popup
  popup.css
  popup.js         Renders the list and asks the service worker to change it
  license.js       Feature gate. Paid tiers stay locked.
  icon.png
  icon48.png
  icon128.png
index.html         Project page
```

## Permissions

- `tabs` - read tab titles and URLs, and focus a tab
- `scripting` - find and control media in a tab
- `storage` - the tab list, theme, and any future license record
- Host access to all URLs, so it can control media on the tab you have open

## Check

From `extension/`:

```powershell
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null
node --check background.js
node --check popup.js
node --check license.js
```
