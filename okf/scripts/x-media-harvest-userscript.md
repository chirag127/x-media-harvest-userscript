---
type: Script
title: X Media Harvest
description: Collect deduped image and video URLs from an X profile, thread or search, then export a list and manifest.
repo: https://github.com/chirag127/x-media-harvest-userscript
install: https://github.com/chirag127/x-media-harvest-userscript/raw/main/x-media-harvest-userscript.user.js
version: "1.0.0"
tags: [userscript, x, twitter, media, download, harvest]
timestamp: 2026-11-09T00:00:00Z
---

# X Media Harvest

Reads a profile timeline, a conversation, or a live search, extracts every photo and video URL, dedupes them, verifies the links with parallel HEAD requests, and exports a URL list plus a JSON manifest.

## Method

One collector per source writing into a `Map` keyed by URL (dedupe for free), then a 3-worker HEAD verification pass and Blob export of the list and manifest.

Endpoints:

- `GET /i/api/1.1/statuses/user_timeline.json` - profile source, `max_id` pagination.
- `GET /i/api/2/timeline/conversation/:id.json` - thread source.
- `GET /i/api/2/search/adaptive.json?q=&tweet_search_mode=live` - search source, cursor pagination.
- `extended_entities.media` / `video_info.variants` - the actual URLs.

## Limitations

- Photos are requested at `?name=orig`; videos resolve to the highest-bitrate MP4 variant.
- The script does not zip binaries - it exports URLs. Use a download manager on the list.
- Caps at the configured maximum (default 300) and 40 pages per source.
- Verification is a HEAD request; some CDNs answer 403 to HEAD even when GET works.

## Risk

Read-only against X. Media stays on X's CDN and can disappear; re-host anything you need long term. Respect the original posters' rights.

## Install

Read the shared [install guide](https://github.com/chirag127/userscript-install-guide) once, then install the raw file above.
