/*
 * JUS MUSIC - UPLOAD TO MY OWN GOOGLE DRIVE (jus-upload.js, v1)
 *
 * - The Upload window gets "Save to: My Google Drive". The song goes straight from the
 *   phone to the person's OWN Drive (a "Jus Music" folder), is shared by link, and only its
 *   name and details are saved in your Google Sheet. It uses none of YOUR storage.
 * - If the person later deletes the file, the song stays in the list, highlighted as
 *   "File removed", and the details stay in the sheet. The uploader (or an admin) can
 *   re-upload a file for it.
 *
 * SET UP (once):  paste your Google "OAuth client ID" below. Steps are in the guide.
 * Until it is set, nothing changes: uploads work exactly as before.
 *
 * Load it AFTER jus-online.js and jus-features.js in index.html.
 */
(function () {

  /* Paste your OAuth client ID here, between the quotes.
     It looks like 123456789-abcdefg.apps.googleusercontent.com */
  var GOOGLE_CLIENT_ID = "102701213826-89robf5p903q0774jt2ej4cjgog621p2.apps.googleusercontent.com";

  var FOLDER_NAME = "Jus Music";
  var MAX_MB = 200;
  var SCOPE = "https://www.googleapis.com/auth/drive.file";

  var TEST = typeof __JM_TEST__ !== "undefined";

  /* ============================================================
   * HELPERS (pure, easy to test)
   * ============================================================ */

  var MIME_BY_EXT = {
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg",
    opus: "audio/ogg", flac: "audio/flac", wma: "audio/x-ms-wma", webm: "audio/webm"
  };

  function extOf(name) {
    var m = String(name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : "";
  }

  function mimeFor(file) {
    if (file && file.type && /^audio\//.test(file.type)) return file.type;
    return MIME_BY_EXT[extOf(file && file.name)] || "audio/mpeg";
  }

  function driveName(title, artist, file) {
    var base = (artist && !/^unknown$/i.test(artist) ? artist + " - " : "") + (title || "song");
    base = base.replace(/[\\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "song";
    return base + "." + (extOf(file && file.name) || "mp3");
  }

  function multipartBody(meta, file, mime, boundary) {
    return new Blob([
      "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n" +
      "--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n",
      file,
      "\r\n--" + boundary + "--"
    ]);
  }

  if (TEST) {
    globalThis.__ju = { extOf: extOf, mimeFor: mimeFor, driveName: driveName };
    return;
  }

  if (!GOOGLE_CLIENT_ID) {
    console.log("jus-upload.js: no Google client ID yet, uploads stay as they were.");
    try { if (typeof dbg === "function") dbg("upload: add-on idle (no client ID)"); } catch (e) {}
    return;
  }

  if (typeof $ !== "function" || typeof call !== "function" || typeof play !== "function" ||
      typeof refresh !== "function" || typeof songs === "undefined") {
    console.warn("jus-upload.js: player not found, add-on not started");
    return;
  }

  function dlog(m) { try { if (typeof dbg === "function") dbg("upload: " + m); } catch (e) {} }
  function toast(m) { var s = $("status"); if (s) s.textContent = m; }
  function isAdmin() { return !!(me && me.role === "admin"); }

  /* ============================================================
   * GOOGLE SIGN-IN (only the permission to manage files this app creates)
   * ============================================================ */

  var tok = null, tokExp = 0, gisP = null;

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { gisP = null; rej(new Error("Could not load Google sign-in. Check your internet.")); };
      document.head.appendChild(s);
    });
    return gisP;
  }

  // call this straight from a tap, so the browser allows the Google pop-up
  function getToken() {
    if (tok && Date.now() < tokExp - 60000) return Promise.resolve(tok);
    return loadGis().then(function () {
      return new Promise(function (res, rej) {
        var client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPE,
          callback: function (r) {
            if (!r || r.error) { rej(new Error(r && r.error === "access_denied" ? "Sign-in cancelled" : "Google sign-in failed" + (r && r.error ? ": " + r.error : ""))); return; }
            tok = r.access_token;
            tokExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
            res(tok);
          },
          error_callback: function (e) {
            var t = e && e.type;
            rej(new Error(t === "popup_closed" ? "Sign-in cancelled"
              : t === "popup_failed_to_open" ? "The Google window was blocked. Allow pop-ups for this site and try again."
              : "Google sign-in failed"));
          }
        });
        client.requestAccessToken({ prompt: "" });
      });
    });
  }

  /* ============================================================
   * DRIVE: folder, upload, share
   * ============================================================ */

  function auth(t, extra) {
    var h = { Authorization: "Bearer " + t };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  async function ensureFolder(t) {
    var key = "jmDriveFolder_" + (me ? me.name : "x");
    var id = null;
    try { id = localStorage.getItem(key); } catch (e) {}
    if (id) {
      try {
        var r0 = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?fields=id,trashed", { headers: auth(t) });
        if (r0.ok) { var j0 = await r0.json(); if (!j0.trashed) return id; }
      } catch (e) {}
    }
    var q = encodeURIComponent("name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var r1 = await fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)&pageSize=1", { headers: auth(t) });
    if (r1.ok) {
      var j1 = await r1.json();
      if (j1.files && j1.files.length) { id = j1.files[0].id; }
    }
    if (!id) {
      var r2 = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST", headers: auth(t, { "Content-Type": "application/json" }),
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
      });
      if (!r2.ok) throw new Error("Could not create the folder in your Drive (" + r2.status + ")");
      id = (await r2.json()).id;
    }
    try { localStorage.setItem(key, id); } catch (e) {}
    return id;
  }

  function xhrSend(method, url, headers, body, onPct) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open(method, url);
      for (var k in headers) x.setRequestHeader(k, headers[k]);
      if (x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable && onPct) onPct(e.loaded / e.total); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try { res(JSON.parse(x.responseText)); } catch (e) { rej(new Error("Unexpected answer from Drive")); }
        } else rej(new Error(x.status === 401 ? "Google sign-in expired. Try again." : "Drive upload failed (" + x.status + ")"));
      };
      x.onerror = function () { rej(new Error("Network problem during the upload")); };
      x.send(body);
    });
  }

  var FIELDS = "id,name,mimeType,size,md5Checksum";

  async function driveUpload(t, file, name, mime, folderId, onPct) {
    var meta = { name: name, parents: [folderId], mimeType: mime };
    var init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=" + FIELDS, {
      method: "POST",
      headers: auth(t, { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(file.size) }),
      body: JSON.stringify(meta)
    });
    if (!init.ok) throw new Error(init.status === 401 ? "Google sign-in expired. Try again." : "Drive refused the upload (" + init.status + ")");
    var loc = init.headers && init.headers.get("Location");
    if (loc) return xhrSend("PUT", loc, { "Content-Type": mime }, file, onPct);
    dlog("no resumable address, using the simple upload");
    var boundary = "jm" + Date.now();
    return xhrSend("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=" + FIELDS,
      auth(t, { "Content-Type": "multipart/related; boundary=" + boundary }), multipartBody(meta, file, mime, boundary), onPct);
  }

  async function shareByLink(t, fileId) {
    var r = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "/permissions?fields=id", {
      method: "POST", headers: auth(t, { "Content-Type": "application/json" }),
      body: JSON.stringify({ role: "reader", type: "anyone" })
    });
    if (!r.ok) throw new Error("Uploaded, but could not share the file (" + r.status + ")");
  }

  /* ============================================================
   * THE UPLOAD WINDOW
   * ============================================================ */

  var relinkId = null;

  async function sha256(file) {
    var buf = await file.arrayBuffer();
    var h = await crypto.subtle.digest("SHA-256", buf);
    return Array.prototype.map.call(new Uint8Array(h), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function uploadMine() {
    var f = $("file").files[0], us = $("us");
    if (!f) { us.textContent = "Choose an audio file"; return; }
    if (f.size > MAX_MB * 1048576) { us.textContent = "Max " + MAX_MB + " MB"; return; }
    $("go").disabled = true;
    try {
      us.textContent = "Opening Google sign-in...";
      var tokP = getToken();                    // started right away, from the tap
      tokP.catch(function () {});
      us.textContent = "Checking the file...";
      var hash = await sha256(f);
      if (!relinkId && songs.some(function (s) { return s.hash && s.hash === hash; })) {
        us.textContent = "Duplicate: already in the library";
        return;
      }
      var t = await tokP;
      var mime = mimeFor(f);
      var title = $("ti").value.trim() || f.name.replace(/\.[^.]+$/, "");
      var artist = $("ar").value.trim();
      us.textContent = "Preparing your Drive...";
      var folderId = await ensureFolder(t);
      us.textContent = "Uploading to your Drive... 0%";
      var up = await driveUpload(t, f, driveName(title, artist, f), mime, folderId, function (p) {
        us.textContent = "Uploading to your Drive... " + Math.round(p * 100) + "%";
      });
      us.textContent = "Sharing the link...";
      await shareByLink(t, up.id);
      us.textContent = "Saving to the library...";
      var j = relinkId
        ? await call("relinkSong", { id: relinkId, fileId: up.id, mime: mime, hash: hash })
        : await call("addSong", { fileId: up.id, mime: mime, title: title, artist: artist, language: $("ul").value,
            genre: $("ug").value, visibility: $("uv").value, hash: hash });
      if (!j.ok) throw new Error(j.error || "Could not save the song");
      var i = songs.findIndex(function (s) { return s.id === j.song.id; });
      if (i >= 0) songs[i] = j.song; else songs.push(j.song);
      try { saveLib(); } catch (e) {}
      refresh();
      us.textContent = "";
      $("file").value = "";
      endRelink();
      $("dlg").close();
      toast(relinkId === null ? "Song added from your Drive" : "File replaced");
    } catch (e) {
      us.textContent = (e && e.message) || String(e);
      dlog("upload failed: " + us.textContent);
    } finally {
      $("go").disabled = false;
    }
  }

  function startRelink(s) {
    relinkId = s.id;
    var h = document.querySelector("#dlg h2");
    if (h) h.textContent = "Re-upload file";
    $("ti").value = s.title; $("ar").value = s.artist === "Unknown" ? "" : s.artist;
    try { $("ul").value = s.language; $("ug").value = s.genre; } catch (e) {}
    prepareDialog();
    var sel = $("ustore"); if (sel) sel.value = "user";
    $("dlg").showModal();
  }
  function endRelink() {
    relinkId = null;
    var h = document.querySelector("#dlg h2");
    if (h) h.textContent = "Upload song";
  }

  function prepareDialog() {
    var sel = $("ustore");
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '<option value="user">Save to: My Google Drive</option>' +
      (isAdmin() && !relinkId ? '<option value="owner">Save to: Jus Music storage (your Drive)</option>' : "");
    sel.value = keep === "owner" && isAdmin() ? "owner" : "user";
    var note = $("uNote");
    if (note) note.textContent = "Your song is saved in a “" + FOLDER_NAME + "” folder in YOUR Google Drive and shared by link. " +
      "If you delete the file later, the song stays listed as “removed”.";
    loadGis().catch(function () {});               // ready before the tap on Upload
  }

  /* ============================================================
   * SONGS WHOSE FILE WAS REMOVED
   * ============================================================ */

  var CSS = [
    ".song-row.missing{border-color:rgba(255,110,110,.55);background:linear-gradient(145deg,rgba(255,80,80,.12),var(--surface-2))}",
    ".song-row.missing .song-name{color:#ff9a9a;text-decoration:line-through;text-decoration-thickness:1px}",
    ".song-row.missing .song-meta{color:#ff9a9a}"
  ].join("\n");

  function markMissingRows() {
    var rows = document.querySelectorAll("#songs .song-row");
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].dataset.id;
      var s = songs.find(function (x) { return x.id === id; });
      if (!s || !s.missing) continue;
      rows[i].classList.add("missing");
      var meta = rows[i].querySelector(".song-meta");
      if (meta && meta.textContent.indexOf("File removed") < 0) meta.textContent = "⚠ File removed by the uploader · " + meta.textContent;
      var menu = rows[i].querySelector(".row-menu");
      if (menu && !menu.querySelector("[data-xrelink]") && me && (s.owner === me.name || isAdmin())) {
        menu.insertAdjacentHTML("afterbegin", '<button data-xrelink="' + id + '">↻ &nbsp;Re-upload the file</button>');
      }
    }
  }

  var _refresh = window.refresh;
  window.refresh = function () {
    var out = _refresh.apply(this, arguments);
    try { markMissingRows(); } catch (e) {}
    return out;
  };

  // a removed song does not start; a song that fails to start is checked once
  var _play = window.play;
  window.play = function (s) {
    if (s && s.missing) { toast("This song's file was removed by the uploader"); return Promise.resolve(); }
    var r = _play.apply(this, arguments);
    if (s && s.store === "user" && r && typeof r.then === "function") {
      r.then(function () {
        setTimeout(function () {
          if (!now || now.id !== s.id) return;
          if (!/can.t play|failed|not available|not found/i.test($("status").textContent || "")) return;
          checkGone(s);
        }, 1500);
      });
    }
    return r;
  };

  async function checkGone(s) {
    try {
      var j = await call("checkSong", { id: s.id });
      if (j && j.ok && j.missing) {
        s.missing = true;
        try { saveLib(); } catch (e) {}
        refresh();
        toast("This song's file was removed by the uploader");
        dlog("marked removed: " + s.title);
      }
    } catch (e) {}
  }

  /* ============================================================
   * START
   * ============================================================ */

  function mount() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    var uv = $("uv"), us = $("us");
    if (uv && uv.parentNode) {
      var sel = document.createElement("select");
      sel.id = "ustore"; sel.className = "in";
      uv.parentNode.insertBefore(sel, uv);
      var note = document.createElement("div");
      note.id = "uNote"; note.className = "small-note";
      if (us) us.parentNode.insertBefore(note, us);
      sel.onchange = function () { note.style.display = sel.value === "user" ? "" : "none"; };
    }

    var _up = $("upBtn").onclick;
    $("upBtn").onclick = function (e) {
      endRelink();
      prepareDialog();
      return _up && _up.call(this, e);
    };

    var _go = $("go").onclick;
    $("go").onclick = function () {
      var sel2 = $("ustore");
      if (sel2 && sel2.value === "user") return uploadMine();
      return _go && _go.call(this);
    };

    var _cl = $("cl").onclick;
    $("cl").onclick = function (e) { endRelink(); return _cl && _cl.call(this, e); };

    $("songs").addEventListener("click", function (ev) {
      var id = ev.target.dataset && ev.target.dataset.xrelink;
      if (!id) return;
      if (typeof closeMenus === "function") closeMenus();
      var s = songs.find(function (x) { return x.id === id; });
      if (s) startRelink(s);
    });
  }

  try { mount(); } catch (e) { dlog("start FAILED: " + (e && e.message || e)); console.error(e); return; }
  try { refresh(); } catch (e) {}
  window.__jmUpload = "1";
  dlog("add-on v1 loaded");
  console.log("Jus Music upload add-on ready");
})();
