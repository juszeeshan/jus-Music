/*
 * JUS MUSIC - ONLINE MUSIC ADD-ON (jus-online.js, v1)
 *
 * Plays free / legal music by LINK from:
 *   - Internet Archive  (no key needed)
 *   - Jamendo           (free client ID needed, see JAMENDO_ID below)
 *   - Live radio        (radio-browser.info directory, https stations only)
 *
 * NOTHING is uploaded or stored in your Drive, so it uses no storage.
 * This file does not change your player's code. It plugs into it.
 * If it fails to load, the normal player keeps working.
 *
 * To remove it: delete the <script src="jus-online.js"> line.
 */
(function () {

  /* ------------------------------------------------------------
   * OPTIONAL: paste your free Jamendo client ID between the quotes
   * so every user can search Jamendo. If left empty, each person
   * can paste their own key inside the Online music window.
   * Get one free at https://devportal.jamendo.com
   * ------------------------------------------------------------ */
  var JAMENDO_ID = "";

  var RADIO_HOSTS = [
    "https://de1.api.radio-browser.info",
    "https://fi1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://de2.api.radio-browser.info"
  ];

  var TEST = typeof __JM_TEST__ !== "undefined";

  /* ============================================================
   * SEARCH FUNCTIONS (no page access, easy to test)
   * ============================================================ */

  function esc2(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  async function wj(url, ms) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, ms || 12000);
    try {
      var r = await fetch(url, { signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function first(v) { return Array.isArray(v) ? v[0] : v; }

  // ---------- Internet Archive ----------
  async function searchIA(q) {
    q = String(q || "").replace(/["():\[\]{}^~*?\\\/]/g, " ").replace(/\s+/g, " ").trim();
    var query = q
      ? "(" + q + ") AND mediatype:audio"
      : "mediatype:audio AND collection:opensource_audio";
    var u = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator" +
      "&sort%5B%5D=" + encodeURIComponent("downloads desc") +
      "&rows=30&page=1&output=json";
    var j = await wj(u);
    var docs = (j.response && j.response.docs) || [];
    return docs.map(function (d) {
      return {
        kind: "album", src: "ia", key: d.identifier,
        title: first(d.title) || d.identifier,
        artist: first(d.creator) || "Internet Archive"
      };
    });
  }

  async function openIA(album) {
    var id = album.key;
    var j = await wj("https://archive.org/metadata/" + encodeURIComponent(id), 15000);
    var files = (j.files || []).filter(function (f) { return /\.mp3$/i.test(f.name || ""); });
    var vbr = files.filter(function (f) { return /VBR/i.test(f.format || ""); });
    if (vbr.length) files = vbr;
    if (!files.length) {
      files = (j.files || []).filter(function (f) { return /\.(ogg|m4a)$/i.test(f.name || ""); });
    }
    files.sort(function (a, b) {
      var ta = parseInt(a.track, 10), tb = parseInt(b.track, 10);
      if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta - tb;
      return String(a.name).localeCompare(String(b.name));
    });
    return files.map(function (f) {
      var nm = String(f.name);
      var title = f.title || nm.replace(/^.*\//, "").replace(/\.[^.]+$/, "").replace(/_+/g, " ");
      return {
        kind: "track", online: true, src: "ia",
        id: "web:ia:" + id + "/" + nm,
        title: title,
        artist: album.title || "Internet Archive",
        url: "https://archive.org/download/" + encodeURIComponent(id) + "/" +
          nm.split("/").map(encodeURIComponent).join("/")
      };
    });
  }

  // ---------- Jamendo ----------
  function jamKey() {
    var k = JAMENDO_ID;
    if (!k) { try { k = localStorage.getItem("jmJamKey") || ""; } catch (e) { k = ""; } }
    return k;
  }

  async function searchJam(q) {
    var k = jamKey();
    if (!k) throw new Error("NOKEY");
    q = String(q || "").trim();
    var u = "https://api.jamendo.com/v3.0/tracks/?client_id=" + encodeURIComponent(k) +
      "&format=json&limit=40&audioformat=mp32";
    u += q ? "&search=" + encodeURIComponent(q) : "&order=popularity_week";
    var j = await wj(u);
    if (j.headers && j.headers.status === "failed") {
      throw new Error(j.headers.error_message || "Jamendo refused the request");
    }
    return (j.results || []).filter(function (r) { return r.audio; }).map(function (r) {
      return {
        kind: "track", online: true, src: "jam",
        id: "web:jam:" + r.id, title: r.name || "Untitled",
        artist: r.artist_name || "Jamendo", url: r.audio
      };
    });
  }

  // ---------- Live radio ----------
  async function rbGet(path) {
    var err = null;
    for (var i = 0; i < RADIO_HOSTS.length; i++) {
      try { return await wj(RADIO_HOSTS[i] + path, 8000); } catch (e) { err = e; }
    }
    throw err || new Error("Radio directory unreachable");
  }

  async function searchRadio(q) {
    q = String(q || "").trim();
    var base = "&hidebroken=true&order=clickcount&reverse=true&limit=40";
    var paths = q
      ? ["name", "tag", "language"].map(function (k) {
        return "/json/stations/search?" + k + "=" + encodeURIComponent(q) + base;
      })
      : ["/json/stations/search?countrycode=IN" + base];
    var res = await Promise.allSettled(paths.map(rbGet));
    var ok = res.filter(function (r) { return r.status === "fulfilled"; });
    if (!ok.length) throw res[0].reason || new Error("Radio directory unreachable");
    var seen = {}, out = [];
    ok.forEach(function (r) {
      (r.value || []).forEach(function (s) {
        var url = s.url_resolved || s.url || "";
        if (!/^https:/i.test(url) || seen[s.stationuuid]) return;
        seen[s.stationuuid] = 1;
        out.push({
          kind: "track", online: true, live: true, src: "radio",
          id: "web:radio:" + s.stationuuid,
          title: String(s.name || "Radio").trim(),
          artist: [s.language, s.country].filter(Boolean).join(" · ") || "Live radio",
          url: url
        });
      });
    });
    return out;
  }

  if (TEST) {
    globalThis.__jm = { searchIA: searchIA, openIA: openIA, searchJam: searchJam, searchRadio: searchRadio };
    return;
  }

  /* ============================================================
   * PLUG INTO THE PLAYER
   * ============================================================ */

  if (typeof play !== "function" || typeof step !== "function" ||
      typeof teardownStream !== "function" || typeof au === "undefined" ||
      typeof $ !== "function") {
    console.warn("jus-online.js: player not found, add-on not started");
    return;
  }

  var webSrc = "ia", webItems = [], webBack = null, webBackTitle = "",
      webQueue = [], webBusy = 0, webTitle = "";

  // ----- saved online songs (kept on this device, per account) -----
  function savedKey() { return "jmWebSaved_" + (me ? me.name : "guest"); }
  function getSaved() {
    try { return JSON.parse(localStorage.getItem(savedKey()) || "[]") || []; } catch (e) { return []; }
  }
  function isSaved(id) { return getSaved().some(function (x) { return x.id === id; }); }
  function toggleSave(t) {
    var a = getSaved();
    if (a.some(function (x) { return x.id === t.id; })) {
      a = a.filter(function (x) { return x.id !== t.id; });
    } else {
      a.unshift({ id: t.id, title: t.title, artist: t.artist, url: t.url, src: t.src, live: !!t.live });
    }
    try { localStorage.setItem(savedKey(), JSON.stringify(a.slice(0, 500))); } catch (e) {}
    favSync();
    if (document.getElementById("webDlg").open) {
      if (webSrc === "saved") loadSaved(); else renderWeb();
    }
  }

  // ----- playing an online track through the existing <audio> -----
  function setSession(s) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: "Jus Music · Online" });
      navigator.mediaSession.setActionHandler("nexttrack", function () { step(1); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { step(-1); });
      navigator.mediaSession.setActionHandler("play", function () { want = true; au.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler("pause", function () { au.pause(); });
      navigator.mediaSession.playbackState = "playing";
    } catch (e) {}
  }

  async function playOnline(s) {
    var my = ++loadId;
    loadedId = null;
    try { teardownStream(); } catch (e) {}
    if (ctl) { try { ctl.abort(); } catch (e) {} }
    pfc.forEach(function (c) { try { c.abort(); } catch (e) {} });
    pfc.clear(); pend.clear();
    want = true;
    now = s;
    $("nowPlaying").textContent = s.title + " — " + s.artist;
    $("status").textContent = "Loading online...";
    $("progress").disabled = !!s.live;
    setSession(s);
    markActive();
    au.src = s.url;
    loadedId = s.id;
    try {
      await au.play();
      if (my !== loadId || !want) return;
      $("status").textContent = s.live ? "Playing · live radio" : "Playing · online";
    } catch (e) {
      if (my !== loadId) return;
      if (e && e.name === "AbortError") return;
      $("status").textContent = (e && e.name === "NotAllowedError")
        ? "Tap ▶ to continue" : "Can't play this online track";
    }
    if (document.getElementById("webDlg").open) renderWeb();
  }

  function webStep(dir) {
    var q = webQueue.length ? webQueue : [now];
    var i = q.findIndex(function (x) { return x.id === now.id; });
    if (q.length < 2) {
      if (!now.live) { au.currentTime = 0; au.play().catch(function () {}); }
      return;
    }
    if (i < 0) i = dir > 0 ? -1 : 0;
    var n;
    if (shuffle && dir > 0) {
      do { n = Math.floor(Math.random() * q.length); } while (q[n].id === now.id);
    } else {
      n = (i + dir + q.length) % q.length;
    }
    playOnline(q[n]);
  }

  var _play = window.play;
  window.play = function (s) {
    if (s && s.online) return playOnline(s);
    try { $("progress").disabled = false; } catch (e) {}
    return _play.apply(this, arguments);
  };

  var _step = window.step;
  window.step = function (dir) {
    if (now && now.online) return webStep(dir);
    return _step.apply(this, arguments);
  };

  var _favSync = window.favSync;
  window.favSync = function () {
    if (now && now.online) {
      var f = isSaved(now.id);
      $("favBtn").innerHTML = '<span class="control-icon">' + (f ? "♥" : "♡") + "</span>";
      $("favBtn").classList.toggle("active", f);
      return;
    }
    return _favSync.apply(this, arguments);
  };

  var _favClick = $("favBtn").onclick;
  $("favBtn").onclick = function (e) {
    if (now && now.online) { toggleSave(now); return; }
    return _favClick && _favClick.call(this, e);
  };

  var _onerror = au.onerror;
  au.onerror = function (ev) {
    if (now && now.online) {
      $("status").textContent = "Can't play this online track (link blocked or removed)";
      return;
    }
    return _onerror && _onerror.call(this, ev);
  };

  /* ============================================================
   * THE "ONLINE MUSIC" WINDOW
   * ============================================================ */

  var CSS = [
    "#webDlg .card{max-height:90vh;overflow:auto}",
    ".web-tabs{display:flex;flex-wrap:wrap;gap:6px}",
    ".web-tabs .chip{padding:8px 12px;font-size:13px}",
    ".web-search{display:flex;gap:8px}",
    ".web-search .in{flex:1;min-width:0}",
    ".web-search .pbtn{padding:0 16px}",
    ".web-list{display:grid;gap:8px;max-height:44vh;overflow:auto}",
    ".web-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(145deg,var(--surface-2),var(--surface));cursor:pointer}",
    ".web-item.on{border-color:rgba(155,92,255,.55);background:rgba(155,92,255,.12)}",
    ".web-info{flex:1;min-width:0}",
    ".web-info b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".web-info span{display:block;font-size:12px;color:var(--text-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}",
    ".web-btn{border:0;background:none;color:var(--text-soft);font-size:22px;cursor:pointer;padding:4px 8px}",
    ".web-go{color:var(--text-soft);font-size:22px}",
    ".web-foot{font-size:11px;color:var(--text-soft);text-align:center;line-height:1.4}"
  ].join("\n");

  function mount() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    var d = document.createElement("dialog");
    d.id = "webDlg";
    d.innerHTML =
      '<div class="card">' +
      "<h2>🌐 Online music</h2>" +
      '<div class="web-tabs" id="webTabs">' +
      '<button class="chip on" type="button" data-wsrc="ia">Internet Archive</button>' +
      '<button class="chip" type="button" data-wsrc="jam">Jamendo</button>' +
      '<button class="chip" type="button" data-wsrc="radio">Live radio</button>' +
      '<button class="chip" type="button" data-wsrc="saved">♥ Saved</button>' +
      "</div>" +
      '<div class="web-search"><input id="webQ" class="in" type="search" placeholder="Search..." autocomplete="off">' +
      '<button id="webGo" class="pbtn" type="button">Go</button></div>' +
      '<div id="webKeyBox" class="hide">' +
      '<div class="small-note">Jamendo needs a free key. Get a “client ID” at devportal.jamendo.com and paste it here once.</div>' +
      '<input id="webKey" class="in" placeholder="Jamendo client ID" autocapitalize="none">' +
      '<button id="webKeySave" class="pbtn alt" type="button" style="margin-top:8px">Save key</button></div>' +
      '<div id="webMsg" class="small-note"></div>' +
      '<div id="webList" class="web-list"></div>' +
      '<div class="web-foot">Free and open music, played by link. Nothing is saved to your Drive. ' +
      "Saved songs stay on this device.</div>" +
      '<button id="webClose" class="pbtn alt" type="button">Close</button>' +
      "</div>";
    document.body.appendChild(d);

    var da = document.querySelector(".desktop-action");
    if (da) {
      var b = document.createElement("button");
      b.id = "webBtn"; b.type = "button"; b.className = "header-btn"; b.title = "Online music";
      b.innerHTML = '<span class="header-icon">🌐</span>';
      da.insertBefore(b, da.firstChild);
      b.onclick = openWeb;
    }
    var mm = document.getElementById("mobileMenu");
    if (mm) {
      var m = document.createElement("button");
      m.id = "mWeb"; m.type = "button"; m.innerHTML = "🌐 &nbsp; Online music";
      mm.insertBefore(m, mm.firstChild);
      m.onclick = function () { mm.classList.remove("open"); openWeb(); };
    }

    document.getElementById("webClose").onclick = function () { d.close(); };
    document.getElementById("webGo").onclick = webSearch;
    document.getElementById("webQ").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); webSearch(); }
    });
    document.getElementById("webTabs").onclick = function (e) {
      var s = e.target.dataset && e.target.dataset.wsrc;
      if (s) setSrc(s);
    };
    document.getElementById("webKeySave").onclick = function () {
      var v = document.getElementById("webKey").value.trim();
      if (!v) return;
      try { localStorage.setItem("jmJamKey", v); } catch (e) {}
      document.getElementById("webKeyBox").classList.add("hide");
      webSearch();
    };
    document.getElementById("webList").onclick = onListClick;
  }

  function openWeb() {
    var d = document.getElementById("webDlg");
    d.showModal();
    if (!webItems.length) setSrc(webSrc);
  }

  function setSrc(s) {
    webSrc = s; webBack = null; webItems = [];
    var chips = document.querySelectorAll("#webTabs .chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("on", chips[i].dataset.wsrc === s);
    }
    var q = document.getElementById("webQ");
    q.placeholder = s === "radio" ? "Search station, language or genre..."
      : s === "saved" ? "Saved songs" : "Search songs or artists...";
    q.disabled = s === "saved";
    document.getElementById("webGo").disabled = s === "saved";
    document.getElementById("webKeyBox").classList.toggle("hide", !(s === "jam" && !jamKey()));
    if (s === "saved") loadSaved(); else webSearch();
  }

  function loadSaved() {
    webBack = null;
    webItems = getSaved().map(function (x) {
      return { kind: "track", online: true, src: x.src, live: !!x.live, id: x.id, title: x.title, artist: x.artist, url: x.url };
    });
    document.getElementById("webMsg").textContent =
      webItems.length ? "" : "Nothing saved yet. Tap ♡ on any online song.";
    renderWeb();
  }

  async function webSearch() {
    if (webSrc === "saved") { loadSaved(); return; }
    var msg = document.getElementById("webMsg");
    var q = document.getElementById("webQ").value.trim();
    var my = ++webBusy;
    webBack = null; webItems = [];
    if (webSrc === "jam" && !jamKey()) {
      document.getElementById("webKeyBox").classList.remove("hide");
      msg.textContent = "Add your free Jamendo key to search it.";
      renderWeb(); return;
    }
    msg.textContent = "Searching...";
    renderWeb();
    try {
      var r = webSrc === "ia" ? await searchIA(q)
        : webSrc === "jam" ? await searchJam(q) : await searchRadio(q);
      if (my !== webBusy) return;
      webItems = r;
      msg.textContent = r.length ? "" : "No results. Try another word.";
    } catch (err) {
      if (my !== webBusy) return;
      msg.textContent = "Could not load: " + (err && err.name === "AbortError" ? "timed out" : (err && err.message || err));
    }
    renderWeb();
  }

  async function openAlbum(a) {
    var msg = document.getElementById("webMsg");
    msg.textContent = "Opening...";
    try {
      var tracks = await openIA(a);
      if (!tracks.length) { msg.textContent = "No playable audio files in this item."; return; }
      webBack = webItems; webBackTitle = webTitle;
      webItems = tracks; webTitle = a.title;
      msg.textContent = "";
      renderWeb();
    } catch (err) {
      msg.textContent = "Could not open: " + (err && err.message || err);
    }
  }

  function renderWeb() {
    var L = document.getElementById("webList");
    if (!webItems.length) { L.innerHTML = ""; return; }
    var html = "";
    if (webBack) {
      html += '<button class="pbtn alt" id="webBackBtn" type="button">← Back to results</button>';
    }
    html += webItems.map(function (t, i) {
      if (t.kind === "album") {
        return '<div class="web-item" data-open="' + i + '"><div class="web-info"><b>' + esc2(t.title) +
          "</b><span>" + esc2(t.artist) + ' · tap to open</span></div><span class="web-go">›</span></div>';
      }
      var on = now && now.id === t.id;
      return '<div class="web-item' + (on ? " on" : "") + '"><div class="web-info" data-play="' + i + '"><b>' +
        esc2(t.title) + "</b><span>" + esc2(t.artist) + (t.live ? " · LIVE" : "") +
        '</span></div><button class="web-btn" type="button" data-save="' + i + '">' +
        (isSaved(t.id) ? "♥" : "♡") + "</button></div>";
    }).join("");
    L.innerHTML = html;
  }

  function onListClick(e) {
    var b = e.target.closest("[data-open],[data-play],[data-save],#webBackBtn");
    if (!b) return;
    if (b.id === "webBackBtn") {
      webItems = webBack; webBack = null; webTitle = webBackTitle; renderWeb(); return;
    }
    if (b.dataset.open !== undefined) { openAlbum(webItems[+b.dataset.open]); return; }
    if (b.dataset.save !== undefined) { toggleSave(webItems[+b.dataset.save]); return; }
    var t = webItems[+b.dataset.play];
    if (!t) return;
    webQueue = webItems.filter(function (x) { return x.kind === "track"; });
    play(t);
    renderWeb();
  }

  mount();
  console.log("Jus Music online add-on ready");
})();
