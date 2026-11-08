# X Media Harvest

Collect deduped image and video URLs from an X profile, thread or search, then export a list and manifest.

## What it does

Reads a profile timeline, a conversation, or a live search, extracts every photo and video URL, dedupes them, verifies the links with parallel HEAD requests, and exports a URL list plus a JSON manifest.

## Install

Read the shared **[userscript install guide](https://github.com/chirag127/userscript-install-guide)** once (ScriptCat / Tampermonkey setup), then install:

**[Install x-media-harvest-userscript.user.js](https://github.com/chirag127/x-media-harvest-userscript/raw/main/x-media-harvest-userscript.user.js)**

## Use

1. Open x.com and press **Alt+Shift+M** (panel is on the bottom left).
2. Pick Profile, Thread or Search, enter a handle / tweet URL / query, and press **Scan media**.
3. Review the preview - each row links to its source tweet.
4. Press **Harvest N** to verify, then **Copy URLs**, **URL list** or **Manifest**.

Everything runs in a floating panel: drag it by the header, resize from the corner, collapse it to a chip. The dry run always comes first; exactly one confirm starts the work.

## Limits

- Photos are requested at `?name=orig`; videos resolve to the highest-bitrate MP4 variant.
- The script does not zip binaries - it exports URLs. Use a download manager on the list.
- Caps at the configured maximum (default 300) and 40 pages per source.
- Verification is a HEAD request; some CDNs answer 403 to HEAD even when GET works.

## Risk note

Read-only against X. Media stays on X's CDN and can disappear; re-host anything you need long term. Respect the original posters' rights.

The script acts with your own signed-in session against your own account. It is not an anti-bot bypass - it uses the same endpoints the site's own page uses.

## Documentation

- [AGENTS.md](AGENTS.md) - implementation notes and test steps
- [okf/](okf/index.md) - knowledge bundle for humans and agents

## License

[MIT](LICENSE) (c) 2026 chirag127
