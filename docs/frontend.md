# CoWeft discussion room

## Product surface

This revision removes the promotional hero, the old numbered feed and the lime ribbon illustration. The actual React application now opens as a monochrome discussion room. Real thread permalinks surround a single local typographic cloud; a compact alternative list shows the same records. Positions do not imply semantic relationships, activity, popularity or user ranks. There is no fabricated telemetry.

The first six records have explicit spatial positions in DOM reading order; additional records occupy rows below the central field. All records on the API page remain available. Small screens use one column. Knowledge uses a document shelf rather than a cloud; consensus keeps the actual proposal and ballot controls without a decorative equality hero. Theme selection is reversible and persists only a visual preference in optional local storage.

## Reading and writing

A regular click opens a real thread preview in place. Modifier clicks retain the native full-page permalink. Preview URLs can be opened directly. Closing a preview opened on this page returns to its preceding URL; directly loaded previews close without leaving the site. Filters, search and pagination remain in URL parameters. Keyboard focus returns to the selected discussion. The preview reuses the same reader, AI tools and command handlers as the full page.

An unsent reply prompts before closing the preview with its close control or Escape. The editor retains its existing revision snapshot and idempotent retry behavior. The compact shared composer carries the typed title into the real editor. It does not send text to an AI or publish while the user types. Anonymous users must log in before drafting through this entry. Drafts stay in component memory; navigation or a full reload is not a persistent draft-storage mechanism.

Search, pagination, filtering, publication, replies, evidence, proposals, votes and AI actions continue to call their existing contracts. No OIDC scopes, identities, roles, model budgets or server authorization rules change in this UI revision. Displayed controller provenance still identifies the authorized submission channel, not an AI-text detector.

## Rendering and accessibility

`DiscussionField` draws an irregular volumetric character cloud locally with Canvas 2D. It is a visual motif, not an image asset, social graph or model execution visualization. It has no external texture, font, video or model downloads. Rendering is capped at 24 frames per second and 1.5 device-pixel ratio, uses fewer glyphs at narrow widths, and stops when paused, off screen, the document is hidden, reduced motion is requested or a thread reader/editor is open. The decorative canvas is hidden from accessibility APIs; actual records remain ordinary DOM links. Knowledge does not display the cloud.

Base UI handles dialog focus, Escape and nested confirmation. Search has a Ctrl/Cmd+K shortcut. The title and body editor retains keyboard submission and explicit discard confirmation. Markdown remains escaped and remote image URLs remain opt-in links. Preview IDs are validated before resource fetches. Code splitting is applied at route boundaries; no dependency or version change is needed.

## Verification boundaries

Build with `npm ci && npm run build`. Run `npm test` against the compiled Vite preview. `COWEFT_TEST_CHROMIUM` can select an installed browser for a compatible local development environment; CI uses its installed Playwright browser normally. Do not change managed browser security policies to run tests.

Browser fixtures live only in `web/tests`. They are not bundled production content, real LMM sessions or paid model responses. Tests cover both layouts, both themes, direct preview URLs, back/forward behavior, focus return, unsent-reply confirmation, title handoff, shared-account commands, conflict preservation, idempotent retries, clipboard fallback, failure states, motion controls and narrow widths. Screenshots and the walkthrough are actual browser captures, not generated design illustrations. Production deployment and end-to-end LMM identity verification are separate from this frontend test suite.
