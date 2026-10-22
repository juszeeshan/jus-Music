/*
 * JUS MUSIC - ONLINE MUSIC ADD-ON (v2)   file: jus-online.js
 *
 * REPLACES the earlier jus-online.js (same file name, new content).
 *
 * The normal 🔍 search now has two modes:  [My library]  [Online]
 * In Online mode one search looks in several free / legal places at once:
 *   - Internet Archive   (no key)
 *   - Openverse          (no key; many open-licence music libraries)
 *   - Jamendo            (free client ID, see JAMENDO_ID below)
 *   - Live radio         (radio-browser.info, https stations)
 * Extra tabs: ♥ Saved, 🔗 Link (paste a direct audio link), 🌍 Sites (more places to find music).
 *
 * NOTHING is uploaded or stored in your Drive. If this file fails to load,
 * the normal player keeps working.
 */
(function () {

  /* Optional: paste your free Jamendo client ID (devportal.jamendo.com) so every
     user can search Jamendo. Otherwise each person can paste their own key. */
  var JAMENDO_ID = "";

  var RADIO_HOSTS = [
    "https://de1.api.radio-browser.info",
    "https://fi1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://de2.api.radio-browser.info"
  ];

  var SRC_NAME = { ia: "Internet Archive", ov: "Openverse", jam: "Jamendo", radio: "Live radio", link: "Link" };

  var SITES = [
    { n: "Internet Archive · Audio", d: "Huge free library: music, old records, live recordings.", u: "https://archive.org/details/audio" },
    { n: "Openverse · Audio", d: "Search engine for openly licensed audio from many sites.", u: "https://openverse.org/search/audio" },
    { n: "Jamendo", d: "Independent artists, free to listen.", u: "https://www.jamendo.com" },
    { n: "Free Music Archive", d: "Free and open-licensed music.", u: "https://freemusicarchive.org" },
    { n: "ccMixter", d: "Tracks and remixes under Creative Commons.", u: "https://ccmixter.org" },
    { n: "Musopen", d: "Public-domain classical music.", u: "https://musopen.org" }
  ];

  var TEST = typeof __JM_TEST__ !== "undefined";

  /* ============================================================
   * SEARCH + LINK FUNCTIONS (no page access, easy to test)
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
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
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

  // ---------- Openverse (searches several open-licence audio libraries) ----------
  async function searchOV(q) {
    q = String(q || "").trim();
    if (!q) return [];
    var base = "https://api.openverse.org/v1/audio/?page_size=20&q=" + encodeURIComponent(q);
    var j;
    try { j = await wj(base + "&category=music"); }
    catch (e) {
      if (e && e.status === 400) j = await wj(base);   // filter not accepted: search without it
      else throw e;
    }
    return (j.results || []).filter(function (r) { return r.url; }).map(function (r) {
      return {
        kind: "track", online: true, src: "ov",
        id: "web:ov:" + r.id, title: r.title || "Untitled",
        artist: r.creator || r.provider || "Openverse", url: r.url
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

  // ---------- one search for everything ----------
  async function searchAll(q) {
    var jobs = [
      ["Internet Archive", searchIA(q)],
      ["Openverse", searchOV(q)],
      ["Jamendo", jamKey() ? searchJam(q) : Promise.resolve([])],
      ["Live radio", searchRadio(q).then(function (r) { return r.slice(0, 6); })]
    ];
    var res = await Promise.allSettled(jobs.map(function (j) { return j[1]; }));
    var lists = [], failed = [];
    res.forEach(function (r, i) {
      if (r.status === "fulfilled") lists.push(r.value || []);
      else { failed.push(jobs[i][0]); lists.push([]); }
    });
    // take one from each source in turn, so every source shows up near the top
    var out = [], idx = 0, more = true;
    while (more && out.length < 70) {
      more = false;
      for (var k = 0; k < lists.length; k++) {
        if (idx < lists[k].length) { out.push(lists[k][idx]); more = true; }
      }
      idx++;
    }
    return { items: out, failed: failed, allFailed: failed.length === jobs.length };
  }

  // ---------- a pasted link ----------
  var BLOCKED_HOSTS = /(^|\.)(youtube\.com|youtu\.be|soundcloud\.com|spotify\.com|jiosaavn\.com|saavn\.com|gaana\.com|wynk\.in|apple\.com|hungama\.com|amazon\.com|deezer\.com|tidal\.com)$/;

  function resolveLink(raw) {
    var s = String(raw || "").trim();
    if (!s) return { err: "Paste a link first." };
    if (!/^https?:\/\//i.test(s)) {
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = "https://" + s;
      else return { err: "That doesn't look like a link." };
    }
    var u;
    try { u = new URL(s); } catch (e) { return { err: "That doesn't look like a link." }; }
    var host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (BLOCKED_HOSTS.test(host)) {
      return { err: "This site doesn't allow its songs to play inside other players. Open it in its own app or website." };
    }
    if (host === "archive.org") {
      var m = u.pathname.match(/^\/(?:details|download)\/([^\/?#]+)/);
      if (m) {
        var id = decodeURIComponent(m[1]);
        return { album: { kind: "album", src: "ia", key: id, title: id, artist: "Internet Archive" } };
      }
    }
    var upgraded = false;
    if (u.protocol === "http:") { u.protocol = "https:"; upgraded = true; }
    var last = u.pathname.split("/").pop() || "";
    var name = last;
    try { name = decodeURIComponent(last.replace(/\+/g, " ")); } catch (e) {}
    var title = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_+/g, " ").trim() || host;
    var isFile = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i.test(u.pathname);
    return {
      track: {
        kind: "track", online: true, src: "link", live: !isFile,
        id: "web:link:" + u.href, title: title, artist: host, url: u.href
      },
      upgraded: upgraded
    };
  }

  if (TEST) {
    globalThis.__jm = {
      searchIA: searchIA, openIA: openIA, searchJam: searchJam, searchRadio: searchRadio,
      searchOV: searchOV, searchAll: searchAll, resolveLink: resolveLink
    };
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

  function dlog(m) { try { if (typeof dbg === "function") dbg("online: " + m); } catch (e) {} }
  function fail(part, e) { dlog(part + " FAILED: " + (e && e.message || e)); try { console.error("jus-online: " + part, e); } catch (x) {} }

  var scope = "lib";          // "lib" = My library, "net" = Online
  var netSrc = "all";         // all | ia | ov | jam | radio | saved | link | sites
  var netItems = [], netBack = null, netQueue = [], netBusy = 0, netT = null;

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
    if (scope === "net") { if (netSrc === "saved") loadSaved(); else renderNet(); }
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
      $("status").textContent = s.live ? "Playing · live" : "Playing · online";
    } catch (e) {
      if (my !== loadId) return;
      if (e && e.name === "AbortError") return;
      $("status").textContent = (e && e.name === "NotAllowedError")
        ? "Tap ▶ to continue" : "Can't play this online track";
    }
    if (scope === "net") renderNet();
  }

  function webStep(dir) {
    var q = netQueue.length ? netQueue : [now];
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
   * ONLINE VIEW (inside the normal page, driven by the normal search)
   * ============================================================ */

  var CSS = [
    "body.net-mode #songs,body.net-mode #songsTitle,body.net-mode .library-bar,body.net-mode #playlistPanel{display:none!important}",
    "#netView{display:none}",
    "body.net-mode #netView{display:block}",
    ".scope-row{display:flex;gap:8px;margin-top:10px}",
    ".scope-row .chip{flex:1;padding:9px 12px;font-size:14px;text-align:center}",
    ".net-sources{display:flex;gap:6px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}",
    ".net-sources::-webkit-scrollbar{display:none}",
    ".net-sources .chip{flex:0 0 auto;padding:8px 13px;font-size:13px}",
    "#netList{display:grid;gap:9px}",
    ".web-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(145deg,var(--surface-2),var(--surface));cursor:pointer;min-height:62px}",
    ".web-item.on{border-color:rgba(155,92,255,.55);background:rgba(155,92,255,.12)}",
    "body.themed .web-item.on{border-color:rgba(var(--acc),.55);background:rgba(var(--acc),.10)}",
    ".web-info{flex:1;min-width:0}",
    ".web-info b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".web-info span{display:block;font-size:12px;color:var(--text-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}",
    ".web-btn{border:0;background:none;color:var(--text-soft);font-size:22px;cursor:pointer;padding:4px 8px}",
    ".web-go{color:var(--text-soft);font-size:22px}",
    ".net-box{display:grid;gap:8px;margin-bottom:12px}",
    ".site-card{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2)}",
    ".site-card .web-info{flex:1}",
    ".site-card a{flex-shrink:0;text-decoration:none;padding:9px 14px;font-size:13px;color:#fff}",
    ".net-foot{font-size:11px;color:var(--text-soft);text-align:center;line-height:1.5;margin-top:14px}"
  ].join("\n");

  var CHIPS = [
    ["all", "All"], ["ia", "Archive"], ["ov", "Openverse"], ["jam", "Jamendo"],
    ["radio", "Radio"], ["saved", "♥ Saved"], ["link", "🔗 Link"], ["sites", "🌍 Sites"]
  ];

  function mount() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    /* online results view, placed where the song list is */
    try {
      var main = document.querySelector("main");
      var title = document.getElementById("songsTitle");
      var nv = document.createElement("div");
      nv.id = "netView";
      nv.innerHTML =
        '<div class="net-sources" id="netSources">' +
        CHIPS.map(function (c, i) {
          return '<button class="chip' + (i === 0 ? " on" : "") + '" type="button" data-ns="' + c[0] + '">' + c[1] + "</button>";
        }).join("") + "</div>" +
        '<div id="netKeyBox" class="net-box hide">' +
        '<div class="small-note">Jamendo needs a free key. Get a “client ID” at devportal.jamendo.com and paste it here once.</div>' +
        '<input id="netKey" class="in" placeholder="Jamendo client ID" autocapitalize="none">' +
        '<button id="netKeySave" class="pbtn alt" type="button">Save key</button></div>' +
        '<div id="netLinkBox" class="net-box hide">' +
        '<input id="netLinkIn" class="in" type="url" placeholder="Paste a direct audio link (.mp3, .m4a ...) or an archive.org page" autocapitalize="none">' +
        '<button id="netLinkGo" class="pbtn" type="button">Play link</button>' +
        '<div class="small-note">Works with direct links to audio files and archive.org pages. Only play files you have the right to use.</div></div>' +
        '<div id="netMsg" class="small-note"></div>' +
        '<div id="netList"></div>' +
        '<div class="net-foot">Free and open music, played by link. Nothing is saved to your Drive. Saved songs stay on this device.</div>';
      main.insertBefore(nv, title);
    } catch (e) { fail("online view", e); }

    /* My library | Online switch under the search box */
    try {
      var sw = document.getElementById("searchWrap");
      var row = document.createElement("div");
      row.className = "scope-row";
      row.id = "scopeRow";
      row.innerHTML =
        '<button class="chip on" type="button" data-scope="lib">My library</button>' +
        '<button class="chip" type="button" data-scope="net">Online</button>';
      sw.appendChild(row);
      row.onclick = function (e) {
        var s = e.target.dataset && e.target.dataset.scope;
        if (s) setScope(s);
      };

      var inp = $("search");
      var _so = inp.oninput;
      inp.oninput = function (e) {
        if (scope === "net") { clearTimeout(netT); netT = setTimeout(netRun, 500); return; }
        return _so && _so.call(this, e);
      };
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && scope === "net") { e.preventDefault(); clearTimeout(netT); netRun(); }
      });

      // closing the search box also leaves Online mode
      var sb = $("searchBtn");
      var _sbc = sb.onclick;
      sb.onclick = function (e) {
        var r = _sbc && _sbc.call(this, e);
        if (scope === "net" && !sw.classList.contains("open")) setScope("lib");
        return r;
      };
    } catch (e) { fail("search switch", e); }

    /* chips + boxes */
    try {
      $("netSources").onclick = function (e) {
        var s = e.target.dataset && e.target.dataset.ns;
        if (s) setNetSrc(s);
      };
      $("netKeySave").onclick = function () {
        var v = $("netKey").value.trim();
        if (!v) return;
        try { localStorage.setItem("jmJamKey", v); } catch (e) {}
        $("netKeyBox").classList.add("hide");
        netRun();
      };
      $("netLinkGo").onclick = playPastedLink;
      $("netLinkIn").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); playPastedLink(); }
      });
      $("netList").onclick = onListClick;
    } catch (e) { fail("online wiring", e); }

    /* menu + header entry points */
    try {
      var da = document.querySelector(".desktop-action");
      if (da) {
        var b = document.createElement("button");
        b.id = "webBtn"; b.type = "button"; b.className = "header-btn"; b.title = "Online music";
        b.innerHTML = '<span class="header-icon">🌐</span>';
        da.insertBefore(b, da.firstChild);
        b.onclick = openNet;
      }
      var mm = document.getElementById("mobileMenu");
      if (mm) {
        var m = document.createElement("button");
        m.id = "mWeb"; m.type = "button"; m.innerHTML = "🌐 &nbsp; Online music";
        mm.insertBefore(m, mm.firstChild);
        m.onclick = function () { mm.classList.remove("open"); openNet(); };
      }
    } catch (e) { fail("menu entry", e); }
  }

  function openNet() {
    $("searchWrap").classList.add("open");
    setScope("net");
    try { $("search").focus(); } catch (e) {}
  }

  function setScope(s) {
    scope = s;
    var chips = document.querySelectorAll("#scopeRow .chip");
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].dataset.scope === s);
    document.body.classList.toggle("net-mode", s === "net");
    $("search").placeholder = s === "net" ? "Search online (all free sources)..." : "Search songs...";
    if (s === "net") {
      q = "";                         // the library list is not filtered while searching online
      shown = PAGE;
      try { refresh(); } catch (e) {}
      if (!netItems.length && netSrc !== "sites" && netSrc !== "link") setNetSrc(netSrc); else renderNet();
    } else {
      q = $("search").value;          // back to the library, using what is typed
      shown = PAGE;
      try { refresh(); } catch (e) {}
    }
  }

  function setNetSrc(s) {
    netSrc = s; netBack = null; netItems = [];
    var chips = document.querySelectorAll("#netSources .chip");
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].dataset.ns === s);
    $("netKeyBox").classList.toggle("hide", !(s === "jam" && !jamKey()));
    $("netLinkBox").classList.toggle("hide", s !== "link");
    $("netMsg").textContent = "";
    if (s === "saved") loadSaved();
    else if (s === "sites") renderSites();
    else if (s === "link") renderNet();
    else netRun();
  }

  function loadSaved() {
    netBack = null;
    netItems = getSaved().map(function (x) {
      return { kind: "track", online: true, src: x.src, live: !!x.live, id: x.id, title: x.title, artist: x.artist, url: x.url };
    });
    $("netMsg").textContent = netItems.length ? "" : "Nothing saved yet. Tap ♡ on any online song.";
    renderNet();
  }

  function renderSites() {
    netItems = [];
    $("netMsg").textContent = "Open a site, find a song, copy its direct audio link, then paste it under 🔗 Link.";
    $("netList").innerHTML = SITES.map(function (s) {
      return '<div class="site-card"><div class="web-info"><b>' + esc2(s.n) + "</b><span>" + esc2(s.d) +
        '</span></div><a class="pbtn" href="' + esc2(s.u) + '" target="_blank" rel="noopener noreferrer">Open</a></div>';
    }).join("");
  }

  async function netRun() {
    if (netSrc === "saved") { loadSaved(); return; }
    if (netSrc === "sites") { renderSites(); return; }
    if (netSrc === "link") { renderNet(); return; }
    var msg = $("netMsg");
    var query = $("search").value.trim();
    var my = ++netBusy;
    netBack = null; netItems = [];
    if (netSrc === "jam" && !jamKey()) {
      $("netKeyBox").classList.remove("hide");
      msg.textContent = "Add your free Jamendo key to search it.";
      renderNet(); return;
    }
    msg.textContent = "Searching...";
    renderNet();
    try {
      var items;
      if (netSrc === "all") {
        var r = await searchAll(query);
        if (my !== netBusy) return;
        if (r.allFailed) throw new Error("no source answered. Check your internet and try again.");
        items = r.items;
        msg.textContent = items.length
          ? (r.failed.length ? "Some sources didn't answer: " + r.failed.join(", ") : "")
          : "No results. Try another word.";
      } else {
        items = netSrc === "ia" ? await searchIA(query)
          : netSrc === "ov" ? await searchOV(query)
          : netSrc === "jam" ? await searchJam(query) : await searchRadio(query);
        if (my !== netBusy) return;
        msg.textContent = items.length ? "" : (netSrc === "ov" && !query ? "Type a word to search Openverse." : "No results. Try another word.");
      }
      netItems = items;
    } catch (err) {
      if (my !== netBusy) return;
      msg.textContent = "Could not load: " + (err && err.name === "AbortError" ? "timed out" : (err && err.message || err));
    }
    renderNet();
  }

  async function openAlbum(a) {
    var msg = $("netMsg");
    msg.textContent = "Opening...";
    try {
      var tracks = await openIA(a);
      if (!tracks.length) { msg.textContent = "No playable audio files in this item."; return; }
      netBack = netItems;
      netItems = tracks;
      msg.textContent = "";
      renderNet();
    } catch (err) {
      msg.textContent = "Could not open: " + (err && err.message || err);
    }
  }

  function playPastedLink() {
    var r = resolveLink($("netLinkIn").value);
    var msg = $("netMsg");
    if (r.err) { msg.textContent = r.err; return; }
    if (r.album) { msg.textContent = ""; openAlbum(r.album); return; }
    msg.textContent = r.upgraded ? "Using a secure (https) version of the link." : "";
    netQueue = [r.track];
    play(r.track);
  }

  function renderNet() {
    var L = $("netList");
    if (!netItems.length) { if (netSrc !== "sites") L.innerHTML = ""; return; }
    var html = "";
    if (netBack) {
      html += '<button class="pbtn alt" id="netBackBtn" type="button">← Back to results</button>';
    }
    html += netItems.map(function (t, i) {
      var sn = SRC_NAME[t.src] || "";
      if (t.kind === "album") {
        return '<div class="web-item" data-open="' + i + '"><div class="web-info"><b>' + esc2(t.title) +
          "</b><span>" + esc2(t.artist) + " · " + esc2(sn) + ' · tap to open</span></div><span class="web-go">›</span></div>';
      }
      var on = now && now.id === t.id;
      return '<div class="web-item' + (on ? " on" : "") + '"><div class="web-info" data-play="' + i + '"><b>' +
        esc2(t.title) + "</b><span>" + esc2(t.artist) + " · " + esc2(sn) + (t.live ? " · LIVE" : "") +
        '</span></div><button class="web-btn" type="button" data-save="' + i + '">' +
        (isSaved(t.id) ? "♥" : "♡") + "</button></div>";
    }).join("");
    L.innerHTML = html;
  }

  function onListClick(e) {
    var b = e.target.closest("[data-open],[data-play],[data-save],#netBackBtn");
    if (!b) return;
    if (b.id === "netBackBtn") { netItems = netBack; netBack = null; renderNet(); return; }
    if (b.dataset.open !== undefined) { openAlbum(netItems[+b.dataset.open]); return; }
    if (b.dataset.save !== undefined) { toggleSave(netItems[+b.dataset.save]); return; }
    var t = netItems[+b.dataset.play];
    if (!t) return;
    netQueue = netItems.filter(function (x) { return x.kind === "track"; });
    play(t);
    renderNet();
  }

  mount();
  window.__jmOnline = "2";
  dlog("add-on v2 loaded");
  console.log("Jus Music online add-on v2 ready");
})();
