// ==UserScript==
// @name         X Media Harvest
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  Harvest every image and video URL from an X profile, thread or search into a deduped preview, verify the links, then export a URL list and JSON manifest.
// @author       chirag127
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://x.com/favicon.ico
// @homepageURL  https://github.com/chirag127/x-media-harvest-userscript
// @supportURL   https://github.com/chirag127/x-media-harvest-userscript/issues
// @downloadURL  https://github.com/chirag127/x-media-harvest-userscript/raw/main/x-media-harvest-userscript.user.js
// @updateURL    https://github.com/chirag127/x-media-harvest-userscript/raw/main/x-media-harvest-userscript.user.js
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const ORIGIN = location.hostname.endsWith("twitter.com") ? "https://twitter.com" : "https://x.com";
  const FALLBACK_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const SET_KEY = "xmh.settings.v1";
  const MAX_PAGES = 40;

  const defaults = { mode: "profile", target: "", max: 300, videos: true, verify: true, concurrency: 3 };
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
  const settings = Object.assign({}, defaults, readJSON(SET_KEY));
  const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

  let bearerCache = null;
  function bearer() {
    if (bearerCache) return bearerCache;
    const s = window.__INITIAL_STATE__;
    const found = s && (s.session && (s.session.bearerToken || s.session.bearer_token));
    const scanned = (document.documentElement.innerHTML.match(/Bearer (AAAA[A-Za-z0-9%._-]{40,})/) || [])[1];
    bearerCache = found || scanned || FALLBACK_BEARER;
    return bearerCache;
  }
  const ct0 = () => (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1] || "";

  async function api(path) {
    const token = ct0();
    if (!token) throw new Error("no ct0 cookie - sign in to X first");
    const r = await fetch(ORIGIN + path, {
      credentials: "include",
      headers: {
        authorization: "Bearer " + bearer(),
        "x-csrf-token": token,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
      },
    });
    if (r.status === 429) throw new Error("rate limited (429)");
    if (!r.ok) throw new Error("GET " + path.split("?")[0] + " -> " + r.status);
    return r.json().catch(() => ({}));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => sleep(150 + Math.random() * 250);
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };
  const statusIdFrom = (u) => (String(u || "").match(/\/status(?:es)?\/(\d{1,25})/) || [])[1] || null;

  function mediaOf(t, videos) {
    const ent = t.extended_entities || t.entities || {};
    const out = [];
    for (const m of ent.media || []) {
      if (m.type === "photo") {
        out.push({ type: "photo", url: m.media_url_https + "?name=orig", poster: m.media_url_https });
      } else if (videos) {
        const variants = ((m.video_info || {}).variants || []).filter((v) => v.content_type === "video/mp4");
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        out.push({ type: m.type || "video", url: (variants[0] || {}).url || m.media_url_https, poster: m.media_url_https });
      }
    }
    return out;
  }

  function pushTweets(store, tweets, users, videos) {
    let added = 0;
    for (const key of Object.keys(tweets)) {
      const t = tweets[key];
      if (!t) continue;
      const u = t.user || (users && users[t.user_id_str]) || {};
      const media = mediaOf(t, videos);
      for (const m of media) {
        if (store.has(m.url)) continue;
        store.set(m.url, {
          url: m.url,
          type: m.type,
          poster: m.poster,
          author: u.screen_name || "unknown",
          tweet: "https://x.com/" + (u.screen_name || "i/web") + "/status/" + t.id_str,
          id: t.id_str,
        });
        added++;
      }
    }
    return added;
  }

  // ---------- collectors ----------
  async function fromProfile(handle, store) {
    const me = await api("/i/api/1.1/users/show.json?screen_name=" + encodeURIComponent(handle));
    let maxId = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = "/i/api/1.1/statuses/user_timeline.json?user_id=" + me.id_str +
        "&count=100&tweet_mode=extended&include_rts=1&exclude_replies=false" + (maxId ? "&max_id=" + maxId : "");
      const list = await api(q);
      if (!list.length) break;
      const tweets = {};
      const users = {};
      for (const t of list) { tweets[t.id_str] = t; if (t.user) users[t.user_id_str] = t.user; }
      pushTweets(store, tweets, users, settings.videos);
      if (store.size >= settings.max) break;
      maxId = String(BigInt(list[list.length - 1].id_str) - 1n);
      await jitter();
    }
  }

  async function fromThread(id, store) {
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = "/i/api/2/timeline/conversation/" + id + ".json" +
        "?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1" +
        "&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1" +
        "&include_can_media_tag=1&skip_status=1&cards_platform=Web-12&include_cards=1" +
        "&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1" +
        "&tweet_mode=extended&include_entities=true&include_user_entities=true" +
        "&include_ext_media_color=true&include_ext_media_availability=true&send_error_codes=true" +
        "&simple_quoted_tweet=true&count=20" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const j = await api(q);
      const added = pushTweets(store, (j.globalObjects && j.globalObjects.tweets) || {}, (j.globalObjects && j.globalObjects.users) || {}, settings.videos);
      cursor = "";
      for (const ins of (j.timeline && j.timeline.instructions) || []) {
        for (const e of ins.addEntries || []) {
          if (/^cursor-bottom/.test(e.entryId || "") && e.content && e.content.operation) cursor = e.content.operation.cursor.value;
        }
      }
      if (!added || !cursor || store.size >= settings.max) break;
      await jitter();
    }
  }

  async function fromSearch(query, store) {
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = "/i/api/2/search/adaptive.json?q=" + encodeURIComponent(query) +
        "&count=100&tweet_search_mode=live&tweet_mode=extended&include_entities=true" +
        "&include_user_entities=true&include_ext_media_color=true&include_ext_media_availability=true" +
        "&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true" +
        "&include_reply_count=1&send_error_codes=true&simple_quoted_tweet=true" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const j = await api(q);
      const added = pushTweets(store, (j.globalObjects && j.globalObjects.tweets) || {}, (j.globalObjects && j.globalObjects.users) || {}, settings.videos);
      cursor = "";
      for (const ins of (j.timeline && j.timeline.instructions) || []) {
        for (const e of ins.addEntries || []) {
          if (/^cursor-bottom/.test(e.entryId || "") && e.content && e.content.operation) cursor = e.content.operation.cursor.value;
        }
      }
      if (!added || !cursor || store.size >= settings.max) break;
      await jitter();
    }
  }

  // ---------- UI ----------
  const CSS = [
    ".xm{position:fixed;z-index:2147483000;bottom:20px;left:20px;width:560px;height:560px;background:#181818;color:#e8e8e8;",
    "border:1px solid #303030;border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.65);display:flex;flex-direction:column;",
    "font:13px/1.45 Roboto,'Segoe UI',system-ui,sans-serif;overflow:hidden;resize:both;min-width:400px;min-height:320px}",
    ".xm *{box-sizing:border-box}",
    ".xm-head{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#202020;border-bottom:1px solid #303030;cursor:move;user-select:none}",
    ".xm-title{font-weight:600;font-size:13px;letter-spacing:.2px;flex:1}",
    ".xm-badge{font-size:10px;color:#9a9a9a;border:1px solid #3a3a3a;border-radius:4px;padding:1px 5px}",
    ".xm-btn{background:#2a2a2a;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}",
    ".xm-btn:hover{background:#333}.xm-btn:disabled{opacity:.45;cursor:default}",
    ".xm-btn.primary{background:#065fd4;border-color:#065fd4}.xm-btn.primary:hover{background:#0a72f5}",
    ".xm-x{background:none;border:0;color:#9a9a9a;font-size:16px;line-height:1;cursor:pointer;padding:0 2px}",
    ".xm-body{flex:1;display:flex;flex-direction:column;min-height:0}",
    ".xm-bar{display:flex;gap:6px;padding:8px 11px;border-bottom:1px solid #262626;flex-wrap:wrap}",
    ".xm-target{width:100%;background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;padding:5px 8px;font:inherit}",
    ".xm-stat{font-size:11px;color:#9a9a9a;padding:0 11px 6px}",
    ".xm-prog{height:4px;background:#262626}.xm-prog>i{display:block;height:100%;width:0;background:#065fd4;transition:width .18s}",
    ".xm-wrap{flex:1;overflow:auto;min-height:60px;border-bottom:1px solid #262626}",
    ".xm-table{width:100%;border-collapse:collapse;font-size:12px}",
    ".xm-table th{position:sticky;top:0;background:#202020;color:#9a9a9a;font-weight:500;text-align:left;padding:5px 8px;border-bottom:1px solid #303030}",
    ".xm-table td{padding:4px 8px;border-bottom:1px solid #242424;vertical-align:top}",
    ".xm-thumb{width:44px;height:44px;object-fit:cover;border-radius:5px;background:#262626;display:block}",
    ".xm-kind{font-size:10px;border:1px solid #3a3a3a;border-radius:4px;padding:0 4px;color:#9a9a9a}",
    ".xm-kind.vid{border-color:#7a5a1a;color:#d6a43a}",
    ".xm-url{word-break:break-all;font:11px/1.4 ui-monospace,Consolas,monospace;color:#9a9a9a}",
    ".xm-st{font-size:11px;color:#9a9a9a}.xm-st.ok{color:#4caf7d}.xm-st.err{color:#e06c6c}",
    ".xm-log{height:96px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;padding:6px 11px;background:#141414;color:#9a9a9a;white-space:pre-wrap;word-break:break-word}",
    ".xm-set{padding:0 11px 9px;font-size:11px;color:#bdbdbd}.xm-set summary{cursor:pointer;padding:5px 0;color:#9a9a9a}",
    ".xm-field{display:flex;align-items:center;gap:6px;margin:5px 0}",
    ".xm-field input[type=number]{background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:5px;padding:3px 6px;font:inherit;width:74px}",
    ".xm-chip{position:fixed;z-index:2147483000;left:20px;bottom:20px;background:#065fd4;color:#fff;border:0;border-radius:18px;padding:7px 14px;font:600 12px Roboto,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);display:none}",
    ".xm-hide{display:none!important}",
  ].join("");

  function makeUI() {
    const style = h("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = h("div", "xm xm-panel");
    const head = h("div", "xm-head");
    const title = h("div", "xm-title", "X Media Harvest");
    const badge = h("span", "xm-badge", "v1.0.0");
    const collapse = h("button", "xm-x", "\u2013");
    const close = h("button", "xm-x", "\u00d7");
    head.append(title, badge, collapse, close);

    const bar = h("div", "xm-bar");
    const mode = h("select", "xm-btn");
    [["profile", "Profile"], ["thread", "Thread"], ["search", "Search"]].forEach(([v, label]) => {
      const o = h("option", null, label);
      o.value = v;
      mode.appendChild(o);
    });
    mode.value = settings.mode;
    const target = h("input", "xm-target");
    const btnScan = h("button", "xm-btn primary", "Scan media");
    const btnRun = h("button", "xm-btn", "Harvest 0");
    const btnStop = h("button", "xm-btn", "Stop");
    const btnCopy = h("button", "xm-btn", "Copy URLs");
    const btnList = h("button", "xm-btn", "URL list");
    const btnJson = h("button", "xm-btn", "Manifest");
    btnRun.disabled = btnStop.disabled = btnCopy.disabled = btnList.disabled = btnJson.disabled = true;
    bar.append(mode, target, btnScan, btnRun, btnStop, btnCopy, btnList, btnJson);

    const stat = h("div", "xm-stat", "Pick a mode, enter a handle / tweet URL / query, scan, then confirm.");
    const prog = h("div", "xm-prog");
    const progFill = h("i");
    prog.appendChild(progFill);

    const wrap = h("div", "xm-wrap");
    const table = h("table", "xm-table");
    const thead = h("thead");
    const hr = h("tr");
    ["", "Kind", "URL", "From", "Status"].forEach((label, i) => {
      const th = h("th", null, label);
      if (i === 0) th.style.width = "52px";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = h("tbody");
    table.append(thead, tbody);
    wrap.appendChild(table);

    const logBox = h("div", "xm-log");
    const setBox = h("details", "xm-set");
    setBox.appendChild(h("summary", null, "Options"));
    const vidField = h("label", "xm-field");
    const vidIn = h("input");
    vidIn.type = "checkbox";
    vidIn.checked = settings.videos;
    vidField.append(vidIn, h("span", null, "Include video / GIF"));
    const verField = h("label", "xm-field");
    const verIn = h("input");
    verIn.type = "checkbox";
    verIn.checked = settings.verify;
    verField.append(verIn, h("span", null, "Verify links with a HEAD request"));
    const maxField = h("label", "xm-field");
    maxField.append(h("span", null, "Max items"));
    const maxIn = h("input");
    maxIn.type = "number";
    maxIn.min = "1";
    maxIn.max = "2000";
    maxIn.value = String(settings.max);
    maxField.appendChild(maxIn);
    const conField = h("label", "xm-field");
    conField.append(h("span", null, "Verify workers"));
    const conIn = h("input");
    conIn.type = "number";
    conIn.min = "1";
    conIn.max = "5";
    conIn.value = String(settings.concurrency);
    conField.appendChild(conIn);
    setBox.append(vidField, verField, maxField, conField);

    const body = h("div", "xm-body");
    body.append(bar, stat, prog, wrap, setBox, logBox);
    panel.append(head, body);
    const chip = h("button", "xm-chip", "\u2191 Media Harvest");
    document.body.append(panel, chip);

    head.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      const dx = ev.clientX - r.left;
      const dy = ev.clientY - r.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      const move = (e) => {
        panel.style.left = Math.max(0, e.clientX - dx) + "px";
        panel.style.top = Math.max(0, e.clientY - dy) + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    collapse.addEventListener("click", () => {
      panel.classList.add("xm-hide");
      chip.style.display = "block";
    });
    chip.addEventListener("click", () => {
      chip.style.display = "none";
      panel.classList.remove("xm-hide");
    });
    close.addEventListener("click", () => {
      panel.remove();
      chip.remove();
    });

    const sync = () => {
      settings.mode = mode.value;
      settings.videos = vidIn.checked;
      settings.verify = verIn.checked;
      settings.max = Math.max(1, Math.min(2000, Number(maxIn.value) || 300));
      settings.concurrency = Math.max(1, Math.min(5, Number(conIn.value) || 3));
      saveSettings();
      ui.placeholder();
    };
    [mode, vidIn, verIn, maxIn, conIn].forEach((n) => n.addEventListener("change", sync));
    target.addEventListener("change", () => { settings.target = target.value; saveSettings(); });

    const ui = {
      panel: panel,
      chip: chip,
      mode: mode,
      target: target,
      btnScan: btnScan,
      btnRun: btnRun,
      btnStop: btnStop,
      btnCopy: btnCopy,
      btnList: btnList,
      btnJson: btnJson,
      progFill: progFill,
      tbody: tbody,
      placeholder: () => {
        target.placeholder = mode.value === "profile" ? "@handle or profile URL"
          : mode.value === "thread" ? "tweet URL in the thread"
          : "search query, e.g. #sunset filter:images";
      },
      log: (msg, cls) => {
        const line = h("div", cls || null, "[" + new Date().toLocaleTimeString() + "] " + msg);
        logBox.appendChild(line);
        while (logBox.childElementCount > 400) logBox.firstChild.remove();
        logBox.scrollTop = logBox.scrollHeight;
      },
      stat: (t) => { stat.textContent = t; },
      progress: (done, total) => { progFill.style.width = (total ? (done / total) * 100 : 0) + "%"; },
      clearRows: () => { tbody.textContent = ""; },
      row: (item) => {
        const tr = h("tr");
        const td0 = h("td");
        if (item.poster) {
          const img = h("img", "xm-thumb");
          img.src = item.poster;
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          td0.appendChild(img);
        }
        const td1 = h("td");
        td1.appendChild(h("span", "xm-kind" + (item.type === "photo" ? "" : " vid"), item.type));
        const td2 = h("td");
        const a = h("a", "xm-url", item.url.length > 92 ? item.url.slice(0, 92) + "…" : item.url);
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        td2.appendChild(a);
        const td3 = h("td");
        const tl = h("a", "xm-url", "@" + item.author);
        tl.href = item.tweet;
        tl.target = "_blank";
        tl.rel = "noreferrer";
        td3.appendChild(tl);
        const td4 = h("td");
        const st = h("span", "xm-st", "collected");
        td4.appendChild(st);
        tr.append(td0, td1, td2, td3, td4);
        tbody.appendChild(tr);
        item.tr = tr;
        item.st = st;
      },
      setStatus: (item, text, cls) => {
        item.st.textContent = text;
        item.st.className = "xm-st" + (cls ? " " + cls : "");
      },
    };
    return ui;
  }

  // ---------- state ----------
  let ui = null;
  let items = [];
  let phase = "idle";
  const run = { stop: false, done: 0, ok: 0, dead: 0, skip: 0 };

  function refresh() {
    if (!ui) return;
    const ready = phase === "ready" && items.length > 0;
    ui.btnRun.textContent = phase === "verifying" ? "Verifying…" : "Harvest " + items.length;
    ui.btnRun.disabled = !ready;
    ui.btnCopy.disabled = ui.btnList.disabled = ui.btnJson.disabled = !ready;
    ui.btnStop.disabled = phase !== "verifying";
  }

  function normaliseTarget() {
    const raw = (ui.target.value || "").trim();
    if (!raw) throw new Error("Enter a target first.");
    if (settings.mode === "profile") {
      const m = raw.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/) || raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
      if (!m) throw new Error("Not a handle or profile URL.");
      return m[1];
    }
    if (settings.mode === "thread") {
      const id = statusIdFrom(raw) || statusIdFrom(location.href);
      if (!id) throw new Error("Not a tweet URL.");
      return id;
    }
    return raw;
  }

  async function scan() {
    phase = "idle";
    ui.clearRows();
    items = [];
    ui.btnScan.disabled = true;
    refresh();
    const store = new Map();
    try {
      const t = normaliseTarget();
      ui.log("Scanning " + settings.mode + " " + t + "…");
      if (settings.mode === "profile") await fromProfile(t, store);
      else if (settings.mode === "thread") await fromThread(t, store);
      else await fromSearch(t, store);
      items = [...store.values()].slice(0, settings.max);
      ui.clearRows();
      items.forEach((it) => ui.row(it));
      const photos = items.filter((i) => i.type === "photo").length;
      ui.log("Dry run: " + items.length + " unique media (" + photos + " photos, " + (items.length - photos) + " video/GIF).");
      if (!items.length) ui.log("Nothing found - try a different target or enable video.", "xm-st err");
      phase = "ready";
      ui.stat(items.length + " items collected. Confirm to verify and build the manifest.");
    } catch (e) {
      ui.log("Scan failed: " + e.message, "xm-st err");
      ui.stat("Scan failed - see log.");
    } finally {
      ui.btnScan.disabled = false;
      refresh();
    }
  }

  async function verify(item) {
    try {
      const r = await fetch(item.url, { method: "HEAD", credentials: "omit" });
      if (r.ok || r.type === "opaque") { run.ok++; ui.setStatus(item, "live", "ok"); }
      else { run.dead++; ui.setStatus(item, "HTTP " + r.status, "err"); }
    } catch (e) {
      // CORS can refuse a HEAD even when the file is fine - report it as unchecked, not dead.
      run.skip++;
      ui.setStatus(item, "unchecked");
    }
  }

  async function start() {
    if (phase !== "ready" || !items.length) return;
    phase = "verifying";
    run.stop = false;
    run.done = run.ok = run.dead = run.skip = 0;
    ui.btnScan.disabled = true;
    refresh();
    ui.progress(0, items.length);
    ui.log("Verifying " + items.length + " links, " + settings.concurrency + " workers.");
    if (!settings.verify) {
      items.forEach((i) => ui.setStatus(i, "unverified"));
      run.done = items.length;
      ui.progress(1, 1);
    } else {
      let i = 0;
      const workers = Array.from({ length: Math.min(settings.concurrency, items.length) }, async () => {
        while (i < items.length) {
          if (run.stop) return;
          const item = items[i++];
          if (!item) return;
          ui.setStatus(item, "checking…");
          await verify(item);
          run.done++;
          ui.progress(run.done, items.length);
          if (!run.stop) await jitter();
        }
      });
      await Promise.all(workers);
    }
    phase = "done";
    ui.btnScan.disabled = false;
    ui.stat(run.ok + " live, " + run.dead + " dead, " + run.skip + " unchecked. Export the list or manifest.");
    ui.log((run.stop ? "Stopped. " : "Verified. ") + run.ok + " live, " + run.dead + " dead, " + run.skip + " unchecked.");
    refresh();
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type });
    const a = h("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  const live = () => items.filter((i) => !/HTTP|unreachable/.test(i.st.textContent));

  function mount() {
    if (document.querySelector(".xm-panel") || !document.body) return;
    ui = makeUI();
    ui.placeholder();
    ui.target.value = settings.target || "";
    ui.btnScan.addEventListener("click", scan);
    ui.btnRun.addEventListener("click", start);
    ui.btnStop.addEventListener("click", () => { run.stop = true; ui.log("Stop requested."); });
    ui.btnCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(items.map((i) => i.url).join("\n"));
        ui.log("Copied " + items.length + " URLs.");
      } catch (e) {
        ui.log("Clipboard refused: " + e.message, "xm-st err");
      }
    });
    ui.btnList.addEventListener("click", () => {
      download("x-media-" + stamp() + ".txt", items.map((i) => i.url).join("\n"), "text/plain");
      ui.log("URL list downloaded.");
    });
    ui.btnJson.addEventListener("click", () => {
      const manifest = {
        mode: settings.mode,
        target: ui.target.value,
        exported: new Date().toISOString(),
        count: items.length,
        items: items.map((i) => ({ type: i.type, url: i.url, author: i.author, tweet: i.tweet, live: !/HTTP/.test(i.st.textContent) })),
      };
      download("x-media-manifest-" + stamp() + ".json", JSON.stringify(manifest, null, 2), "application/json");
      ui.log("JSON manifest downloaded.");
    });
    ui.log("Ready. Harvest never posts or deletes - it only reads and downloads lists.");
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!document.querySelector(".xm-panel")) mount();
  }, 800);

  document.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== "m" || isTyping()) return;
    e.preventDefault();
    if (!ui) return mount();
    if (ui.panel.classList.contains("xm-hide")) ui.chip.click(); else ui.panel.classList.toggle("xm-hide");
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
