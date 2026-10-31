# Nook browser extension

This is a small Manifest V3 extension for saving the current HTTP(S) page to the Nook API.

## What it does

- Registers and signs users in through the real Nook auth endpoints.
- Keeps the bearer token in `chrome.storage.local`; the popup never renders or logs it.
- Uses `activeTab` and `scripting` to read the active tab's URL, title, and description metadata.
- Sends only `url`, `title`, and `description` to `POST /api/bookmarks`.
- Handles saved, saving, duplicate, processing, error, and not-authenticated states.
- Provides logout, API-origin configuration, and an **Open Nook web app** link.

Page metadata is treated as untrusted data. It is length-limited and only inserted into the UI with `textContent`; page text and HTML are never sent to the API.

## Load unpacked in Chrome

1. Start the Nook backend on `http://localhost:3000` (or configure another HTTPS API origin in **Extension settings**).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose this `extension` directory.
6. Pin Nook, open an HTTP(S) page, and select the Nook toolbar button.

After changing extension files, return to `chrome://extensions` and select the extension's **Reload** button.

## Load unpacked in Edge

1. Start the Nook backend on `http://localhost:3000` (or configure another HTTPS API origin).
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this `extension` directory.
5. Open an HTTP(S) page and select Nook from the toolbar.

## API contract and current backend behavior

The extension uses the repository's documented endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/bookmarks`

The backend creates a bookmark before asynchronous processing. New bookmarks normally return `processingStatus: "PENDING"`, which the extension displays as **Processing** rather than pretending that AI processing has completed. A duplicate is reported from the backend's `409 EXACT_DUPLICATE` response; there is no client-side fake duplicate store.

The link labeled **Open Nook web app** opens the web client at `http://localhost:5173` during development.

The supplied repository `icon.png` is copied unchanged as `extension/icon.png` and used by the manifest and popup.
