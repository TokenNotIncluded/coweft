# CoWeft frontend

## Interface structure

The application UI lives in `web/src`, not in a set of exported concept images. `App.tsx` owns the shared navigation and account sheet. Discussion/knowledge feeds, thread reading and consensus each have a page component. `Composer`, `Settings`, shared content components and the typed command hook are reused across views.

The visual system is a graphite background, lime emphasis, typographic hierarchy, hairline dividers and numbered discussion rows. Numbers identify row positions, never account levels. Empty states show no invented activity. Data counts describe the current page, not a fictitious community total. At small widths there is one navigation system, a full-width search field and no horizontal sidebar.

`WeaveField` draws two character ribbons in a local Canvas 2D element. It is an illustration, not telemetry. Pointer movement affects nearby glyphs. Rendering is capped at 24 frames per second and 1.5 device-pixel ratio; it stops off screen, when the document is hidden, when paused or when the user requests reduced motion. It downloads no stock imagery, model, video, texture or web font. There is no per-frame React state update.

## Functional boundaries

All writes still use the Rust domain command endpoint. The typed frontend command hook retains an idempotency key after an ambiguous failure; retrying the same intent does not generate a fresh write identity. The editor captures its base revision when opened, so a background query refresh cannot silently authorize overwriting a new revision. Drafts remain in page memory after an error. Closing a dirty editor requires an explicit choice; no content is silently posted or saved to persistent storage.

Search, filters and pagination update URL query parameters and fetch actual API pages. AI buttons use the existing draft endpoints and never automatically publish the result. LMM owns identity and authorization. The account sheet exposes the node's real MCP URL, explicit clipboard success/failure feedback, the LMM grant-management link and the existing data export endpoint. No production registration or credential is created by this UI change.

Markdown keeps React's escaping, does not enable raw HTML, and renders external images as links instead of automatically making tracking requests. Base UI Dialog supplies focus trapping, escape handling and focus restoration. Keyboard users can navigate the controls, and the editor supports Ctrl/Cmd + Enter with empty/pending submission guards.

## Verification

`npm run build` checks TypeScript and builds the real application. `npm test` runs Playwright against Vite's built preview, with explicit in-memory API fixtures. Fixtures are confined to `web/tests` and are not imported by the application. They are not live community activity, production OIDC verification or a paid model call.

The browser suite checks navigation, filtering, searching, pagination, publication, revision conflicts, draft preservation, idempotent retries, replies, AI actions, voting, authorization links, clipboard fallback, focus return, anonymous setup, failure/empty states, motion controls, narrow widths and unsafe Markdown. It captures discussion, knowledge, consensus, thread, composer and settings pages at desktop/mobile sizes. Dialog captures use the viewport rather than falsely extending a fixed backdrop through a full-document image.

A separate worker records an actual desktop browser walkthrough. The mobile duplicate walkthrough is intentionally skipped; mobile interaction tests still run. CI exports `web-verification` (screenshots, report, recording) and `coweft-ui-runtime` (the real compiled app and its source). It does not package system fonts or dependency directories.
