/*
 * JUS MUSIC - FEATURES ADD-ON (v2)   file: jus-features.js
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
      adminStats: adminStats, topEntries: topEntries
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
    "body.themed .controls .control-btn.mode.active,body.themed .controls2 .control-btn.mode.active,body.themed .controls2 .control-btn.on{color:var(--accent);border-color:rgba(var(--acc),.7);background:linear-gradient(160deg,rgba(var(--acc),.16
