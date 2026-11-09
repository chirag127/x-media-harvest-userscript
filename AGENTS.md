# AGENTS.md - x-media-harvest-userscript

Single-file product. `x-media-harvest-userscript.user.js` at the repo root **is** the product. No build, no deps, plain IIFE, `@grant none`.

## Endpoints actually used

- `GET /i/api/1.1/statuses/user_timeline.json` - profile source, `max_id` pagination.
- `GET /i/api/2/timeline/conversation/:id.json` - thread source.
- `GET /i/api/2/search/adaptive.json?q=&tweet_search_mode=live` - search source, cursor pagination.
- `extended_entities.media` / `video_info.variants` - the actual URLs.

X auth: bearer from `window.__INITIAL_STATE__` / a scanned script tag, falling back to the public web-client bearer; `x-csrf-token` is the `ct0` cookie. GitHub auth: the page `authenticity_token` from the unfollow form.

## Rules

- One file, zero dependencies, no build step. Bump `@version` and keep `@updateURL` / `@downloadURL` on raw `main`.
- API first, DOM clicking only as a fallback (thread replies and the GitHub following list are the only DOM reads).
- Dry run first, exactly one confirm, then execute. Never delete or unfollow on scan.
- 3 concurrent workers, 150-400 ms jitter, live per-row status, pause and stop always available.
- Never handle a shortcut while focus is in an input, textarea or contenteditable.
- Survive SPA navigation: the panel re-mounts on a URL change and keeps its state.
- `@noframes`; the panel is draggable, resizable and collapsible to a chip.

## Test with sctl

```bash
sctl install https://github.com/chirag127/x-media-harvest-userscript/raw/main/x-media-harvest-userscript.user.js
sctl page goto "<a matching page>"
# press the panel shortcut, run a scan, check the dry-run table
sctl debug console --level error
```

Verify on a throwaway slice first: a narrow date range, one page of results, or a 5-item cap. Then widen.

## Install docs

Shared guide: https://github.com/chirag127/userscript-install-guide - link it, never duplicate install steps.

<!-- okf-requirement -->
## 📚 Documentation lives in ONE place (mandatory)

All documentation for every repository in this workspace is **single-sourced** in the
umbrella repository:

```
c:\ws\docs\okf├── bundle.md            collection overview
├── index.md             catalogue of every concept and script note
├── concepts/            shared knowledge (architecture, testing, metadata, …)
└── scripts/             one note per userscript repository
```

### Rules

1. **Never create an `okf/` folder in this repository.** It is not duplicated here, by
   design. There was once a copy in every repo: 278 files describing 42 unique documents,
   with `concepts/architecture.md` physically present 32 times. Every edit had to be
   propagated to 30 repositories and drift was unavoidable.
2. **Never hand-edit a copy.** There are no copies. Edit the canonical file under
   `c:\ws\docs\okf\`.
3. **This repository's note is** `c:\ws\docs\okf\scripts\<repo-name>.md`. If it does not
   exist, add it before adding the script.
4. **Link, do not paste.** In `README.md`, link to the canonical note with a relative path
   from the workspace, e.g. `[documentation](../../../../../docs/okf/scripts/<repo-name>.md)`.
5. **Verify** with `node c:\ws\scripts\check-okf.mjs` — it exits `0` only when nothing is
   duplicated and every repository is linked and documented.
6. When adding a new script: create the repo, add `docs/okf/scripts/<repo-name>.md`, add it
   to the tables in `docs/okf/bundle.md` and `docs/okf/index.md`, then run the checker.

Full detail: `c:\ws\docs\okf\concepts\okf-requirement.md`.
