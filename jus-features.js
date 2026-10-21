/*
 * JUS MUSIC - FEATURES ADD-ON (jus-features.js, stage 1)
 *
 * Adds, without changing your player's own code:
 *   - Black & yellow theme (on/off, remembered)
 *   - Sorting (title, artist, newest, oldest, most played)
 *   - Song info
 *   - History (what was played, and when)
 *   - Lyrics (found online, or paste your own)
 *   - Share (link opens the app on that song)
 *   - Download (rules below)
 *   - Songs from this device (played privately, never uploaded)
 *
 * If this file fails to load, the normal player keeps working.
 * To remove it: delete the <script src="jus-features.js"> line.
 */
(function () {

  /* ------------------------------------------------------------
   * DOWNLOAD RULES
   *   Admins can download any song they can see.
   *   Everyone can download songs they uploaded themselves.
   *   Other people's shared songs:  true = allowed, false = blocked.
   * (This controls the buttons in the app. It is not a security lock.)
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

  // "03 Kaise Piya Se-(Mr-Jatt.com).mp3" -> "Kaise Piya Se"
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

  // Lyrics from LRCLIB (free, no key). Returns {text, track, artist} or null.
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
      canDownload: canDownload, ago: ago, getLyrics: getLyrics, stripTimes: stripTimes
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

  var _favSync = window.favSync;
  window.favSync = function () {
    if (now && now.local) {
      $("favBtn").innerHTML = '<span class="control-icon">♡</span>';
      $("favBtn").classList.remove("active");
      return;
    }
    return _favSync.apply(this, arguments);
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

  /* ---------------- theme ---------------- */
  function applyYellow(on) {
    document.body.classList.toggle("yellow", !!on);
    try { localStorage.setItem("jmYellow", on ? "1" : "0"); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", on ? "#000000" : "#0b0b0d");
    var b = $("mYellow"); if (b) b.innerHTML = "🎨 &nbsp; Black &amp; yellow: " + (on ? "ON" : "OFF");
    var d = $("yellowBtn"); if (d) d.classList.toggle("active", !!on);
  }

  /* ---------------- sorting (works by ranking, then the normal refresh runs) ---------------- */
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

  /* ---------------- extra buttons inside each song's ⋮ menu ---------------- */
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
   * WINDOWS (info, lyrics, history, my device)
   * ============================================================ */

  var CSS = [
    "body.yellow{--bg:#000;--surface:#0b0b0b;--surface-2:#141414;--surface-3:#1e1e1e;--text:#f7f3e3;--text-soft:#a8a18a;--border:rgba(255,196,0,.17);--accent:#ffc400;--accent-2:#e0a800}",
    "body.yellow header{background:rgba(0,0,0,.93)}",
    "body.yellow #player{background:linear-gradient(180deg,rgba(10,10,10,.97),#000)}",
    "body.yellow .brand-title{background:linear-gradient(90deg,#fff,#ffc400);-webkit-background-clip:text;background-clip:text;color:transparent}",
    "body.yellow .folder-btn.active,body.yellow .library-menu .folder-btn.active,body.yellow .pbtn:not(.alt){color:#000}",
    "body.yellow .header-btn:hover,body.yellow .header-btn.active{border-color:rgba(255,196,0,.55)}",
    "body.yellow #search:focus,body.yellow .in:focus{border-color:rgba(255,196,0,.6);box-shadow:0 0 0 3px rgba(255,196,0,.12)}",
    "body.yellow .song-row.active{border-color:rgba(255,196,0,.5);background:linear-gradient(145deg,rgba(255,196,0,.14),var(--surface-2));box-shadow:inset 3px 0 0 var(--accent),0 7px 22px rgba(0,0,0,.2)}",
    "body.yellow .controls .control-btn.mode.active,body.yellow .controls2 .control-btn.mode.active,body.yellow .controls2 .control-btn.on{color:#ffc400;border-color:rgba(255,196,0,.7);background:linear-gradient(160deg,#241c00,#050506)}",
    "body.yellow .controls .control-btn.main{border-color:rgba(255,196,0,.75)}",
    "body.yellow #progress::-webkit-slider-thumb,body.yellow #volume::-webkit-slider-thumb{background:#ffc400;box-shadow:0 0 0 4px rgba(255,196,0,.16)}",
    "body.yellow #progress::-moz-range-thumb,body.yellow #volume::-moz-range-thumb{background:#ffc400}",
    "body.yellow .web-item.on{border-color:rgba(255,196,0,.55);background:rgba(255,196,0,.10)}",
    "body.yellow .playlist-card:hover{border-color:rgba(255,196,0,.5)}",
    ".mobile-menu{max-height:calc(100vh - 90px);overflow:auto}",
    ".sort-sel{border:1px solid var(--border);background:linear-gradient(145deg,var(--surface-3),var(--surface-2));color:var(--text);border-radius:14px;padding:11px 10px;cursor:pointer;max-width:150px;font-size:14px}",
    ".info-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px}",
    ".info-row span{color:var(--text-soft);flex-shrink:0}",
    ".info-row b{font-weight:600;text-align:right;word-break:break-word}",
    ".x-actions{display:flex;flex-wrap:wrap;gap:8px}",
    ".x-actions .pbtn{flex:1;min-width:90px;padding:11px 8px}",
    ".lyr-text{white-space:pre-wrap;max-height:42vh;overflow:auto;margin:0;font-family:inherit;font-size:15px;line-height:1.6;color:var(--text)}",
    ".hist-list,.dev-list{display:grid;gap:8px;max-height:48vh;overflow:auto}",
    ".x-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(145deg,var(--surface-2),var(--surface));cursor:pointer}",
    ".x-item.on{border-color:rgba(155,92,255,.55)}",
    "body.yellow .x-item.on{border-color:rgba(255,196,0,.55)}",
    ".x-item .t{flex:1;min-width:0}",
    ".x-item b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".x-item span{display:block;font-size:12px;color:var(--text-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}"
  ].join("\n");

  function dlg(id, html) {
    var d = document.createElement("dialog");
    d.id = id;
    d.innerHTML = '<div class="card">' + html + "</div>";
    document.body.appendChild(d);
    return d;
  }

  function mount() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    dlg("infoDlg", "<h2>Song info</h2><div id=\"infoBody\"></div><div id=\"infoActions\" class=\"x-actions\"></div>" +
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

    // header + menu buttons
    var da = document.querySelector(".desktop-action");
    function hbtn(id, icon, title, fn) {
      if (!da) return;
      var b = document.createElement("button");
      b.id = id; b.type = "button"; b.className = "header-btn"; b.title = title;
      b.innerHTML = '<span class="header-icon">' + icon + "</span>";
      b.onclick = fn;
      da.insertBefore(b, da.firstChild);
    }
    var mm = document.getElementById("mobileMenu");
    function mbtn(id, html, fn) {
      if (!mm) return;
      var b = document.createElement("button");
      b.id = id; b.type = "button"; b.innerHTML = html;
      b.onclick = function () { mm.classList.remove("open"); fn(); };
      mm.insertBefore(b, mm.firstChild);
    }
    function toggleYellow() { applyYellow(!document.body.classList.contains("yellow")); }
    hbtn("devBtn", "💾", "Songs on this device", openDev);
    hbtn("histBtn", "🕘", "History", openHist);
    hbtn("yellowBtn", "🎨", "Black & yellow theme", toggleYellow);
    mbtn("mDev", "💾 &nbsp; Songs on this device", openDev);
    mbtn("mHist", "🕘 &nbsp; History", openHist);
    mbtn("mYellow", "🎨 &nbsp; Black &amp; yellow: OFF", toggleYellow);

    // sort menu in the library bar
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

    // player buttons: lyrics + info
    var c2 = document.querySelector(".controls2");
    if (c2) {
      var l = document.createElement("button");
      l.id = "lyrBtn"; l.type = "button"; l.className = "control-btn mode"; l.title = "Lyrics";
      l.innerHTML = '<span class="control-icon">♪</span>';
      l.onclick = function () { if (now) openLyrics(now); else toast("Play a song first"); };
      var i = document.createElement("button");
      i.id = "infoBtn"; i.type = "button"; i.className = "control-btn mode"; i.title = "Song info";
      i.innerHTML = '<span class="control-icon">ⓘ</span>';
      i.onclick = function () { if (now) openInfo(now); else toast("Play a song first"); };
      c2.appendChild(l); c2.appendChild(i);
    }

    // wiring
    $("infoClose").onclick = function () { $("infoDlg").close(); };
    $("lyrClose").onclick = function () { $("lyrDlg").close(); };
    $("histClose").onclick = function () { $("histDlg").close(); };
    $("devClose").onclick = function () { $("devDlg").close(); };
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

    // clicks on the extra items in each song's ⋮ menu
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
  }

  /* ---- song info ---- */
  var VLAB = { shared: "Everyone", private: "Only the uploader", admin: "Uploader + admins" };

  async function openInfo(s) {
    var rows = [["Title", s.title], ["Artist", s.artist]];
    if (s.local) rows.push(["Source", "This device"]);
    else if (s.online) rows.push(["Source", "Online (" + (s.src === "ia" ? "Internet Archive" : s.src === "jam" ? "Jamendo" : s.src === "radio" ? "live radio" : "link") + ")"]);
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

  mount();
  applyYellow(localStorage.getItem("jmYellow") === "1");
  try { refresh(); } catch (e) {}
  console.log("Jus Music features add-on ready");
})();
