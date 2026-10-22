/*
 * JUS MUSIC - FEATURES ADD-ON (v2.3)   file: jus-features.js
 *
 * REPLACES the earlier jus-features.js (same file name, new content).
 *
 *   - Simple player: heart, title, ⋯ above; shuffle / previous / play / next / repeat below.
 *     Everything else (speed, volume, lyrics, info, playlist, sleep timer, share, download)
 *     lives in the ⋯ sheet.
 *   - One organised ⋮ menu: Library, Appearance, Player, Account, and an Admin section
 *     that only admins see.
 *   - Admin dashboard: library stats, users and roles, tools.
 *   - One Theme picker: dark purple, white, black & yellow, midnight blue,
 *     forest green, rose, pure black.
 *   - Sorting, song info, history, lyrics, share, download, songs from this device.
 *
 * If this file fails to load, the normal player keeps working.
 */
(function () {

  /* ------------------------------------------------------------
   * DOWNLOAD RULES
   *   Admins: any song they can see. Everyone: songs they uploaded.
   *   Other people's shared songs: true = allowed, false = blocked.
   * (Controls the buttons only. It is not a security lock.)
   * ------------------------------------------------------------ */
  var USERS_CAN_DOWNLOAD_SHARED = true;

  var TEST = typeof __JM_TEST__ !== "undefined";

  /* ============================================================
   * HELPERS (pure, easy to test)
   * ============================================================ */

  function esc2(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function cleanTitle(name) {
    var s = String(name || "");
    s = s.replace(/\.[a-z0-9]{2,5}$/i, "");
    s = s.replace(/[\(\[\{][^\)\]\}]*(kbps|official|lyric|video|audio|\bhd\b|\bfrom\b|www|\.com|\.in\b|\.pk|\.net|free|download|full song|mp3)[^\)\]\}]*[\)\]\}]/gi, " ");
    s = s.replace(/\bwww\.[^\s]+/gi, " ").replace(/_+/g, " ");
    s = s.replace(/\s*[-_]?\s*copy(\s*\(\d+\))?\s*$/i, "").replace(/\s*\(\d+\)\s*$/, "");
    s = s.replace(/^\s*\d{1,3}\s*[\.\)\-_]\s*/, "").replace(/^\s*0\d\s+/, "");
    s = s.replace(/[\s\-–]+$/, "").replace(/\s+/g, " ").trim();
    return s;
  }

  function extFor(mime) {
    var m = String(mime || "").toLowerCase();
    if (/mpeg|mp3/.test(m)) return "mp3";
    if (/mp4|m4a|aac/.test(m)) return m.indexOf("aac") >= 0 && m.indexOf("mp4") < 0 ? "aac" : "m4a";
    if (/ogg|opus/.test(m)) return "ogg";
    if (/wav/.test(m)) return "wav";
    if (/flac/.test(m)) return "flac";
    if (/webm/.test(m)) return "webm";
    return "mp3";
  }

  function sortOrder(songs, mode, plays) {
    var a = songs.slice();
    var L = function (x, y) {
      return String(x).localeCompare(String(y), undefined, { sensitivity: "base", numeric: true });
    };
    plays = plays || {};
    if (mode === "added-desc") a.sort(function (x, y) { return y.added - x.added; });
    else if (mode === "title-asc") a.sort(function (x, y) { return L(x.title, y.title) || x.added - y.added; });
    else if (mode === "title-desc") a.sort(function (x, y) { return L(y.title, x.title) || x.added - y.added; });
    else if (mode === "artist-asc") a.sort(function (x, y) { return L(x.artist, y.artist) || L(x.title, y.title); });
    else if (mode === "plays-desc") a.sort(function (x, y) { return (plays[y.id] || 0) - (plays[x.id] || 0) || x.added - y.added; });
    else a.sort(function (x, y) { return x.added - y.added; });
    return a;
  }

  function canDownload(s, me) {
    if (!s || !me || s.online || s.local) return false;
    if (me.role === "admin" || s.owner === me.name) return true;
    return USERS_CAN_DOWNLOAD_SHARED && (!s.visibility || s.visibility === "shared");
  }

  function ago(ms, nowMs) {
    var d = Math.max(0, Math.round(((nowMs || Date.now()) - ms) / 1000));
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + " min ago";
    if (d < 86400) return Math.floor(d / 3600) + " h ago";
    if (d < 172800) return "yesterday";
    return new Date(ms).toLocaleDateString();
  }

  function stripTimes(t) {
    return String(t || "").replace(/^\s*\[[^\]]*\]\s*/gm, "").trim();
  }

  function adminStats(songs, nowMs) {
    function by(f) {
      var o = {};
      songs.forEach(function (s) { var k = f(s) || "—"; o[k] = (o[k] || 0) + 1; });
      return o;
    }
    return {
      total: songs.length,
      week: songs.filter(function (s) { return s.added > (nowMs || Date.now()) - 6048e5; }).length,
      noArtist: songs.filter(function (s) { return !s.artist || /^unknown$/i.test(s.artist); }).length,
      restricted: songs.filter(function (s) { return s.visibility && s.visibility !== "shared"; }).length,
      lang: by(function (s) { return s.language; }),
      owner: by(function (s) { return s.owner; })
    };
  }

  // "spotifydown.com", "www.xyz.in", "mp3khan"... are websites, not artists
  var SITE = /(\.(com|in|pk|net|org|fm|co|me|cc|to|xyz|info)\b)|^\s*www\.|spotifydown|mp3khan|mr-?jatt|djpunjab|pagalworld|songspk|wapking/i;
  function looksLikeSite(name) { return !!name && SITE.test(String(name)); }

  function topEntries(o, n) {
    return Object.keys(o).map(function (k) { return [k, o[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
  }

  async function getLyrics(s, fetchFn) {
    var title = cleanTitle(s.title);
    var artist = (s.artist && !/^(unknown|this device)$/i.test(s.artist)) ? s.artist : "";
    var base = "https://lrclib.net/api/";
    var enc = encodeURIComponent;
    async function j(u) {
      try {
        var r = await fetchFn(u);
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { return null; }
    }
    function pick(x) {
      if (!x || !(x.plainLyrics || x.syncedLyrics)) return null;
      return {
        text: x.plainLyrics ? String(x.plainLyrics).trim() : stripTimes(x.syncedLyrics),
        track: x.trackName || title, artist: x.artistName || artist
      };
    }
    var hit = null;
    if (artist) hit = pick(await j(base + "get?track_name=" + enc(title) + "&artist_name=" + enc(artist)));
    if (!hit) {
      var urls = [];
      if (artist) urls.push(base + "search?track_name=" + enc(title) + "&artist_name=" + enc(artist));
      urls.push(base + "search?track_name=" + enc(title));
      urls.push(base + "search?q=" + enc((title + " " + artist).trim()));
      for (var i = 0; i < urls.length && !hit; i++) {
        var arr = await j(urls[i]);
        if (Array.isArray(arr)) {
          for (var k = 0; k < arr.length && !hit; k++) hit = pick(arr[k]);
        }
      }
    }
    return hit;
  }

  if (TEST) {
    globalThis.__jf = {
      cleanTitle: cleanTitle, extFor: extFor, sortOrder: sortOrder,
      canDownload: canDownload, ago: ago, getLyrics: getLyrics, stripTimes: stripTimes,
      adminStats: adminStats, topEntries: topEntries, looksLikeSite: looksLikeSite
    };
    return;
  }

  /* ============================================================
   * PLUG INTO THE PLAYER
   * ============================================================ */

  if (typeof play !== "function" || typeof step !== "function" ||
      typeof refresh !== "function" || typeof teardownStream !== "function" ||
      typeof au === "undefined" || typeof $ !== "function") {
    console.warn("jus-features.js: player not found, add-on not started");
    return;
  }

  function jget(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
  }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uname() { return me ? me.name : "guest"; }
  function fetchT(u) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, 10000);
    return fetch(u, { signal: c.signal }).finally(function () { clearTimeout(t); });
  }
  function toast(m) { var s = $("status"); if (s) s.textContent = m; }
  function isAdmin() { return !!(me && me.role === "admin"); }
  function dlog(m) { try { if (typeof dbg === "function") dbg("features: " + m); } catch (e) {} }
  function fail(part, e) {
    dlog(part + " FAILED: " + (e && e.message || e));
    try { console.error("jus-features: " + part, e); } catch (x) {}
  }
  function cleanArtists() {
    (songs || []).forEach(function (s) {
      if (s && s.artist && s.artist !== "Unknown" && looksLikeSite(s.artist)) s.artist = "Unknown";
    });
  }
  function sleepTxt() {
    var t = ($("sleepBtn").textContent || "").replace(/^\s*⏲\s*/, "").trim();
    return (!t || /^sleep/i.test(t)) ? "Off" : t;
  }

  /* ---------------- history + play counts ---------------- */
  function record(s) {
    if (!s || !s.id || s.online || s.local || !me) return;
    var h = jget("jmHist_" + uname(), []);
    if (!h.length || h[0].id !== s.id) {
      h.unshift({ id: s.id, t: Date.now() });
      jset("jmHist_" + uname(), h.slice(0, 200));
    }
    var p = jget("jmPlays_" + uname(), {});
    p[s.id] = (p[s.id] || 0) + 1;
    jset("jmPlays_" + uname(), p);
  }

  /* ---------------- songs from this device ---------------- */
  var devItems = [];

  function setSession(s) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: "Jus Music" });
      navigator.mediaSession.setActionHandler("nexttrack", function () { step(1); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { step(-1); });
      navigator.mediaSession.setActionHandler("play", function () { want = true; au.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler("pause", function () { au.pause(); });
      navigator.mediaSession.playbackState = "playing";
    } catch (e) {}
  }

  async function playLocal(s) {
    var my = ++loadId;
    loadedId = null;
    try { teardownStream(); } catch (e) {}
    if (ctl) { try { ctl.abort(); } catch (e) {} }
    pfc.forEach(function (c) { try { c.abort(); } catch (e) {} });
    pfc.clear(); pend.clear();
    want = true;
    now = s;
    $("nowPlaying").textContent = s.title + " — " + s.artist;
    $("status").textContent = "Loading from this device...";
    try { $("progress").disabled = false; } catch (e) {}
    setSession(s);
    markActive();
    au.src = s.url;
    loadedId = s.id;
    try {
      await au.play();
      if (my !== loadId || !want) return;
      $("status").textContent = "Playing · from this device";
    } catch (e) {
      if (my !== loadId) return;
      if (e && e.name === "AbortError") return;
      $("status").textContent = (e && e.name === "NotAllowedError") ? "Tap ▶ to continue" : "Can't play this file";
    }
    if ($("devDlg").open) renderDev();
  }

  function localStep(dir) {
    var q = devItems.length ? devItems : [now];
    var i = q.findIndex(function (x) { return x.id === now.id; });
    if (q.length < 2) { au.currentTime = 0; au.play().catch(function () {}); return; }
    if (i < 0) i = dir > 0 ? -1 : 0;
    var n;
    if (shuffle && dir > 0) {
      do { n = Math.floor(Math.random() * q.length); } while (q[n].id === now.id);
    } else n = (i + dir + q.length) % q.length;
    playLocal(q[n]);
  }

  var _play = window.play;
  window.play = function (s) {
    if (s && s.local) return playLocal(s);
    if (s && !s.online) {
      try { $("progress").disabled = false; } catch (e) {}
      record(s);
    }
    return _play.apply(this, arguments);
  };

  var _step = window.step;
  window.step = function (dir) {
    if (now && now.local) return localStep(dir);
    return _step.apply(this, arguments);
  };

  function syncNpFav() {
    var h = document.getElementById("npFav"), f = $("favBtn");
    if (!h || !f) return;
    var on = f.classList.contains("active");
    h.textContent = on ? "♥" : "♡";
    h.classList.toggle("active", on);
  }

  var _favSync = window.favSync;
  window.favSync = function () {
    var r;
    if (now && now.local) {
      $("favBtn").innerHTML = '<span class="control-icon">♡</span>';
      $("favBtn").classList.remove("active");
    } else {
      r = _favSync.apply(this, arguments);
    }
    syncNpFav();
    return r;
  };

  var _favClick = $("favBtn").onclick;
  $("favBtn").onclick = function (e) {
    if (now && now.local) { toast("Songs from this device can't be favourited"); return; }
    return _favClick && _favClick.call(this, e);
  };

  var _onerror = au.onerror;
  au.onerror = function (ev) {
    if (now && now.local) { toast("Can't play this file on this device"); return; }
    return _onerror && _onerror.call(this, ev);
  };

  if (typeof trackChanged === "function") {
    var _tc = window.trackChanged;
    window.trackChanged = function (s) { var r = _tc.apply(this, arguments); record(s); return r; };
  }

  /* ---------------- themes (one picker) ---------------- */
  var THEMES = [
    { id: "purple", name: "Dark purple", bg: "#09090b", ac: "#9b5cff" },
    { id: "light", name: "White", bg: "#f6f6f8", ac: "#9b5cff" },
    { id: "yellow", name: "Black & yellow", bg: "#000000", ac: "#ffc400" },
    { id: "blue", name: "Midnight blue", bg: "#070b14", ac: "#4da3ff" },
    { id: "green", name: "Forest green", bg: "#060d0a", ac: "#2ee59d" },
    { id: "rose", name: "Rose", bg: "#0f070a", ac: "#ff4d8d" },
    { id: "amoled", name: "Pure black", bg: "#000000", ac: "#ffffff" }
  ];
  var themeId = "purple";

  function applyTheme(id) {
    var th = THEMES.filter(function (t) { return t.id === id; })[0] || THEMES[0];
    id = th.id; themeId = id;
    var b = document.body, h = document.documentElement;
    ["th-yellow", "th-blue", "th-green", "th-rose", "th-amoled", "themed"].forEach(function (c) {
      b.classList.remove(c); h.classList.remove(c);
    });
    if (id === "light") {
      if (typeof theme === "function") theme(true); else b.classList.add("light");
    } else {
      if (typeof theme === "function") theme(false); else b.classList.remove("light");
      if (id !== "purple") { b.classList.add("th-" + id); b.classList.add("themed"); h.classList.add("th-" + id); }
    }
    try { localStorage.setItem("jmThemeName", id); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", th.bg);
    var mb = document.getElementById("mThemePick");
    if (mb) mb.innerHTML = "🎨 &nbsp; Theme: " + esc2(th.name);
    var cards = document.querySelectorAll("#themeGrid .theme-card");
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle("on", cards[i].dataset.th === id);
  }

  /* ---------------- sorting (rank trick, then the normal refresh runs) ---------------- */
  var sortMode = "added-asc";
  try { sortMode = localStorage.getItem("jmSort") || "added-asc"; } catch (e) {}

  var _refresh = window.refresh;
  window.refresh = function () {
    var out;
    try { cleanArtists(); } catch (e) {}
    if (!songs || !songs.length || sortMode === "added-asc") {
      out = _refresh.apply(this, arguments);
    } else {
      var saved = songs.map(function (s) { return s.added; });
      var order = sortOrder(songs, sortMode, jget("jmPlays_" + uname(), {}));
      order.forEach(function (s, i) { s.added = i; });   // temporary ranks
      try { out = _refresh.apply(this, arguments); }
      finally { songs.forEach(function (s, i) { s.added = saved[i]; }); }
    }
    try { augmentRows(); } catch (e) {}
    return out;
  };

  /* ---------------- extra items in each song's ⋮ menu ---------------- */
  function augmentRows() {
    var rows = document.querySelectorAll("#songs .song-row");
    for (var i = 0; i < rows.length; i++) {
      var menu = rows[i].querySelector(".row-menu");
      if (!menu || menu.querySelector("[data-xinfo]")) continue;
      var id = rows[i].dataset.id;
      var s = songs.find(function (x) { return x.id === id; });
      var h = '<button data-xinfo="' + id + '">ℹ &nbsp;Song info</button>' +
        '<button data-xlyr="' + id + '">♪ &nbsp;Lyrics</button>' +
        '<button data-xshare="' + id + '">↗ &nbsp;Share</button>';
      if (canDownload(s, me)) h += '<button data-xdl="' + id + '">⬇ &nbsp;Download</button>';
      menu.insertAdjacentHTML("afterbegin", h);
    }
  }

  function songById(id) { return songs.find(function (x) { return x.id === id; }); }

  /* ---------------- share + download ---------------- */
  function shareUrl(s) {
    return location.origin + location.pathname.replace(/test\.html$/i, "") + "?song=" + encodeURIComponent(s.id);
  }
  async function shareSong(s) {
    var url = shareUrl(s), text = s.title + " — " + s.artist + " on Jus Music";
    if (navigator.share) {
      try { await navigator.share({ title: s.title, text: text, url: url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch (e) { prompt("Copy this link:", url); }
  }

  async function downloadSong(s) {
    if (!canDownload(s, me)) { toast("Downloading this song is not allowed"); return; }
    toast("Preparing download...");
    try {
      var buf = await bytesFor(s, undefined);
      var blob = new Blob([buf], { type: s.mime || "audio/mpeg" });
      var a = document.createElement("a");
      var name = (s.artist && s.artist !== "Unknown" ? s.artist + " - " : "") + s.title;
      a.download = name.replace(/[\\\/:*?"<>|]+/g, " ").trim() + "." + extFor(s.mime);
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      toast("Download started");
    } catch (e) {
      toast("Download failed: " + (e && e.message || e));
    }
  }

  var _resume = window.resumeLast;
  window.resumeLast = function () {
    var r = _resume ? _resume.apply(this, arguments) : undefined;
    try {
      var id = new URLSearchParams(location.search).get("song");
      if (id) {
        var s = songById(id);
        if (s) {
          now = s; loadedId = null; want = false;
          $("nowPlaying").textContent = s.title + " — " + s.artist;
          toast("Shared song ready - tap ▶");
          markActive();
          history.replaceState(null, "", location.pathname);
        }
      }
    } catch (e) {}
    return r;
  };

  /* ============================================================
   * STYLES
   * ============================================================ */

  var CSS = [
    /* theme colour sets */
    "html.th-yellow,body.th-yellow{--bg:#000;--surface:#0b0b0b;--surface-2:#141414;--surface-3:#1e1e1e;--text:#f7f3e3;--text-soft:#a8a18a;--border:rgba(255,196,0,.17);--accent:#ffc400;--accent-2:#e0a800;--acc:255,196,0;--hdr:0,0,0;--on-acc:#000}",
    "html.th-blue,body.th-blue{--bg:#070b14;--surface:#0d1422;--surface-2:#121b2e;--surface-3:#1a2540;--text:#eaf1ff;--text-soft:#93a4c4;--border:rgba(77,163,255,.16);--accent:#4da3ff;--accent-2:#2b7de9;--acc:77,163,255;--hdr:7,11,20;--on-acc:#fff}",
    "html.th-green,body.th-green{--bg:#060d0a;--surface:#0c1612;--surface-2:#111f19;--surface-3:#182b22;--text:#e9fff5;--text-soft:#8fb3a2;--border:rgba(46,229,157,.15);--accent:#2ee59d;--accent-2:#12b981;--acc:46,229,157;--hdr:6,13,10;--on-acc:#00130b}",
    "html.th-rose,body.th-rose{--bg:#0f070a;--surface:#1a0d12;--surface-2:#24121a;--surface-3:#321a25;--text:#fff0f5;--text-soft:#c49aa9;--border:rgba(255,77,141,.16);--accent:#ff4d8d;--accent-2:#e11d6a;--acc:255,77,141;--hdr:15,7,10;--on-acc:#fff}",
    "html.th-amoled,body.th-amoled{--bg:#000;--surface:#080808;--surface-2:#101010;--surface-3:#191919;--text:#fff;--text-soft:#9a9a9a;--border:rgba(255,255,255,.12);--accent:#fff;--accent-2:#cfcfcf;--acc:255,255,255;--hdr:0,0,0;--on-acc:#000}",
    /* the player's own purple bits, recoloured for every non-purple dark theme */
    "body.themed header{background:rgba(var(--hdr),.93)}",
    "body.themed #player{background:linear-gradient(180deg,rgba(var(--hdr),.97),var(--bg))}",
    "body.themed .brand-title{background:linear-gradient(90deg,var(--text),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}",
    "body.themed .folder-btn.active,body.themed .library-menu .folder-btn.active,body.themed .pbtn:not(.alt){color:var(--on-acc)}",
    "body.themed .header-btn:hover,body.themed .header-btn.active{border-color:rgba(var(--acc),.55)}",
    "body.themed #search:focus,body.themed .in:focus{border-color:rgba(var(--acc),.6);box-shadow:0 0 0 3px rgba(var(--acc),.12)}",
    "body.themed .song-row.active{border-color:rgba(var(--acc),.5);background:linear-gradient(145deg,rgba(var(--acc),.14),var(--surface-2));box-shadow:inset 3px 0 0 var(--accent),0 7px 22px rgba(0,0,0,.2)}",
    "body.themed .controls .control-btn.mode.active,body.themed .controls2 .control-btn.mode.active,body.themed .controls2 .control-btn.on{color:var(--accent);border-color:rgba(var(--acc),.7);background:linear-gradient(160deg,rgba(var(--acc),.16),#050506)}",
    "body.themed .controls .control-btn.main{border-color:rgba(var(--acc),.75)}",
    "body.themed #progress::-webkit-slider-thumb,body.themed #volume::-webkit-slider-thumb{background:var(--accent);box-shadow:0 0 0 4px rgba(var(--acc),.16)}",
    "body.themed #progress::-moz-range-thumb,body.themed #volume::-moz-range-thumb{background:var(--accent)}",
    "body.themed .web-item.on,body.themed .x-item.on{border-color:rgba(var(--acc),.55);background:rgba(var(--acc),.10)}",
    "body.themed .playlist-card:hover{border-color:rgba(var(--acc),.5)}",
    /* clean header: only brand, search and the ⋮ menu */
    ".desktop-action{display:none!important}",
    /* the "All Songs | Sort | Playlists" row: same height, one line, evenly shared */
    "html,body{max-width:100%;overflow-x:hidden}",
    ".library-bar{display:flex;align-items:stretch;gap:8px;flex-wrap:nowrap}",
    ".library-bar .library-select,.library-bar .sort-sel,.library-bar .playlist-open-btn{height:46px;box-sizing:border-box;margin:0!important;padding:0 12px;font-size:14px;line-height:1.1}",
    ".library-bar .library-select{flex:1 1 0;min-width:0!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}",
    ".library-bar .sort-sel{flex:1 1 0;min-width:0;max-width:none!important}",
    ".library-bar .playlist-open-btn{flex:0 0 auto;white-space:nowrap}",
    /* simple player */
    ".controls2{display:none!important}",
    "body,body.light{--player-height:178px!important}",
    ".np-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}",
    ".np-row #nowPlaying{flex:1;min-width:0;margin-bottom:0}",
    ".np-btn{border:0;background:none;color:var(--text-soft);font-size:26px;line-height:1;cursor:pointer;padding:0 6px;min-width:38px;height:38px}",
    ".np-btn.active{color:var(--accent)}",
    /* organised menu: header sits above the player, so the menu is never hidden behind it */
    "header{z-index:60!important}",
    ".mobile-menu{width:250px;max-height:calc(100vh - 92px);max-height:calc(100dvh - 92px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}",
    ".mobile-menu button{display:flex;align-items:center;gap:10px;white-space:nowrap}",
    ".mobile-menu .ic{width:24px;text-align:center;flex-shrink:0;font-size:17px}",
    /* play button: round and in the theme colour */
    ".controls .control-btn.main{border-radius:50%!important;background:var(--accent)!important;border:0!important;color:var(--on-acc,#fff)!important;box-shadow:none!important}",
    ".menu-h{padding:12px 12px 4px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--text-soft)}",
    ".menu-h.adm-h{color:var(--accent)}",
    /* bottom sheet */
    "dialog.sheet{margin-top:auto;margin-bottom:0;width:min(520px,100vw);max-width:100vw}",
    "dialog.sheet .card{border-radius:22px 22px 0 0;gap:2px;padding:14px 12px 18px}",
    ".sheet-title{text-align:center;font-weight:700;font-size:15px;padding:4px 8px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".sheet-item{display:flex;align-items:center;gap:14px;width:100%;padding:13px 12px;border:0;background:transparent;color:var(--text);font-size:16px;text-align:left;border-radius:12px;cursor:pointer}",
    ".sheet-item:hover,.sheet-item:active{background:var(--surface-3)}",
    ".sheet-item .ic{width:26px;text-align:center;font-size:19px}",
    ".sheet-item .val{margin-left:auto;color:var(--text-soft);font-size:14px}",
    ".sheet-vol{display:flex;align-items:center;gap:14px;padding:10px 12px}",
    ".sheet-vol input{flex:1;accent-color:var(--accent)}",
    /* misc windows */
    ".sort-sel{border:1px solid var(--border);background:linear-gradient(145deg,var(--surface-3),var(--surface-2));color:var(--text);border-radius:14px;padding:11px 10px;cursor:pointer;max-width:150px;font-size:14px}",
    ".info-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px}",
    ".info-row span{color:var(--text-soft);flex-shrink:0}",
    ".info-row b{font-weight:600;text-align:right;word-break:break-word}",
    ".x-actions{display:flex;flex-wrap:wrap;gap:8px}",
    ".x-actions .pbtn{flex:1;min-width:90px;padding:11px 8px}",
    ".lyr-text{white-space:pre-wrap;max-height:42vh;overflow:auto;margin:0;font-family:inherit;font-size:15px;line-height:1.6;color:var(--text)}",
    ".hist-list,.dev-list,.adm-list{display:grid;gap:8px;max-height:48vh;overflow:auto}",
    ".x-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(145deg,var(--surface-2),var(--surface));cursor:pointer}",
    ".x-item.on{border-color:rgba(155,92,255,.55)}",
    ".x-item .t{flex:1;min-width:0}",
    ".x-item b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".x-item span{display:block;font-size:12px;color:var(--text-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}",
    ".x-item .pbtn{padding:8px 10px;font-size:13px;flex-shrink:0}",
    ".theme-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    ".theme-card{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2);color:var(--text);cursor:pointer;text-align:left;font-size:14px}",
    ".theme-card.on{border-color:var(--accent);box-shadow:0 0 0 2px rgba(155,92,255,.25)}",
    ".theme-card .sw{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.28);flex-shrink:0}",
    ".stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
    ".stat{border:1px solid var(--border);border-radius:13px;padding:12px;background:var(--surface-2)}",
    ".stat b{display:block;font-size:22px}",
    ".stat span{font-size:12px;color:var(--text-soft)}",
    ".bar-row{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px solid var(--border)}",
    ".bar-row span:last-child{color:var(--text-soft)}",
    ".adm-sub{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-soft);margin:10px 0 2px}"
  ].join("\n");

  function dlg(id, html, cls) {
    var d = document.createElement("dialog");
    d.id = id;
    if (cls) d.className = cls;
    d.innerHTML = '<div class="card">' + html + "</div>";
    document.body.appendChild(d);
    return d;
  }

  /* ============================================================
   * BUILD THE INTERFACE
   * ============================================================ */

  var admEls = [];

  function mount() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    dlg("infoDlg", '<h2>Song info</h2><div id="infoBody"></div><div id="infoActions" class="x-actions"></div>' +
      '<button id="infoClose" class="pbtn alt" type="button">Close</button>');
    dlg("lyrDlg", '<h2 id="lyrTitle">Lyrics</h2><div id="lyrSrc" class="small-note"></div>' +
      '<pre id="lyrText" class="lyr-text"></pre>' +
      '<textarea id="lyrEdit" class="in hide" rows="10" placeholder="Paste lyrics here"></textarea>' +
      '<div class="x-actions"><button id="lyrFind" class="pbtn alt" type="button">Find online</button>' +
      '<button id="lyrMine" class="pbtn alt" type="button">Paste my own</button>' +
      '<button id="lyrSave" class="pbtn hide" type="button">Save</button></div>' +
      '<button id="lyrClose" class="pbtn alt" type="button">Close</button>');
    dlg("histDlg", '<h2>History</h2><div class="small-note">Songs you played on this device.</div>' +
      '<div id="histList" class="hist-list"></div>' +
      '<button id="histClear" class="pbtn alt" type="button">Clear history</button>' +
      '<button id="histClose" class="pbtn alt" type="button">Close</button>');
    dlg("devDlg", "<h2>💾 Songs on this device</h2>" +
      '<div class="small-note">Pick songs from your phone or computer. They play here only and are never uploaded.</div>' +
      '<input id="devFile" type="file" accept="audio/*" multiple class="hide">' +
      '<button id="devPick" class="pbtn" type="button">Choose songs</button>' +
      '<div id="devList" class="dev-list"></div>' +
      '<button id="devClose" class="pbtn alt" type="button">Close</button>');
    dlg("themeDlg", '<h2>🎨 Theme</h2><div id="themeGrid" class="theme-grid">' +
      THEMES.map(function (t) {
        return '<button class="theme-card" type="button" data-th="' + t.id + '"><span class="sw" style="background:linear-gradient(135deg,' +
          t.bg + " 50%," + t.ac + ' 50%)"></span><b>' + esc2(t.name) + "</b></button>";
      }).join("") + '</div><button id="themeClose" class="pbtn alt" type="button">Close</button>');
    dlg("moreDlg",
      '<div id="moreTitle" class="sheet-title">Options</div>' +
      '<button class="sheet-item" id="mrSpeed" type="button"><span class="ic">⚡</span>Playback speed<span class="val" id="mrSpeedTxt">1×</span></button>' +
      '<div class="sheet-vol" id="mrVolRow"><span class="ic">🔊</span><input id="sheetVol" type="range" min="0" max="100" value="100"></div>' +
      '<button class="sheet-item" id="mrSleep" type="button"><span class="ic">⏲</span>Sleep timer<span class="val" id="mrSleepTxt">Off</span></button>' +
      '<button class="sheet-item" id="mrLyr" type="button"><span class="ic">♪</span>Lyrics</button>' +
      '<button class="sheet-item" id="mrInfo" type="button"><span class="ic">ⓘ</span>Song info</button>' +
      '<button class="sheet-item" id="mrPl" type="button"><span class="ic">＋</span>Add to playlist</button>' +
      '<button class="sheet-item" id="mrShare" type="button"><span class="ic">↗</span>Share</button>' +
      '<button class="sheet-item" id="mrDl" type="button"><span class="ic">⬇</span>Download</button>',
      "sheet");
    dlg("adminDlg", '<h2>👑 Admin</h2>' +
      '<div class="web-tabs" id="admTabs" style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="chip on" type="button" data-at="ov">Overview</button>' +
      '<button class="chip" type="button" data-at="us">Users</button>' +
      '<button class="chip" type="button" data-at="tl">Tools</button></div>' +
      '<div id="admBody" class="adm-list" style="max-height:52vh"></div>' +
      '<button id="admClose" class="pbtn alt" type="button">Close</button>');

    /* ---- simple player: heart + title + ⋯ on one row ---- */
    try {
    var np = $("nowPlaying");
    if (np && np.parentNode) {
      var row = document.createElement("div");
      row.className = "np-row";
      np.parentNode.insertBefore(row, np);
      var heart = document.createElement("button");
      heart.id = "npFav"; heart.type = "button"; heart.className = "np-btn"; heart.title = "Favourite";
      heart.textContent = "♡";
      heart.onclick = function () { $("favBtn").click(); };
      var more = document.createElement("button");
      more.id = "npMore"; more.type = "button"; more.className = "np-btn"; more.title = "More";
      more.textContent = "⋯";
      more.onclick = openMore;
      row.appendChild(heart);
      row.appendChild(np);
      row.appendChild(more);
    }

    } catch (e) { fail("player row", e); }

    /* ---- organised ⋮ menu ---- */
    try {
    var mm = document.getElementById("mobileMenu");
    function mbtn(id, html, fn) {
      var b = document.createElement("button");
      b.id = id; b.type = "button"; b.innerHTML = html;
      b.onclick = function () { mm.classList.remove("open"); fn(); };
      return b;
    }
    if (mm) {
      if (!document.getElementById("mDev")) mm.appendChild(mbtn("mDev", "💾 &nbsp; Songs on this device", openDev));
      if (!document.getElementById("mHist")) mm.appendChild(mbtn("mHist", "🕘 &nbsp; History", openHist));
      mm.appendChild(mbtn("mThemePick", "🎨 &nbsp; Theme", openTheme));
      mm.appendChild(mbtn("mAdmin", "👑 &nbsp; Admin dashboard", openAdmin));

      var hide = function (id) { var e = document.getElementById(id); if (e) e.classList.add("hide"); };
      hide("mTheme");

      var heading = function (title, adm) {
        var h = document.createElement("div");
        h.className = "menu-h" + (adm ? " adm-h" : "");
        h.textContent = title;
        mm.appendChild(h);
        if (adm) admEls.push(h);
      };
      var put = function (ids, adm) {
        ids.forEach(function (id) {
          var e = document.getElementById(id);
          if (!e) return;
          mm.appendChild(e);              // moving keeps each button's own click action
          if (adm) admEls.push(e);
        });
      };
      heading("Library");
      put(["mWeb", "mDev", "mHist", "mUpload", "mSync"]);
      heading("Appearance");
      put(["mThemePick"]);
      heading("Player");
      put(["sleepBtn", "mStream"]);
      heading("Account");
      put(["mAccount", "mLogout"]);
      heading("Admin tools", true);
      put(["mAdmin", "mDiag", "mLog"], true);
      updateAdminVisibility();
      tidyMenu(mm);

      var mb = document.getElementById("mobileMenuBtn");
      if (mb) mb.addEventListener("click", updateAdminVisibility);
    }

    } catch (e) { fail("menu", e); }

    /* ---- sort menu in the library bar ---- */
    try {
    var bar = document.querySelector(".library-bar");
    var plBtn = document.getElementById("playlistOpenBtn");
    if (bar) {
      var sel = document.createElement("select");
      sel.id = "sortSel"; sel.className = "sort-sel"; sel.title = "Sort songs";
      sel.innerHTML =
        '<option value="added-asc">Sort: oldest</option>' +
        '<option value="added-desc">Sort: newest</option>' +
        '<option value="title-asc">Sort: title A–Z</option>' +
        '<option value="title-desc">Sort: title Z–A</option>' +
        '<option value="artist-asc">Sort: artist A–Z</option>' +
        '<option value="plays-desc">Sort: most played</option>';
      sel.value = sortMode;
      sel.onchange = function () {
        sortMode = sel.value;
        try { localStorage.setItem("jmSort", sortMode); } catch (e) {}
        if (typeof shown !== "undefined") shown = PAGE;
        refresh();
      };
      bar.insertBefore(sel, plBtn || null);
      if (plBtn) plBtn.style.marginLeft = "0";
      sel.style.marginLeft = "auto";
    }

    } catch (e) { fail("sort menu", e); }

    /* ---- wiring ---- */
    try {
    $("infoClose").onclick = function () { $("infoDlg").close(); };
    $("lyrClose").onclick = function () { $("lyrDlg").close(); };
    $("histClose").onclick = function () { $("histDlg").close(); };
    $("devClose").onclick = function () { $("devDlg").close(); };
    $("themeClose").onclick = function () { $("themeDlg").close(); };
    $("admClose").onclick = function () { $("adminDlg").close(); };
    $("themeGrid").onclick = function (e) {
      var c = e.target.closest("[data-th]");
      if (c) applyTheme(c.dataset.th);
    };
    $("lyrFind").onclick = function () { findLyrics(true); };
    $("lyrMine").onclick = function () {
      $("lyrEdit").value = lyrCur && lyrCur.text || "";
      $("lyrEdit").classList.remove("hide");
      $("lyrSave").classList.remove("hide");
      $("lyrText").classList.add("hide");
    };
    $("lyrSave").onclick = function () {
      var t = $("lyrEdit").value.trim();
      var k = "jmLyr_" + lyrSong.id;
      if (t) jset(k, { text: t, own: true }); else localStorage.removeItem(k);
      showLyrics();
    };
    $("histClear").onclick = function () {
      if (confirm("Clear your history?")) { jset("jmHist_" + uname(), []); renderHist(); }
    };
    $("histList").onclick = function (e) {
      var it = e.target.closest("[data-hid]");
      if (!it) return;
      var s = songById(it.dataset.hid);
      if (s) { $("histDlg").close(); play(s); }
    };
    $("devPick").onclick = function () { $("devFile").click(); };
    $("devFile").onchange = function (e) {
      devItems.forEach(function (x) { try { URL.revokeObjectURL(x.url); } catch (er) {} });
      devItems = Array.prototype.slice.call(e.target.files || []).map(function (f, n) {
        return {
          local: true, id: "local:" + n + ":" + f.name + ":" + f.size,
          title: cleanTitle(f.name) || f.name, artist: "This device",
          url: URL.createObjectURL(f)
        };
      });
      e.target.value = "";
      renderDev();
    };
    $("devList").onclick = function (e) {
      var it = e.target.closest("[data-did]");
      if (!it) return;
      var t = devItems[+it.dataset.did];
      if (t) playLocal(t);
    };

    /* ⋯ sheet actions */
    $("mrSpeed").onclick = function () { $("speedBtn").click(); $("mrSpeedTxt").textContent = $("speedBtn").textContent; };
    $("mrSleep").onclick = function () {
      $("sleepBtn").click();
      $("mrSleepTxt").textContent = sleepTxt();
    };
    $("sheetVol").oninput = function () {
      var v = +this.value;
      au.volume = v / 100; au.muted = false;
      var vol = $("volume");
      if (vol) { vol.value = v; if (typeof fillBar === "function") fillBar(vol); }
      try { localStorage.setItem("jmVol", String(v)); } catch (e) {}
    };
    $("mrLyr").onclick = function () { $("moreDlg").close(); if (now) openLyrics(now); };
    $("mrInfo").onclick = function () { $("moreDlg").close(); if (now) openInfo(now); };
    $("mrPl").onclick = function () {
      $("moreDlg").close();
      if (now && !now.online && !now.local && typeof openPlDlg === "function") openPlDlg(now.id);
    };
    $("mrShare").onclick = function () { $("moreDlg").close(); if (now) shareSong(now); };
    $("mrDl").onclick = function () { $("moreDlg").close(); if (now) downloadSong(now); };

    /* admin dashboard */
    $("admTabs").onclick = function (e) {
      var t = e.target.dataset && e.target.dataset.at;
      if (t) admTab(t);
    };
    $("admBody").onclick = async function (e) {
      var b = e.target.closest("[data-urole]");
      if (b) {
        var name = b.dataset.urole, to = b.dataset.to;
        if (!confirm((to === "admin" ? "Make " : "Remove admin from ") + name + "?")) return;
        b.disabled = true;
        var r = await call("setRole", { username: name, role: to });
        if (r && r.ok) loadUsers(); else { alert((r && r.error) || "Could not change the role"); b.disabled = false; }
        return;
      }
      var t = e.target.closest("[data-tool]");
      if (!t) return;
      var k = t.dataset.tool;
      $("adminDlg").close();
      if (k === "diag") $("mDiag").click();
      else if (k === "log") $("mLog").click();
      else if (k === "cache") {
        try { localStorage.removeItem("jmLibCache"); } catch (er) {}
        toast("Saved library cleared - refreshing...");
        $("syncBtn").click();
      }
    };

    /* clicks on the extra items in each song's ⋮ menu */
    $("songs").addEventListener("click", function (ev) {
      var d = ev.target.dataset || {};
      var id = d.xinfo || d.xlyr || d.xshare || d.xdl;
      if (!id) return;
      var s = songById(id);
      if (typeof closeMenus === "function") closeMenus();
      if (!s) return;
      if (d.xinfo) openInfo(s);
      else if (d.xlyr) openLyrics(s);
      else if (d.xshare) shareSong(s);
      else if (d.xdl) downloadSong(s);
    });
    } catch (e) { fail("wiring", e); }
  }

  // icon in its own fixed-width column, so every row lines up
  function tidyItem(b) {
    if (!b || (b.querySelector && b.querySelector(".ic"))) return;
    var m = String(b.textContent || "").trim().match(/^(\S+)[\s\u00a0]+([\s\S]*)$/);
    if (!m) return;
    b.innerHTML = '<span class="ic">' + esc2(m[1]) + '</span><span class="lb">' + esc2(m[2]) + "</span>";
  }
  function tidyMenu(mm) {
    var btns = mm.children || [];
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!b || b.className === "menu-h" || /menu-h/.test(b.className || "")) continue;
      tidyItem(b);
      if (typeof MutationObserver !== "undefined") {
        try {
          new MutationObserver(function (list, ob) {
            var t = list[0] && list[0].target;
            if (t && !(t.querySelector && t.querySelector(".ic"))) tidyItem(t);
          }).observe(b, { childList: true });
        } catch (e) {}
      }
    }
  }

  function updateAdminVisibility() {
    var adm = isAdmin();
    admEls.forEach(function (e) { e.classList.toggle("hide", !adm); });
  }

  /* ---- ⋯ sheet ---- */
  function openMore() {
    var s = now, lib = !!s && !s.online && !s.local;
    $("moreTitle").textContent = s ? s.title : "Nothing playing";
    $("mrLyr").classList.toggle("hide", !s);
    $("mrInfo").classList.toggle("hide", !s);
    $("mrPl").classList.toggle("hide", !lib);
    $("mrShare").classList.toggle("hide", !lib);
    $("mrDl").classList.toggle("hide", !(lib && canDownload(s, me)));
    $("mrSpeedTxt").textContent = $("speedBtn").textContent;
    $("mrSleepTxt").textContent = sleepTxt();
    $("sheetVol").value = Math.round((au.muted ? 0 : au.volume) * 100);
    $("moreDlg").showModal();
  }

  /* ---- theme ---- */
  function openTheme() { applyTheme(themeId); $("themeDlg").showModal(); }

  /* ---- song info ---- */
  var VLAB = { shared: "Everyone", private: "Only the uploader", admin: "Uploader + admins" };

  async function openInfo(s) {
    var rows = [["Title", s.title], ["Artist", s.artist]];
    if (s.local) rows.push(["Source", "This device"]);
    else if (s.online) rows.push(["Source", "Online (" + (s.src === "ia" ? "Internet Archive" : s.src === "ov" ? "Openverse" : s.src === "jam" ? "Jamendo" : s.src === "radio" ? "live radio" : "link") + ")"]);
    else {
      rows.push(["Language", s.language], ["Genre", s.genre]);
      if (s.fl) rows.push(["Folder", s.fl]);
      rows.push(["Format", extFor(s.mime).toUpperCase()]);
      rows.push(["Added", s.added ? new Date(s.added).toLocaleDateString() : "—"]);
      rows.push(["Visible to", VLAB[s.visibility || "shared"] || "Everyone"]);
      if (me && (me.role === "admin" || s.owner === me.name)) rows.push(["Uploaded by", s.owner]);
    }
    if (now && now.id === s.id && isFinite(au.duration) && au.duration > 0) {
      var m = Math.floor(au.duration / 60), sec = Math.floor(au.duration % 60);
      rows.push(["Length", m + ":" + String(sec).padStart(2, "0")]);
    }
    rows.push(["Size", "…"]);
    function draw() {
      $("infoBody").innerHTML = rows.map(function (r) {
        return '<div class="info-row"><span>' + esc2(r[0]) + "</span><b>" + esc2(r[1]) + "</b></div>";
      }).join("");
    }
    draw();
    var acts = '<button class="pbtn alt" data-ia="lyr" type="button">♪ Lyrics</button>';
    if (!s.online && !s.local) acts += '<button class="pbtn alt" data-ia="share" type="button">↗ Share</button>';
    if (canDownload(s, me)) acts += '<button class="pbtn alt" data-ia="dl" type="button">⬇ Download</button>';
    $("infoActions").innerHTML = acts;
    $("infoActions").onclick = function (e) {
      var a = e.target.dataset && e.target.dataset.ia;
      if (!a) return;
      $("infoDlg").close();
      if (a === "lyr") openLyrics(s); else if (a === "share") shareSong(s); else if (a === "dl") downloadSong(s);
    };
    $("infoDlg").showModal();
    if (!s.online && !s.local && s.fileId && typeof DRIVE_KEY === "string") {
      var size = null;
      try {
        var r = await fetchT("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(s.fileId) + "?fields=size&key=" + DRIVE_KEY);
        if (r.ok) { var j = await r.json(); size = +j.size || null; }
      } catch (e) {}
      rows[rows.length - 1][1] = size ? (size / 1048576).toFixed(1) + " MB" : "—";
    } else rows[rows.length - 1][1] = "—";
    draw();
  }

  /* ---- lyrics ---- */
  var lyrSong = null, lyrCur = null;

  function showLyrics() {
    $("lyrEdit").classList.add("hide");
    $("lyrSave").classList.add("hide");
    $("lyrText").classList.remove("hide");
    lyrCur = jget("jmLyr_" + lyrSong.id, null);
    if (lyrCur && lyrCur.text) {
      $("lyrText").textContent = lyrCur.text;
      $("lyrSrc").textContent = lyrCur.own ? "Your own lyrics (saved on this device)"
        : "From LRCLIB" + (lyrCur.track ? " · matched “" + lyrCur.track + (lyrCur.artist ? " — " + lyrCur.artist : "") + "”" : "") + ". Check it is the right song.";
    } else {
      $("lyrText").textContent = "";
      $("lyrSrc").textContent = "No lyrics saved yet.";
    }
  }

  async function findLyrics(force) {
    var s = lyrSong;
    var have = jget("jmLyr_" + s.id, null);
    if (have && have.own && !force) return;
    $("lyrSrc").textContent = "Searching online...";
    $("lyrText").textContent = "";
    var r = null;
    try { r = await getLyrics(s, fetchT); } catch (e) {}
    if (lyrSong !== s) return;
    if (r) {
      jset("jmLyr_" + s.id, { text: r.text, own: false, track: r.track, artist: r.artist });
      showLyrics();
    } else {
      showLyrics();
      $("lyrSrc").textContent = "No lyrics found online for this song. Use “Paste my own” to add them.";
    }
  }

  function openLyrics(s) {
    lyrSong = s;
    $("lyrTitle").textContent = "♪ " + s.title;
    showLyrics();
    $("lyrDlg").showModal();
    if (!lyrCur) findLyrics(false);
  }

  /* ---- history ---- */
  function renderHist() {
    var h = jget("jmHist_" + uname(), []);
    var out = h.map(function (x) {
      var s = songById(x.id);
      if (!s) return "";
      return '<div class="x-item" data-hid="' + esc2(s.id) + '"><div class="t"><b>' + esc2(s.title) + "</b><span>" +
        esc2(s.artist) + " · " + esc2(ago(x.t)) + "</span></div></div>";
    }).join("");
    $("histList").innerHTML = out || '<div class="empty">Nothing played yet.</div>';
  }
  function openHist() { renderHist(); $("histDlg").showModal(); }

  /* ---- my device ---- */
  function renderDev() {
    $("devList").innerHTML = devItems.length ? devItems.map(function (t, i) {
      return '<div class="x-item' + (now && now.id === t.id ? " on" : "") + '" data-did="' + i + '"><div class="t"><b>' +
        esc2(t.title) + "</b><span>This device</span></div></div>";
    }).join("") : '<div class="empty">No songs chosen yet.</div>';
  }
  function openDev() { renderDev(); $("devDlg").showModal(); }

  /* ---- admin dashboard ---- */
  function admTab(t) {
    var chips = document.querySelectorAll("#admTabs .chip");
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].dataset.at === t);
    if (t === "ov") renderOverview();
    else if (t === "us") loadUsers();
    else renderTools();
  }

  function barRows(entries) {
    return entries.map(function (e) {
      return '<div class="bar-row"><span>' + esc2(e[0]) + "</span><span>" + e[1] + "</span></div>";
    }).join("") || '<div class="empty">—</div>';
  }

  function renderOverview() {
    var s = adminStats(songs || [], Date.now());
    $("admBody").innerHTML =
      '<div class="stat-grid">' +
      '<div class="stat"><b>' + s.total + "</b><span>Songs</span></div>" +
      '<div class="stat"><b>' + s.week + "</b><span>Added this week</span></div>" +
      '<div class="stat"><b>' + s.restricted + "</b><span>Private / admin-only</span></div>" +
      '<div class="stat"><b>' + s.noArtist + "</b><span>Missing artist</span></div></div>" +
      '<div class="adm-sub">By language</div>' + barRows(topEntries(s.lang, 8)) +
      '<div class="adm-sub">By uploader</div>' + barRows(topEntries(s.owner, 8));
  }

  async function loadUsers() {
    var box = $("admBody");
    box.textContent = "Loading users...";
    var j = await call("users");
    if (!j || !j.ok) { box.textContent = (j && j.error) || "Could not load users."; return; }
    var counts = adminStats(songs || [], Date.now()).owner;
    var list = (j.users || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    box.innerHTML = list.map(function (u) {
      var self = me && u.name === me.name;
      var to = u.role === "admin" ? "user" : "admin";
      return '<div class="x-item" style="cursor:default"><div class="t"><b>' + esc2(u.name) + (self ? " (you)" : "") + "</b><span>" +
        esc2(u.role) + " · " + (counts[u.name] || 0) + " songs · joined " +
        esc2(u.created ? new Date(u.created).toLocaleDateString() : "—") + "</span></div>" +
        (self ? "" : '<button class="pbtn alt" type="button" data-urole="' + esc2(u.name) + '" data-to="' + to + '">' +
          (to === "admin" ? "Make admin" : "Make user") + "</button>") + "</div>";
    }).join("") || '<div class="empty">No users.</div>';
  }

  function renderTools() {
    $("admBody").innerHTML =
      '<button class="pbtn alt" type="button" data-tool="diag">🛠 Diagnostics</button>' +
      '<button class="pbtn alt" type="button" data-tool="log">🧾 Playback log</button>' +
      '<button class="pbtn alt" type="button" data-tool="cache">⟳ Clear saved library &amp; refresh</button>' +
      '<div class="small-note">Activity logs for every person are saved as text files in your Drive folder (Activity).</div>';
  }

  function openAdmin() {
    if (!isAdmin()) { toast("Admins only"); return; }
    admTab("ov");
    $("adminDlg").showModal();
  }

  /* ============================================================
   * START
   * ============================================================ */
  mount();
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("jmThemeName"); } catch (e) {}
  if (!savedTheme) {
    try { if (localStorage.getItem("jmYellow") === "1") savedTheme = "yellow"; } catch (e) {}
  }
  if (!savedTheme) savedTheme = document.body.classList.contains("light") ? "light" : "purple";
  applyTheme(savedTheme);
  try { refresh(); } catch (e) {}
  window.__jmFeatures = "2.3";
  dlog("add-on v2.3 loaded");
  console.log("Jus Music features add-on v2.3 ready");
})();
