(function () {
  const { SCHOOL, slugify, buildStaff, WEEKS, PLANNER } = window.P2_SEED;
  const KEY = "p2-dutodesk-v2";
  const LEGACY_KEY = "p2-dutodesk-v1";
  const PUSH_KEY = "p2-dutodesk-push";
  const MUST_KEY = "p2-dutodesk-mustchange";
  const FP_KEY = "p2-dutodesk-fp"; // "on" when fingerprint sign-in is switched on for this phone
  const FP_ID_KEY = "p2-dutodesk-fp-id"; // the passkey saved for this phone, so it can be removed
  const FP_HIDE_KEY = "p2-dutodesk-fp-hide"; // the home-screen suggestion was dismissed
  const SERVER_FUNCTION = "super-action"; // the Supabase Edge Function: sends message alerts and lets admins reset passwords
  const VAPID_PUBLIC_KEY = "BOaMBSrLUeSi3WvwUZXn3rEPEQWnyB2Xo6ADYMtqbGXmtGHgbauv7TB8bsu81Zqx_j8rMPTAD3UDpS9Hp57_FQI";
  const SESSION = "p2-dutodesk-session";
  const THEME = "p2-dutodesk-theme";
  const TERM_KEY = "p2-dutodesk-term";
  const EDITORS = new Set(["kenneth", "katende.kenneth", "headteacher", "akampwera.arc", "arch", "director"]);
  const TERM_NAMES = { 1: "Term I", 2: "Term II", 3: "Term III" };
  const root = document.getElementById("root");

  function currentTheme() {
    return localStorage.getItem(THEME) === "dark" ? "dark" : "light";
  }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", currentTheme());
  }
  applyTheme();

  function termId(year, term) { return year + "-T" + term; }
  function termLabel(year, term) { return (TERM_NAMES[term] || ("Term " + term)) + ", " + year; }
  function seedTerm() {
    return {
      id: "2026-T3",
      year: 2026,
      term: 3,
      label: "Term III, 2026",
      weeks: WEEKS.map((w) => ({ ...w, day: [...w.day], night: [...w.night] })),
      planner: PLANNER.map((p) => ({ ...p }))
    };
  }
  function applyEditorStaff(staff) {
    return (staff || []).map((s) => {
      const u = String(s.username || "").toLowerCase();
      let next = { ...s };
      delete next.password; // passwords live only in Supabase, never in this app
      if (u === "kenneth") next = { ...next, role: "superadmin", title: "Developer · Super Admin" };
      else if (u === "headteacher") next = { ...next, role: "admin", title: "Headteacher" };
      else if (u === "akampwera.arc" || u === "arch") next = { ...next, role: "admin", title: "Teacher Arch" };
      else if (u === "magyezi.gerald") next = { ...next, role: "teacher", title: "Teacher" };
      return next;
    });
  }
  function defaultState() {
    const t3 = seedTerm();
    return {
      version: 2,
      school: { ...SCHOOL, termLabel: t3.label, termCode: t3.id },
      staff: applyEditorStaff(buildStaff()),
      terms: [t3],
      activeTermId: t3.id,
      weeks: t3.weeks,
      planner: t3.planner,
      updatedAt: new Date().toISOString()
    };
  }
  function migrate(parsed) {
    if (!parsed || !parsed.staff) return defaultState();
    parsed.staff = applyEditorStaff(parsed.staff);
    if (!parsed.terms || !parsed.terms.length) {
      const id = (parsed.school && parsed.school.termCode) || "2026-T3";
      const label = (parsed.school && parsed.school.termLabel) || "Term III, 2026";
      parsed.terms = [{
        id, year: 2026, term: 3, label,
        weeks: (parsed.weeks || seedTerm().weeks).map((w) => ({ ...w, day: [...(w.day || [])], night: [...(w.night || [])] })),
        planner: (parsed.planner || []).map((p) => ({ ...p }))
      }];
    }
    parsed.version = 2;
    const remembered = localStorage.getItem(TERM_KEY);
    parsed.activeTermId = remembered || parsed.activeTermId || parsed.terms[0].id;
    if (!parsed.terms.some((t) => t.id === parsed.activeTermId)) parsed.activeTermId = parsed.terms[0].id;
    return parsed;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
      if (!raw) return defaultState();
      const loaded = migrate(JSON.parse(raw));
      // clear any old passwords cached on this phone by earlier versions
      if (raw.indexOf('"password"') !== -1 || localStorage.getItem(LEGACY_KEY)) {
        try { localStorage.setItem(KEY, JSON.stringify(loaded)); localStorage.removeItem(LEGACY_KEY); } catch (err) {}
      }
      return loaded;
    } catch {
      return defaultState();
    }
  }

  function saveState(state) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }
  function sbClient() {
    const cfg = window.P2_SUPABASE;
    if (!cfg || !window.supabase || !cfg.url || !cfg.anonKey) return null;
    if (!window._p2sb) window._p2sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { experimental: { passkey: true } } });
    return window._p2sb;
  }
  // ---------- message alerts (web push) ----------
  const PUSH_TEXT = { on: "Message alerts on", off: "Message alerts", denied: "Alerts blocked in phone settings", install: "Add to Home Screen for alerts" };
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function pushNeedsInstall() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !pushSupported();
  }
  function b64ToBytes(s) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function pushSub() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function pushSave(sub) {
    const sb = sbClient();
    if (!sb || !sub) return false;
    const j = sub.toJSON();
    if (!j.keys) return false;
    const res = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    return !res.error;
  }
  async function pushEnable() {
    if (!pushSupported()) return "unsupported";
    const perm = await Notification.requestPermission(); // must run straight from the tap
    if (perm !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    const ok = await pushSave(sub);
    if (!ok) return "error";
    localStorage.setItem(PUSH_KEY, "on");
    return "on";
  }
  async function pushDisable() {
    localStorage.setItem(PUSH_KEY, "off");
    const sub = await pushSub();
    if (!sub) return;
    const sb = sbClient();
    if (sb) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  // signing out: this phone stops getting this person's alerts
  async function pushLeave() {
    if (!pushSupported()) return;
    const sub = await pushSub();
    const sb = sbClient();
    if (sub && sb) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  }
  // quiet re-register after sign-in, if alerts were switched on for this phone
  async function pushSync() {
    if (!pushSupported() || Notification.permission !== "granted" || localStorage.getItem(PUSH_KEY) !== "on") return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    await pushSave(sub);
  }
  async function pushState() {
    if (!pushSupported()) return pushNeedsInstall() ? "install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    const sub = await pushSub();
    return sub && localStorage.getItem(PUSH_KEY) === "on" ? "on" : "off";
  }
  function paintPushNow(st) {
    const r = document.getElementById("push-btn");
    const c = document.getElementById("push-card");
    if (r) {
      r.hidden = st === "unsupported" || !st;
      r.dataset.state = st || "";
      r.disabled = st === "denied" || st === "install";
      r.setAttribute("aria-pressed", String(st === "on"));
      const label = r.querySelector(".push-label");
      if (label) label.textContent = PUSH_TEXT[st] || "Message alerts";
      const sw = r.querySelector(".switch");
      if (sw) sw.className = "switch " + (st === "on" ? "on" : "off");
    }
    if (c) c.hidden = st !== "off";
  }
  async function paintPush() {
    if (!document.getElementById("push-btn") && !document.getElementById("push-card")) return;
    if (window._pushState) paintPushNow(window._pushState);
    try { window._pushState = await pushState(); } catch (e) { window._pushState = "unsupported"; }
    paintPushNow(window._pushState);
  }
  async function togglePush(turnOn) {
    let st;
    try {
      if (turnOn) st = await pushEnable();
      else { await pushDisable(); st = "off"; }
    } catch (e) { st = "error"; }
    if (st === "error") alert("Could not change message alerts. Check your data connection and try again.");
    window._pushState = st === "on" ? "on" : st === "denied" ? "denied" : "off";
    paintPush();
  }

  // ---------- finish a sign-in (password or fingerprint) ----------
  async function completeSignIn(sb, authUser, typedUsername) {
    let profile = null;
    try {
      const r = await sb.from("staff_profiles").select("*").eq("id", authUser.id).maybeSingle();
      profile = r && r.data;
    } catch (e) {}
    const uname = (profile && profile.username) || typedUsername || String(authUser.email || "").split("@")[0];
    user = {
      id: uname,
      name: profile && profile.full_name ? profile.full_name : uname,
      username: uname,
      role: profile && profile.role ? profile.role : "teacher",
      title: profile && profile.title ? profile.title : "Staff",
      authId: authUser.id
    };
    sessionStorage.setItem(SESSION, JSON.stringify(user));
    if (authUser.user_metadata && authUser.user_metadata.must_change_password === true) sessionStorage.setItem(MUST_KEY, "1");
    else sessionStorage.removeItem(MUST_KEY);
    await pullCloud();
    if (isEditor(user)) await pushCloud().catch(function () {});
    go("/");
    render();
  }

  // ---------- fingerprint sign-in (passkeys: the phone checks your fingerprint or screen lock) ----------
  const fpOn = () => localStorage.getItem(FP_KEY) === "on";
  async function fpAvailable() {
    try {
      const sb = sbClient();
      if (!window.PublicKeyCredential || !sb || !sb.auth || typeof sb.auth.registerPasskey !== "function" || typeof sb.auth.signInWithPasskey !== "function") return false;
      if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      return true;
    } catch (e) { return false; }
  }
  function fpErrorText(err) {
    const code = String((err && (err.code || err.error_code)) || "");
    const name = String((err && err.name) || "");
    const msg = String((err && err.message) || "").toLowerCase();
    if (name === "NotAllowedError" || name === "AbortError" || msg.indexOf("cancel") !== -1 || msg.indexOf("not allowed") !== -1 || msg.indexOf("timed out") !== -1) return ""; // the person backed out
    if (code === "passkey_disabled" || msg.indexOf("passkey_disabled") !== -1) return "Fingerprint sign-in is not switched on at the school yet. Ask the developer.";
    if (code === "webauthn_credential_not_found") return "Your fingerprint sign-in is no longer valid. Sign in with your password.";
    if (code === "too_many_passkeys") return "This account already has the most fingerprint phones allowed. Ask the duty office to reset it.";
    if (code === "email_not_confirmed" || code === "user_banned") return "This account cannot sign in right now. See the duty office.";
    return "Fingerprint sign-in did not work. Sign in with your password.";
  }
  async function fpDisable() {
    const id = localStorage.getItem(FP_ID_KEY);
    localStorage.removeItem(FP_KEY);
    localStorage.removeItem(FP_ID_KEY);
    const sb = sbClient();
    if (id && sb && sb.auth && sb.auth.passkey && typeof sb.auth.passkey.delete === "function") {
      try { await sb.auth.passkey.delete({ passkeyId: id }); } catch (e) {}
    }
  }
  async function runFingerprintLogin(auto) {
    if (window._fpBusy) return;
    const err = document.getElementById("login-error");
    const sb = sbClient();
    if (!sb || !sb.auth || typeof sb.auth.signInWithPasskey !== "function") {
      if (!auto && err) { err.textContent = "Fingerprint sign-in is not available on this phone. Use your password."; }
      return;
    }
    window._fpBusy = true;
    try {
      const res = await sb.auth.signInWithPasskey();
      if (res.error || !res.data || !res.data.user) {
        const text = fpErrorText(res.error);
        if (res.error && res.error.code === "webauthn_credential_not_found") {
          localStorage.removeItem(FP_KEY);
          localStorage.removeItem(FP_ID_KEY);
          window._fpBusy = false;
          render();
          const e2 = document.getElementById("login-error");
          if (e2) e2.textContent = text;
          return;
        }
        if (text && err) err.textContent = text;
        return;
      }
      await completeSignIn(sb, res.data.user, "");
    } catch (ex) {
      const text = fpErrorText(ex);
      if (text && err) err.textContent = text;
    } finally {
      window._fpBusy = false;
    }
  }
  function fpCardHtml() {
    return '<div class="push-card" id="fp-card" hidden><div><strong>Sign in faster with your fingerprint</strong><span>Skip typing your username and password. Your fingerprint stays on your phone.</span></div>' +
      '<div class="fp-actions"><button class="btn small" id="fp-on" type="button">Turn on</button><button class="btn small ghost" id="fp-hide" type="button">Not now</button></div></div>';
  }
  async function paintFp() {
    if (!document.getElementById("fp-menu") && !document.getElementById("fp-card")) return;
    let ok = false;
    try { ok = await fpAvailable(); } catch (e) {}
    const on = fpOn();
    const r = document.getElementById("fp-menu");
    const c = document.getElementById("fp-card");
    if (r) {
      r.hidden = !ok;
      r.setAttribute("aria-pressed", String(on));
      const sw = r.querySelector(".switch");
      if (sw) sw.className = "switch " + (on ? "on" : "off");
      const l = r.querySelector(".fp-label");
      if (l) l.textContent = on ? "Fingerprint sign-in on" : "Fingerprint sign-in";
    }
    if (c) c.hidden = !(ok && !on && localStorage.getItem(FP_HIDE_KEY) !== "1");
  }
  function fingerprintView() {
    const svg = (size, body) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false" fill="currentColor">' + body + "</svg>";
    const lock = (size) => svg(size, '<path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0z"/><circle cx="12" cy="16" r="1.6" fill="#fff" fill-opacity=".9"/>');
    return '<div class="lg-shell"><div class="lg-wrap">' +
      '<header class="lg-hero pw-hero"><img class="lg-badge" src="badge.jpg" alt="Plus Two High School badge"><div class="lg-hero-text"><h1>Duty Desk</h1><p class="lg-motto">Combine Efforts</p></div></header>' +
      '<div class="lg-frame"><span class="lg-glow" aria-hidden="true"><i></i></span><form class="lg-card" id="fp-form" novalidate>' +
        '<h2 class="lg-title">' + ICON.finger.replace('width="20" height="20"', 'width="34" height="34"') + "<span>Fingerprint</span></h2>" +
        '<p class="lg-intro">Next time, open Duty Desk and use your fingerprint instead of typing. Your fingerprint never leaves your phone.</p>' +
        '<div class="lg-field"><label class="lg-label" for="fp-pass">' + lock(22) + "<span>Your password</span></label>" +
        '<div class="lg-input">' + lock(22) + '<input type="password" id="fp-pass" autocomplete="current-password" autocapitalize="none" spellcheck="false"></div></div>' +
        '<p class="pw-note">We ask for it once to confirm it is you. Anyone whose fingerprint is saved on this phone will be able to sign in as you, so keep only your own on it.</p>' +
        '<p class="error lg-error" id="fp-error" role="alert"></p>' +
        '<button class="lg-submit" type="submit" id="fp-submit"><span class="lg-submit-label">Turn on fingerprint</span></button>' +
        '<button class="lg-theme" type="button" id="fp-cancel"><span>Cancel</span></button>' +
      "</form></div></div></div>";
  }
  function bindFingerprint() {
    const form = document.getElementById("fp-form");
    if (!form) return;
    const pw = document.getElementById("fp-pass");
    const err = document.getElementById("fp-error");
    const btn = document.getElementById("fp-submit");
    let verified = false; // password already confirmed on this screen, so a retry only needs the fingerprint
    document.getElementById("fp-cancel").onclick = () => { window._fpView = false; render(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      const sb = sbClient();
      if (!sb) { err.textContent = "The school server could not be reached. Check your data connection."; return; }
      if (!verified && !pw.value) { err.textContent = "Enter your password."; return; }
      btn.disabled = true;
      const label = btn.querySelector(".lg-submit-label");
      label.textContent = "Working…";
      try {
        if (!verified) {
          const cfg = window.P2_SUPABASE || {};
          const email = String(user.username).toLowerCase() + "@" + (cfg.emailDomain || "dutodesk.p2.internal");
          const re = await sb.auth.signInWithPassword({ email, password: pw.value });
          if (re.error) { err.textContent = "Your password is not correct."; return; }
          verified = true;
        }
        const res = await sb.auth.registerPasskey();
        if (res.error && res.error.code !== "webauthn_credential_exists") {
          const t = fpErrorText(res.error);
          err.textContent = t || "Fingerprint sign-in was not turned on. Tap Turn on fingerprint to try again.";
          return;
        }
        localStorage.setItem(FP_KEY, "on");
        if (res.data && res.data.id) localStorage.setItem(FP_ID_KEY, res.data.id);
        window._fpAuto = true;
        form.innerHTML = '<h2 class="lg-title"><span>Fingerprint is on</span></h2><p class="lg-intro lg-ok">Next time, open Duty Desk and tap <b>Sign in with fingerprint</b>. If your phone asks for your screen lock instead, that works the same way.</p><button class="lg-submit" type="button" id="fp-done"><span class="lg-submit-label">Done</span></button>';
        document.getElementById("fp-done").onclick = () => { window._fpView = false; go("/"); render(); };
      } catch (ex) {
        const t = fpErrorText(ex);
        err.textContent = t || "Fingerprint sign-in was not turned on. Tap Turn on fingerprint to try again.";
      } finally {
        const b2 = document.getElementById("fp-submit");
        if (b2) { b2.disabled = false; const l2 = b2.querySelector(".lg-submit-label"); if (l2) l2.textContent = "Turn on fingerprint"; }
      }
    };
  }

  function cloudWeekId(termId, weekId) { return termId + "::" + weekId; }
  function localWeekId(cloudId) {
    const s = String(cloudId || "");
    return s.includes("::") ? s.slice(s.indexOf("::") + 2) : s;
  }
  async function pullCloud() {
    const sb = sbClient();
    if (!sb) return false;
    const { data: terms, error } = await sb.from("terms").select("*");
    if (error || !terms || !terms.length) return false;
    const { data: weeks } = await sb.from("weeks").select("*");
    const { data: events } = await sb.from("planner").select("*");
    const mapped = terms.map((t) => {
      const tw = (weeks || []).filter((w) => w.term_id === t.id).sort((a, b) => a.week - b.week);
      const tp = (events || []).filter((p) => p.term_id === t.id);
      const seed = t.id === "2026-T3" ? seedTerm() : null;
      return {
        id: t.id,
        year: t.year,
        term: t.term,
        label: t.label,
        weeks: tw.length ? tw.map((w) => ({
          id: localWeekId(w.id),
          week: w.week,
          start: w.start_date,
          end: w.end_date,
          label: w.label,
          day: w.day_names || [],
          night: w.night_names || []
        })) : (seed ? seed.weeks : []),
        planner: tp.length ? tp.map((p) => ({
          id: localWeekId(p.id),
          date: p.event_date,
          title: p.title,
          kind: p.kind || "academic"
        })).sort((a, b) => String(a.date).localeCompare(String(b.date))) : (seed ? seed.planner : [])
      };
    }).sort((a, b) => a.year - b.year || a.term - b.term);
    state.terms = mapped;
    if (!mapped.some((t) => t.id === state.activeTermId)) state.activeTermId = mapped[0].id;
    syncTermMirror();
    saveState(state);
    return true;
  }
  async function pushCloud() {
    if (!isEditor(user)) return;
    const sb = sbClient();
    if (!sb) return;
    const t = activeTerm();
    if (!t) return;
    await sb.from("terms").upsert({ id: t.id, year: Number(t.year), term: Number(t.term), label: t.label });
    await sb.from("weeks").delete().eq("term_id", t.id);
    const weekRows = (t.weeks || []).map((w) => ({
      id: cloudWeekId(t.id, w.id),
      term_id: t.id,
      week: Number(w.week) || 1,
      start_date: w.start,
      end_date: w.end,
      label: w.label || "",
      day_names: w.day || [],
      night_names: w.night || []
    }));
    if (weekRows.length) await sb.from("weeks").insert(weekRows);
    await sb.from("planner").delete().eq("term_id", t.id);
    const planRows = (t.planner || []).map((p) => ({
      id: cloudWeekId(t.id, p.id),
      term_id: t.id,
      event_date: p.date,
      title: p.title,
      kind: p.kind || "academic"
    }));
    if (planRows.length) await sb.from("planner").insert(planRows);
  }

  let state = loadState();
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem(SESSION) || "null"); } catch { user = null; }

  function persist() {
    const t = activeTerm();
    if (t) {
      if (state.weeks) t.weeks = state.weeks;
      if (state.planner) t.planner = state.planner;
    }
    syncTermMirror();
    state = saveState(state);
    pushCloud().catch(function () {});
    render();
  }
  function isEditor(u) {
    if (!u) return false;
    const name = String(u.username || "").toLowerCase();
    return EDITORS.has(name) || u.role === "admin" || u.role === "superadmin";
  }
  function isAdmin(u) { return isEditor(u); }
  function isSuper(u) { return u && (u.role === "superadmin" || String(u.username || "").toLowerCase() === "kenneth"); }
  function roleLabel(u) {
    if (isSuper(u)) return "Super admin";
    if (isEditor(u)) return "Admin";
    return "Teacher";
  }
  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "")[0] || "") .toUpperCase() + ((parts[1] || "")[0] || "").toUpperCase();
  }
  const ICON = {
    home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"/></svg>',
    table: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M9.5 4.5V19.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    message: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 3.4V17H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><circle cx="12" cy="12" r="3"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
    finger: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5v1.2"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5c0 2-.3 3.6-.8 5"/><path d="M12 7.5a4.5 4.5 0 0 0-4.5 4.5c0 3 .6 5.2 1.6 7.2"/><path d="M12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 2.6-.4 4.7-1.2 6.5"/><path d="M12 11.5a1 1 0 0 0-1 1c0 2.2.4 4.2 1.2 6"/><path d="M12 11.5a1 1 0 0 1 1 1c0 1.8-.3 3.4-.8 4.8"/><path d="M3.6 16.5c.2.8.5 1.6.8 2.3"/></svg>',
    exit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
  };
  function activeTerm() {
    const list = state.terms || [];
    return list.find((t) => t.id === state.activeTermId) || list[0] || seedTerm();
  }
  function weeks() { return activeTerm().weeks || []; }
  function planner() { return activeTerm().planner || []; }
  function syncTermMirror() {
    const t = activeTerm();
    state.weeks = t.weeks;
    state.planner = t.planner;
    state.school = { ...state.school, termLabel: t.label, termCode: t.id };
    state.activeTermId = t.id;
    try { localStorage.setItem(TERM_KEY, t.id); } catch (e) {}
  }
  function switchTerm(id) {
    state.activeTermId = id;
    window._weekId = null;
    window._cal = null;
    syncTermMirror();
    persist();
  }
  function prettyRange(start, end) {
    if (!start || !end) return "";
    const a = parseISO(start);
    const b = parseISO(end);
    const left = a.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    const right = b.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return left + " – " + right;
  }
  syncTermMirror();

  function staffNames() {
    const skip = new Set(["kenneth", "headteacher"]);
    return [...new Set(state.staff.filter((s) => !skip.has(s.username)).map((s) => s.name))].sort();
  }
  function matchStaffName(token) {
    const t = String(token || "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 3) return null;
    const names = staffNames();
    const low = t.toLowerCase();
    const exact = names.find((n) => n.toLowerCase() === low);
    if (exact) return exact;
    const starts = names.find((n) => n.toLowerCase().startsWith(low) || low.startsWith(n.toLowerCase()));
    if (starts) return starts;
    return names.find((n) => low.includes(n.toLowerCase()) || n.toLowerCase().includes(low)) || null;
  }
  function parseRotaText(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const built = [];
    let cur = null;
    let mode = "day";
    function flush() { if (cur) built.push(cur); cur = null; }
    function startWeek(n, start, end) {
      flush();
      const week = n || built.length + 1;
      const s = start || "";
      const e = end || "";
      cur = { id: "w" + Date.now() + "-" + week, week, start: s, end: e, label: s && e ? prettyRange(s, e) : ("Week " + week), day: [], night: [] };
      mode = "day";
    }
    lines.forEach((line) => {
      const weekHit = line.match(/week\s*(\d+)/i);
      const iso = line.match(/(\d{4}-\d{2}-\d{2}).{1,20}(\d{4}-\d{2}-\d{2})/);
      if (weekHit || iso) {
        startWeek(weekHit ? Number(weekHit[1]) : built.length + 1, iso && iso[1], iso && iso[2]);
      }
      if (/^night\b/i.test(line) || /\bnight duty\b/i.test(line)) mode = "night";
      if (/^day\b/i.test(line) || /\bday duty\b/i.test(line)) mode = "day";
      const chunk = line.replace(/^week\s*\d+\s*[:.\-]?\s*/i, "").replace(/^(day|night)\s*(duty)?\s*[:.\-]?\s*/i, "");
      chunk.split(/[,;|/]+/).forEach((part) => {
        const name = matchStaffName(part);
        if (name && cur && !cur[mode].includes(name)) cur[mode].push(name);
      });
    });
    flush();
    return built;
  }
  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error("Could not load the photo reader"));
      document.head.appendChild(s);
    });
  }
  function todayISO() {
    const d = new Date();
    const local = new Date(d.getTime() + (d.getTimezoneOffset() + 180) * 60000);
    return local.toISOString().slice(0, 10);
  }
  function parseISO(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtLong(iso) {
    return parseISO(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysUntil(iso) {
    return Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  }
  function currentWeek() {
    const t = todayISO();
    return state.weeks.find((w) => w.start <= t && t <= w.end) || null;
  }
  function aliases(u) {
    const names = [u && u.name];
    const userName = String((u && u.username) || "").toLowerCase();
    if (userName === "kenneth") names.push("Katende Kenneth", "Katende Kenneth John");
    if (userName === "arch" || userName === "akampwera.arc") names.push("Akampwera Arc");
    return names.filter(Boolean);
  }
  function onTeam(list, u) {
    const names = aliases(u || user).map((n) => String(n).toLowerCase());
    return (list || []).some((n) => {
      const ln = String(n || "").toLowerCase();
      return names.some((a) => a === ln || a.includes(ln) || ln.includes(a));
    });
  }
  function isDeveloper(u) {
    return String((u || user || {}).username || "").toLowerCase() === "kenneth";
  }
  function isHeadTeacher(u) {
    const name = String((u || user || {}).username || "").toLowerCase();
    return name === "headteacher" || name === "kenneth";
  }
  function canOpenChat(w, shift, u) {
    const who = u || user;
    if (isDeveloper(who)) return true;
    if (!w) return false;
    return onTeam(shift === "night" ? w.night : w.day, who);
  }
  function fmtClock(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-GB", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        hour12: false, timeZone: "Africa/Kampala"
      });
    } catch (e) {
      return String(iso).slice(11, 16);
    }
  }
  function shortWeekLabel(w) {
    if (!w) return "";
    if (!w.start || !w.end) return "Week " + w.week;
    const a = parseISO(w.start);
    const b = parseISO(w.end);
    return "Week " + w.week + " · " + a.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – " + b.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function longWeekLabel(w) {
    if (!w) return "";
    if (!w.start || !w.end) return "Week " + w.week;
    const a = parseISO(w.start);
    const b = parseISO(w.end);
    return "Week " + w.week + " · " + a.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – " + b.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function weekShiftsFor(w, u) {
    const who = u || user;
    const out = [];
    if (!w) return out;
    if (onTeam(w.day, who)) out.push("day");
    if (onTeam(w.night, who)) out.push("night");
    return out;
  }
  function dutiesFor(u) {
    const names = aliases(u);
    const hits = [];
    for (const w of state.weeks) {
      if (names.some((n) => w.day.includes(n))) hits.push({ ...w, shift: "Day" });
      if (names.some((n) => w.night.includes(n))) hits.push({ ...w, shift: "Night" });
    }
    return hits;
  }
  function nextDuty(list) {
    const t = todayISO();
    return list.find((d) => d.end >= t) || null;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function route() {
    const h = (location.hash || "#/").replace(/^#/, "");
    return h.startsWith("/") ? h : "/" + h;
  }
  function go(path) {
    location.hash = "#" + path;
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function icsEscape(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  function icsStamp() {
    const d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function vevent({ uid, start, end, title, desc, alarms }) {
    const lines = [
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + icsStamp(),
      "DTSTART;VALUE=DATE:" + start.replace(/-/g, ""),
      "DTEND;VALUE=DATE:" + end.replace(/-/g, ""),
      "SUMMARY:" + icsEscape(title),
      "DESCRIPTION:" + icsEscape(desc),
      "LOCATION:" + icsEscape(SCHOOL.fullName)
    ];
    (alarms || []).forEach((a) => {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(a.desc), "TRIGGER:" + a.trigger, "END:VALARM");
    });
    lines.push("END:VEVENT");
    return lines.join("\r\n");
  }
  function buildIcs(person) {
    const duties = dutiesFor(person);
    const events = [];
    duties.forEach((d) => {
      events.push(vevent({
        uid: "duty-" + d.id + "-" + d.shift + "-" + person.id + "@plustwo.dutodesk",
        start: d.start, end: addDays(d.end, 1),
        title: d.shift + " duty · Week " + d.week + " · " + SCHOOL.name,
        desc: person.name + " is on " + d.shift.toLowerCase() + " duty.\nWeek " + d.week + ": " + d.label + "\nDuty head: " + (d.shift === "Day" ? orderTeam(d.day)[0] : orderTeam(d.night)[0]) + "\nTeam: " + orderTeam(d.shift === "Day" ? d.day : d.night).join(", ") + "\n" + SCHOOL.motto,
        alarms: [
          { trigger: "-PT24H", desc: "Reminder 1: duty week begins tomorrow" },
          { trigger: "-PT19H", desc: "Reminder 2: duty week begins tomorrow" },
          { trigger: "-PT13H", desc: "Reminder 3: duty week begins tomorrow" }
        ]
      }));
      events.push(vevent({
        uid: "prep-" + d.id + "-" + d.shift + "-" + person.id + "@plustwo.dutodesk",
        start: addDays(d.start, -1), end: d.start,
        title: "Prepare · " + d.shift + " duty starts tomorrow (Week " + d.week + ")",
        desc: "Three reminders today before your duty week begins.",
        alarms: [
          { trigger: "-PT11H", desc: "Morning reminder — duty week starts tomorrow" },
          { trigger: "-PT6H", desc: "Midday reminder — duty week starts tomorrow" },
          { trigger: "-PT0H", desc: "Evening reminder — duty week starts tomorrow" }
        ]
      }));
    });
    state.planner.forEach((p) => {
      events.push(vevent({
        uid: "plan-" + p.id + "@plustwo.dutodesk",
        start: p.date, end: addDays(p.date, 1),
        title: p.title + " · " + SCHOOL.name,
        desc: activeTerm().label + " · " + SCHOOL.motto,
        alarms: [{ trigger: "-PT16H", desc: p.title }]
      }));
    });
    return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Plus Two High School//DutyDesk//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:P2 DutyDesk · " + person.name,"X-WR-TIMEZONE:Africa/Kampala", events.join("\r\n"), "END:VCALENDAR"].join("\r\n");
  }
  function googleUrl(title, start, end, details) {
    const dates = start.replace(/-/g, "") + "/" + addDays(end || start, 1).replace(/-/g, "");
    const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates, details: details || "", location: SCHOOL.fullName });
    return "https://calendar.google.com/calendar/render?" + p.toString();
  }

  function orderTeam(list) {
    const clean = (list || []).filter(Boolean);
    if (!clean.length) return [];
    const head = clean[0];
    const rest = clean.slice(1).filter((n) => n !== head).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    return [head, ...rest];
  }
  function chips(list, mine) {
    return '<div class="people">' + orderTeam(list).map((n, i) =>
      '<span class="person' + (i === 0 ? " head" : "") + (n === mine ? " me" : "") + '">' + escapeHtml(n) + (i === 0 ? " · head" : "") + "</span>"
    ).join("") + "</div>";
  }

  function navLink(path, label) {
    return '<a href="#' + path + '" class="' + (route() === path ? "active" : "") + '">' + label + "</a>";
  }

  function deskWeek() {
    const id = window._deskWeekId;
    return state.weeks.find((w) => w.id === id) || currentWeek() || state.weeks[0] || null;
  }
  function logView() {
    const w = deskWeek();
    if (!w) {
      return '<div class="hero"><span class="motto">DUTY LOG</span><h2>No published week</h2><p>Publish a rota first, then this page can hold the week chat and daily notes.</p></div>';
    }
    window._deskWeekId = w.id;
    const myShifts = weekShiftsFor(w, user);
    const canNotesDay = onTeam(w.day, user) || isHeadTeacher();
    const canNotesNight = onTeam(w.night, user) || isHeadTeacher();
    const showDay = canNotesDay || isDeveloper();
    const showNight = canNotesNight || isDeveloper();
    const defaultShift = myShifts[0] || (isHeadTeacher() || isDeveloper() ? "day" : "");
    if (!window._deskShift) window._deskShift = defaultShift;
    if (window._deskShift === "day" && !showDay && showNight) window._deskShift = "night";
    if (window._deskShift === "night" && !showNight && showDay) window._deskShift = "day";
    const shift = window._deskShift || defaultShift;
    const canChat = canOpenChat(w, shift, user);
    const canNotes = shift === "day" ? canNotesDay : canNotesNight;
    const team = shift === "night" ? w.night : w.day;
    const weekOpts = state.weeks.map((x) => '<option value="' + x.id + '"' + (x.id === w.id ? " selected" : "") + ">" + escapeHtml(shortWeekLabel(x)) + "</option>").join("");
    const teamChips = '<div class="people">' + orderTeam(team).map((n) => '<span class="person' + (n === orderTeam(team)[0] ? " head" : "") + '">' + escapeHtml(n) + "</span>").join("") + "</div>";
    const locked = !canNotes && !canChat ? '<div class="card"><p>This log is only for the ' + (shift || "selected") + " team this week, and notes also go to the Headteacher.</p><p class=\"muted\">You are not on this shift.</p></div>" : "";
    const chatBox = !canChat ? '<p class="hint">Chat is only for this ' + shift + " team. The developer can open both rooms.</p>" :
      '<div class="chat-log" id="chat-log"></div><form class="chat-form" id="chat-form"><input name="body" maxlength="500" placeholder="Message the ' + shift + ' team only" autocomplete="off"><button class="btn" type="submit">Send</button></form>';
    const noteBox = !canNotes ? "" :
      '<form class="card log-card" id="note-form"><h3>Daily record</h3><p class="hint">Write what happened today while it is still clear. Sunday compile uses these lines.</p><label class="field"><span>Date</span><input type="date" name="date" value="' + todayISO() + '" min="' + w.start + '" max="' + w.end + '"></label><label class="field"><span>What happened</span><textarea name="body" class="scan-box" required placeholder="Visitors, incidents, sick students, lights, gates…"></textarea></label><button class="btn" type="submit">Save today’s record</button><p class="ok" id="note-ok"></p></form>' +
      '<div class="card log-card"><h3>This week’s notes</h3><div id="notes-log"></div><div class="btn-row" style="margin-top:10px"><button class="btn gold" id="compile-report" type="button">Compile Sunday report</button><button class="btn" id="share-report" type="button">Share</button><button class="btn ghost" id="pdf-report" type="button">Save PDF</button></div></div>';
    return '<div class="log-page"><header class="log-head"><h2 class="serif log-title">Duty log</h2><p class="log-week">' + escapeHtml(longWeekLabel(w)) + '</p></header>' +
      (canChat ? '<div class="push-card" id="push-card" hidden><div><strong>Get alerts for new messages</strong><span>Your phone tells you when your team chat has a new message, even when Duty Desk is closed.</span></div><button class="btn small" id="push-on" type="button">Turn on</button></div>' : "") +
      '<div class="rules-box"><div>Day chat stays with day</div><div>Night chat stays with night</div><div>Notes: this team + Headteacher</div></div>' +
      '<label class="field week-field"><span class="sr-only">Week</span><select id="desk-week">' + weekOpts + "</select></label>" +
      '<div class="shift-pair">' +
      (showDay ? '<button type="button" class="btn shift-btn' + (shift === "day" ? "" : " ghost") + '" id="shift-day">Day</button>' : "") +
      (showNight ? '<button type="button" class="btn shift-btn' + (shift === "night" ? "" : " ghost") + '" id="shift-night">Night</button>' : "") +
      "</div>" +
      (locked || (
        '<div class="log-stack"><div class="card log-card"><h3>' + (shift === "night" ? "Night" : "Day") + " team chat</h3>" + teamChips + chatBox + "</div>" + noteBox + "</div>"
      )) + "</div>";
  }
  function datesInWeek(w) {
    const out = [];
    if (!w || !w.start || !w.end) return out;
    let d = w.start;
    while (d <= w.end) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }
  function compileDutyReport(w, shift, notes) {
    const team = shift === "night" ? w.night : w.day;
    const days = datesInWeek(w);
    const lines = [];
    lines.push(SCHOOL.fullName);
    lines.push("WEEK DUTY REPORT");
    lines.push((shift === "night" ? "NIGHT" : "DAY") + " DUTY  ·  Week " + w.week + "  ·  " + w.label);
    lines.push("Term: " + activeTerm().label);
    lines.push("Team: " + orderTeam(team).join(", "));
    lines.push("Duty head: " + (orderTeam(team)[0] || "—"));
    lines.push("Prepared: " + fmtLong(todayISO()) + " by " + user.name);
    lines.push("");
    days.forEach((iso) => {
      lines.push(fmtLong(iso).toUpperCase());
      const hits = (notes || []).filter((n) => n.note_date === iso).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      if (!hits.length) lines.push("No record entered.");
      hits.forEach((n) => lines.push("- " + n.author_name + ": " + n.body));
      lines.push("");
    });
    lines.push("Compiled from Duty Desk daily records so the Sunday book is not written from memory.");
    lines.push(SCHOOL.motto);
    return lines.join("\n");
  }

  function loginView() {
    const svg = (size, body, extra) =>
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false" ' + (extra || 'fill="currentColor"') + ">" + body + "</svg>";
    const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const I = {
      users: svg(38, '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 19.5c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6z"/><circle cx="17" cy="9" r="2.8"/><path d="M16.6 13.9c3 .2 5 2 5 4.9v.7h-4.2c0-2.2-.3-3.8-.8-5.6z"/>'),
      user: svg(28, '<circle cx="12" cy="7.5" r="4.2"/><path d="M3.8 21c0-4.4 3.6-7 8.2-7s8.2 2.6 8.2 7z"/>'),
      lock: svg(28, '<path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0z"/><circle cx="12" cy="16" r="1.6" fill="#fff" fill-opacity=".9"/>'),
      user24: svg(24, '<circle cx="12" cy="7.5" r="4.2"/><path d="M3.8 21c0-4.4 3.6-7 8.2-7s8.2 2.6 8.2 7z"/>'),
      lock24: svg(24, '<path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0z"/><circle cx="12" cy="16" r="1.6" fill="#fff" fill-opacity=".9"/>'),
      eyeOff: svg(24, '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>', stroke),
      eye: svg(24, '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', stroke),
      enter: svg(26, '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M4 12h11M11 7.5 15.5 12 11 16.5"/>', stroke.replace('stroke-width="2"', 'stroke-width="2.2"')),
      phone: svg(40, '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><circle cx="12" cy="17.6" r=".9" fill="currentColor"/>', stroke.replace('stroke-width="2"', 'stroke-width="2.2"')),
      call: svg(26, '<path d="M6.6 3.5h2.9l1.6 4-2 1.5a11 11 0 0 0 5.9 5.9l1.5-2 4 1.6v2.9a2 2 0 0 1-2.2 2C10.9 19 5 13.1 4.6 5.7a2 2 0 0 1 2-2.2z"/>'),
      sun: svg(22, '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9"/>', stroke),
      moon: svg(22, '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', stroke)
    };
    const dark = currentTheme() === "dark";
    return '<div class="lg-shell"><div class="lg-wrap">' +
      '<header class="lg-hero">' +
        '<img class="lg-badge" src="badge.jpg" alt="Plus Two High School badge">' +
        '<div class="lg-hero-text"><h1>Duty Desk</h1>' +
        '<p class="lg-school">' + SCHOOL.fullName + "</p>" +
        '<p class="lg-motto">Combine Efforts</p></div>' +
      "</header>" +
      '<div class="lg-frame"><span class="lg-glow" aria-hidden="true"><i></i></span><form class="lg-card' + (fpOn() ? " fp-on" : "") + '" id="login-form">' +
        '<h2 class="lg-title">' + I.users + "<span>Staff Login</span></h2>" +
        (fpOn() ? '<button class="lg-fp" id="fp-login" type="button">' + ICON.finger + '<span>Sign in with fingerprint</span></button><div class="lg-or lg-or-pw">or use your password</div>' : "") +
        '<p class="lg-intro">Staff desk for Plus Two High School, Bushenyi.<br>Sign in with the username and password issued by the school. Use your username, not an email address.</p>' +
        '<div class="lg-field"><label class="lg-label" for="login-user">' + I.user + "<span>Username</span></label>" +
          '<div class="lg-input">' + I.user24 + '<input id="login-user" name="username" placeholder="firstname.lastname" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus></div></div>' +
        '<div class="lg-field"><label class="lg-label" for="login-pass">' + I.lock + "<span>Password</span></label>" +
          '<div class="lg-input">' + I.lock24 + '<input type="password" name="password" id="login-pass" placeholder="School password" autocomplete="current-password">' +
          '<button type="button" class="lg-eye" id="pw-toggle" aria-label="Show password"><span class="lg-eye-icon">' + I.eyeOff + '</span><span class="lg-eye-label">Show</span></button></div></div>' +
        '<p class="error lg-error" id="login-error" role="alert"></p>' +
        '<button class="lg-submit" type="submit" id="login-submit">' + I.enter + '<span class="lg-submit-label">Enter the staff desk</span></button>' +
        '<div class="lg-or">OR</div>' +
        '<div class="lg-help">' + I.phone + '<div><strong>Forgotten your password?</strong><span>See the duty office.</span></div></div>' +
        '<button class="lg-install" id="install-btn" type="button">' + I.call + "<span>Install on this phone</span></button>" +
        '<button class="lg-theme" id="theme-btn" type="button">' + (dark ? I.sun : I.moon) + "<span>" + (dark ? "Use light mode" : "Use dark mode") + "</span></button>" +
      "</form></div>" +
      "</div></div>";
  }

  function yearChoices() {
    const years = [];
    for (let y = 2024; y <= 2035; y++) years.push(y);
    return years;
  }
  function ensureTerm(year, term) {
    const id = termId(year, term);
    const existing = (state.terms || []).find((x) => x.id === id);
    if (existing) return existing;
    const fresh = { id, year, term, label: termLabel(year, term), weeks: [], planner: [] };
    state.terms = [...(state.terms || []), fresh].sort((a, b) => a.year - b.year || a.term - b.term);
    return fresh;
  }
  function termPicker() {
    const t = activeTerm();
    return '<div class="term-picker">' +
      '<label><span>Year</span><select id="year-sel">' + yearChoices().map((y) => '<option value="' + y + '"' + (y === t.year ? " selected" : "") + ">" + y + "</option>").join("") + "</select></label>" +
      '<label><span>Term</span><select id="term-sel">' + [1, 2, 3].map((n) => '<option value="' + n + '"' + (n === t.term ? " selected" : "") + ">" + TERM_NAMES[n] + "</option>").join("") + "</select></label>" +
      "</div>";
  }
  function tabLink(path, label, icon) {
    return '<a href="#' + path + '" class="tab' + (route() === path ? " active" : "") + '">' + (icon || "") + '<span>' + label + "</span></a>";
  }
  function shell(inner) {
    const t = activeTerm();
    const menuOn = !!window._menuOpen;
    const termOn = !!window._termOpen;
    return '<div class="app-shell' + (route() === "/log" ? " app-log" : "") + '">' +
      '<header class="topbar slim"><div class="left"><img src="badge.jpg" alt=""><strong>Duty Desk</strong></div>' +
      '<button type="button" class="term-chip" id="term-open">' + t.year + " · " + (TERM_NAMES[t.term] || "") + "</button>" +
      '<button type="button" class="menu-btn" id="menu-btn" aria-label="Menu">☰</button></header>' +
      (termOn ? '<div class="term-sheet" id="term-sheet">' + termPicker() + "</div>" : "") +
      (menuOn ? '<div class="menu-scrim" id="menu-scrim"></div><aside class="side-menu open" id="side-menu">' +
        '<button type="button" class="menu-close" id="menu-close" aria-label="Close menu">&#10005;</button>' +
        '<div class="menu-id"><img src="badge.jpg" alt="School badge" class="menu-badge"><h2>Duty Desk</h2><p>' + SCHOOL.fullName + "</p></div>" +
        '<div class="menu-who"><span class="menu-avatar">' + initials(user.name) + '</span><div><strong>' + escapeHtml(user.name) + '</strong><span class="menu-role">' + roleLabel(user) + "</span></div></div>" +
        '<nav class="menu-links">' +
        (isEditor(user) ? '<a href="#/admin">' + ICON.person + '<span>Assign duty</span>' + ICON.chev + "</a>" : "") +
        (isSuper(user) ? '<a href="#/control">' + ICON.gear + '<span>Control</span>' + ICON.chev + "</a>" : "") +
        (isEditor(user) ? '<a href="#/admin" id="reset-link">' + ICON.key + '<span>Reset staff password</span>' + ICON.chev + "</a>" : "") +
        '<button type="button" id="push-btn" class="menu-toggle" aria-pressed="false" hidden>' + ICON.bell + '<span class="push-label">Message alerts</span><span class="switch off"><span class="knob"></span></span></button>' +
        '<button type="button" id="fp-menu" class="menu-toggle" aria-pressed="false" hidden>' + ICON.finger + '<span class="fp-label">Fingerprint sign-in</span><span class="switch off"><span class="knob"></span></span></button>' +
        '<button type="button" id="theme-btn" class="menu-toggle" aria-pressed="' + (currentTheme() === "dark") + '">' + ICON.moon + '<span>Dark mode</span><span class="switch ' + (currentTheme() === "dark" ? "on" : "off") + '"><span class="knob"></span></span></button>' +
        '<button type="button" id="pw-open" class="menu-signout">' + ICON.key + "<span>Change password</span>" + ICON.chev + "</button>" +
        '<button type="button" id="logout" class="menu-signout">' + ICON.exit + "<span>Sign out</span>" + ICON.chev + "</button>" +
        "</nav>" +
        '<p class="menu-motto">' + escapeHtml(SCHOOL.motto) + "</p>" +
        "</aside>" : "") +
      '<main class="page">' + inner + "</main>" +
      '<nav class="tabbar">' +
      tabLink("/", "My duty", ICON.home) +
      tabLink("/rota", "Full rota", ICON.table) +
      tabLink("/planner", "Term planner", ICON.list) +
      tabLink("/calendar", "Calendar", ICON.calendar) +
      tabLink("/log", "Duty log", ICON.message) +
      "</nav></div>";
  }

  function homeView() {
    const t = todayISO();
    const now = currentWeek();
    const unique = dutiesFor(user);
    const upcoming = nextDuty(unique);
    let nextHtml = '<p class="muted">No remaining weeks assigned this term.</p>';
    if (upcoming) {
      const du = daysUntil(upcoming.start);
      const status = du > 0 ? "Starts in " + du + " day(s)" : daysUntil(upcoming.end) >= 0 ? "This is your live week" : "Completed";
      const isHead = (upcoming.shift === "Day" ? upcoming.day[0] : upcoming.night[0]);
      const headChip = aliases(user).includes(isHead) ? '<span class="chip head" style="margin-left:6px">Duty head</span>' : "";
      nextHtml = '<div class="stat">Week ' + upcoming.week + " · " + upcoming.shift + '</div><p class="muted">' + escapeHtml(upcoming.label) + "<br>" + status + "</p>" +
        '<span class="chip ' + upcoming.shift.toLowerCase() + '">' + upcoming.shift + " duty</span>" + headChip;
    }
    const rows = unique.length ? unique.map((d) => {
      const team = d.shift === "Day" ? d.day : d.night;
      const live = now && now.id === d.id;
      return "<tr" + (live ? ' class="mine"' : "") + "><td class=\"col-week\"><b>W" + d.week + "</b>" + (live ? ' <span class="chip live">Live</span>' : "") + '<div class="week-dates">' + escapeHtml(d.label) + "</div></td><td class=\"col-shift\"><span class=\"chip " + d.shift.toLowerCase() + '">' + d.shift + "</span></td><td>" + escapeHtml(team[0] || "—") + "</td><td>" + chips(team, user.name) + "</td></tr>";
    }).join("") : '<tr><td colspan="4">You are not on the published rota for ' + escapeHtml(activeTerm().label) + ".</td></tr>";

    return '<section class="hero"><span class="motto">' + SCHOOL.motto + "</span><h2>Welcome, " + escapeHtml(user.name.split(" ")[0]) + ".</h2>" +
      "<p>" + SCHOOL.name + ", " + SCHOOL.campus + " · " + escapeHtml(activeTerm().label) + ". Switch year and term at the top to see other duty sheets.</p></section>" + fpCardHtml() +
      '<div class="grid three"><div class="card"><h3>Today</h3><div class="stat">' + fmtLong(t) + '</div><p class="muted">' + (now ? "On campus week " + now.week + " · " + now.label : "Outside a published duty week.") + "</p></div>" +
      '<div class="card"><h3>Your next duty</h3>' + nextHtml + "</div>" +
      '<div class="card"><h3>Phone calendar</h3><p class="muted">Downloads an .ics file. Open it on your phone to add every duty week and planner date to Google Calendar. Each duty week carries three reminders the day before.</p><div class="btn-row"><button class="btn" id="sync-mine">Sync my dates</button></div></div></div>' +
      '<div class="section-head"><h3 class="serif" style="margin:0;font-size:28px">Your weeks · ' + escapeHtml(activeTerm().label) + "</h3></div>" +
      '<div class="table-wrap mine-table"><table><thead><tr><th>Week</th><th>Shift</th><th>Duty head</th><th>Team</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function rotaView() {
    const t = todayISO();
    const rows = state.weeks.map((w) => {
      const live = w.start <= t && t <= w.end;
      return "<tr" + (live ? ' class="mine"' : "") + "><td><b>Week " + w.week + '</b><div class="muted">' + escapeHtml(w.label) + "</div>" + (live ? '<span class="chip live">This week</span>' : "") + "</td><td>" + chips(w.day, user.name) + "</td><td>" + chips(w.night, user.name) + "</td></tr>";
    }).join("");
    return '<div class="section-head"><div><h2 class="serif" style="margin:0">Duty rota · ' + activeTerm().label + '</h2><p class="muted">First name on each list is the duty head for that shift.</p></div><div class="btn-row no-print"><button class="btn gold" id="print-btn">Print / save PDF</button></div></div>' +
      '<div class="print-only" style="text-align:center;margin-bottom:12px"><img src="badge.jpg" width="72" alt=""><h2 style="margin:6px 0 0">' + SCHOOL.fullName + "</h2><div>DUTY ROTA FOR " + activeTerm().label.toUpperCase() + "</div><div>" + SCHOOL.motto + "</div></div>" +
      '<div class="table-wrap"><table><thead><tr><th>Date / week</th><th>Day duty</th><th>Night duty</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="hint">Source rota for ' + escapeHtml(activeTerm().label) + " · Plus Two High School — Bushenyi.</p>";
  }

  function plannerView() {
    const rows = state.planner.map((p) =>
      "<tr><td>" + fmtLong(p.date) + "</td><td>" + escapeHtml(p.title) + '</td><td><span class="chip day">' + escapeHtml(p.kind) + '</span></td><td class="no-print"><a class="btn small ghost" target="_blank" href="' + googleUrl(p.title + " · " + SCHOOL.name, p.date, p.date, activeTerm().label) + '">Google</a>' +
      (isEditor(user) ? '<button class="btn small danger rm-plan" data-id="' + p.id + '" style="margin-left:6px">Remove</button>' : "") + "</td></tr>"
    ).join("");
    const adminForm = isEditor(user) ? '<form class="card" id="plan-form" style="margin-bottom:14px"><h3>Add or adjust an activity</h3><div class="grid three"><label class="field"><span>Date</span><input type="date" name="date" value="' + todayISO() + '"></label><label class="field"><span>Type</span><select name="kind"><option>admin</option><option>staff</option><option selected>academic</option><option>exam</option><option>uneb</option><option>students</option><option>house</option><option>celebration</option><option>prefects</option><option>ceremony</option><option>parents</option></select></label><label class="field"><span>Activity</span><input name="title" required></label></div><button class="btn" type="submit">Save activity</button></form>' : "";
    return '<div class="banner-lead"><div class="card"><h3>Termly planner</h3><p class="muted">Official programme for ' + activeTerm().label + ". After login, sync these dates into Google Calendar so they sit next to your duty weeks.</p><div class=\"btn-row\"><button class=\"btn\" id=\"sync-all\">Sync planner + my duty</button><button class=\"btn ghost\" id=\"print-btn\">Print planner</button></div></div><div class=\"lead-photo\" title=\"School leadership\"></div></div>" +
      adminForm +
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Type</th><th class="no-print"></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="hint">NB: Deadline for submission of marks is one week after the last day of every exam set.</p>';
  }

  function monthMatrix(year, month) {
    const first = new Date(year, month, 1);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    const days = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  function eventsOn(iso) {
    const names = aliases(user);
    const list = [];
    state.weeks.forEach((w) => {
      if (w.start <= iso && iso <= w.end) {
        const dayMine = names.some((n) => w.day.includes(n));
        const nightMine = names.some((n) => w.night.includes(n));
        list.push({ color: dayMine ? "gold" : "green", title: "Week " + w.week + " · Day duty", detail: "Head: " + (orderTeam(w.day)[0] || "—") + " · " + orderTeam(w.day).join(", ") });
        list.push({ color: nightMine ? "gold" : "navy", title: "Week " + w.week + " · Night duty", detail: "Head: " + (orderTeam(w.night)[0] || "—") + " · " + orderTeam(w.night).join(", ") });
      }
    });
    state.planner.forEach((p) => {
      if (p.date === iso) {
        const map = { exam: "rose", uneb: "rose", celebration: "gold", academic: "teal", staff: "green", admin: "navy", students: "teal", house: "gold", prefects: "teal", ceremony: "gold", parents: "green" };
        list.push({ color: map[p.kind] || "teal", title: p.title, detail: (p.kind || "event") + " · " + activeTerm().label });
      }
    });
    return list;
  }

  function calendarView() {
    const start = parseISO(state.weeks[0] ? state.weeks[0].start : "2026-09-01");
    const today = todayISO();
    if (!window._cal) window._cal = { y: start.getFullYear(), m: start.getMonth(), sel: today };
    const c = window._cal;
    const label = new Date(c.y, c.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const cells = monthMatrix(c.y, c.m).map((d) => {
      if (!d) return '<div class="gday empty"></div>';
      const iso = c.y + "-" + pad(c.m + 1) + "-" + pad(d);
      const evs = eventsOn(iso);
      const colors = [];
      evs.forEach((e) => { if (colors.indexOf(e.color) === -1) colors.push(e.color); });
      const dots = colors.slice(0, 3).map((col) => '<i class="dot ' + col + '"></i>').join("");
      const cls = ["gday"];
      if (iso === today) cls.push("today");
      if (iso === c.sel) cls.push("selected");
      if (evs.length) cls.push("has-events");
      return '<button type="button" class="' + cls.join(" ") + '" data-iso="' + iso + '"><span class="n">' + d + '</span><span class="dots">' + dots + "</span></button>";
    }).join("");
    const selected = c.sel;
    const picked = selected ? eventsOn(selected) : [];
    const agenda = selected
      ? '<div class="agenda card"><h3>' + fmtLong(selected) + "</h3>" +
        (picked.length
          ? picked.map((e) => '<div class="agenda-item"><i class="dot ' + e.color + '"></i><div><b>' + escapeHtml(e.title) + "</b><p class=\"muted\">" + escapeHtml(e.detail) + "</p></div></div>").join("")
          : '<p class="muted">No duty or planner item on this day. Tap another date.</p>') +
        "</div>"
      : '<div class="agenda card"><p class="muted">Tap a day to see what is on.</p></div>';
    return '<div class="section-head"><h2 class="serif" style="margin:0">' + label + '</h2><div class="btn-row"><button class="btn ghost" id="cal-prev">Prev</button><button class="btn ghost" id="cal-today">Today</button><button class="btn ghost" id="cal-next">Next</button></div></div>' +
      '<div class="gcal">' + ["S","M","T","W","T","F","S"].map((d) => '<div class="dow">' + d + "</div>").join("") + cells + "</div>" +
      '<p class="hint cal-legend"><i class="dot gold"></i> Your duty &nbsp;<i class="dot green"></i> Day duty &nbsp;<i class="dot navy"></i> Night duty &nbsp;<i class="dot teal"></i> Planner &nbsp;<i class="dot rose"></i> Exam / UNEB · three dots = a busy day</p>' +
      agenda;
  }

  function adminView() {
    const t = activeTerm();
    if (!state.weeks.length) {
      state.weeks.push({ id: "w" + Date.now(), week: 1, start: todayISO(), end: addDays(todayISO(), 6), label: prettyRange(todayISO(), addDays(todayISO(), 6)), day: [], night: [] });
    }
    if (!window._weekId) window._weekId = state.weeks[0].id;
    const week = state.weeks.find((w) => w.id === window._weekId) || state.weeks[0];
    window._weekId = week.id;
    const names = staffNames();
    function col(shift, title) {
      return "<div><h3>" + title + " · head " + escapeHtml((week[shift][0] || "—")) + "</h3>" + names.map((n) => {
        const on = week[shift].includes(n);
        return '<div style="display:flex;gap:6px;margin-bottom:4px"><button class="btn small ' + (on ? "" : "ghost") + ' tog" data-shift="' + shift + '" data-name="' + escapeHtml(n) + '">' + escapeHtml(n) + "</button>" +
          (on ? '<button class="btn small gold headbtn" data-shift="' + shift + '" data-name="' + escapeHtml(n) + '">Head</button>' : "") + "</div>";
      }).join("") + "</div>";
    }
    const draft = window._scanText || "";
    return '<div class="section-head"><div><h2 class="serif" style="margin:0">Enter duty · ' + escapeHtml(t.label) + '</h2><p class="muted">Only Kenneth, the Headteacher and Teacher Arch can publish or change a rota. Type it, or photograph the printed sheet.</p></div><div class="btn-row"><button class="btn ghost" id="new-week">New week</button><button class="btn gold" id="print-btn">Print rota</button></div></div>' +
      '<form class="card" id="new-term-form" style="margin-bottom:14px"><h3>Open another year or term</h3><p class="muted">Teachers keep the same logins. You pick the year and term, then type or scan that term’s sheet.</p><div class="grid three"><label class="field"><span>Year</span><input name="year" type="number" min="2024" max="2040" value="' + (t.year + (t.term === 3 ? 1 : 0)) + '" required></label><label class="field"><span>Term</span><select name="term"><option value="1">Term I</option><option value="2">Term II</option><option value="3">Term III</option></select></label><div class="field"><span>&nbsp;</span><button class="btn" type="submit">Create empty term</button></div></div></form>' +
      '<div class="grid two" style="margin-bottom:14px"><div class="card"><h3>Type the rota</h3><p class="hint">One week per block. First names on Day / Night become duty heads.</p><textarea id="rota-text" class="scan-box" placeholder="Week 1 | 2027-01-12 | 2027-01-18&#10;Day: Atuhaire Joan, Tumwine Micheal&#10;Night: Barigye Denis, Ayebare Betty"></textarea><div class="btn-row"><button class="btn" id="parse-text">Build weeks from text</button></div><p class="hint" id="parse-note"></p></div>' +
      '<div class="card"><h3>Scan a printed sheet</h3><p class="hint">Take a photo of the official rota. The reader copies the words into the box so you can correct names, then build the weeks.</p><label class="btn ghost">Choose photo<input type="file" id="scan-file" accept="image/*" capture="environment" hidden></label><div id="scan-preview" class="scan-preview" hidden></div><div class="btn-row" style="margin-top:8px"><button class="btn" id="scan-read">Read the photo</button></div><p class="hint" id="scan-note"></p><textarea id="scan-text" class="scan-box" placeholder="Words from the photo appear here.">' + escapeHtml(draft) + "</textarea></div></div>" +
      '<div class="grid two"><div class="card"><label class="field"><span>Week</span><select id="week-sel">' +
      state.weeks.map((w) => '<option value="' + w.id + '"' + (w.id === week.id ? " selected" : "") + ">Week " + w.week + " · " + escapeHtml(w.label) + "</option>").join("") +
      '</select></label><div class="grid two"><label class="field"><span>Start</span><input type="date" id="w-start" value="' + week.start + '"></label><label class="field"><span>End</span><input type="date" id="w-end" value="' + week.end + '"></label></div><div class="grid two">' + col("day", "Day") + col("night", "Night") + "</div></div>" +
      '<div class="card"><h3>Who may edit</h3><p>Kenneth, the Headteacher and Teacher Arch. Everyone else can view their weeks and the published rota for any year or term.</p><p class="muted">Signed in as ' + escapeHtml(user.name) + " · editing " + escapeHtml(t.label) + ".</p></div></div>" + resetCardHtml();
  }

  function resetCardHtml() {
    const list = state.staff.filter((s) => s.id !== user.id).slice().sort((x, y) => x.name.localeCompare(y.name));
    return '<div class="card" id="reset-card" style="margin-top:14px"><h3>Reset a staff password</h3>' +
      '<p class="hint">For someone who has forgotten their password. You get a temporary password to give them privately. They must choose their own when they next sign in.</p>' +
      '<label class="field"><span>Staff member</span><input id="reset-who" list="reset-list" placeholder="Start typing a name" autocomplete="off" autocapitalize="words"></label>' +
      '<datalist id="reset-list">' + list.map((s) => '<option value="' + escapeHtml(s.name) + '"></option>').join("") + "</datalist>" +
      '<div class="btn-row"><button class="btn" id="reset-go" type="button">Reset password</button></div>' +
      '<p class="error" id="reset-err" role="alert" style="margin-top:8px"></p>' +
      '<div class="reset-result" id="reset-result" hidden></div></div>';
  }
  async function resetErrorText(error) {
    try {
      const j = await error.context.json();
      if (j && j.error) return j.error;
    } catch (e) {}
    return "Could not reset the password. Check your data connection and try again.";
  }
  function showTempPassword(name, pw) {
    const out = document.getElementById("reset-result");
    if (!out) return;
    out.hidden = false;
    out.innerHTML = '<p class="hint">Temporary password for <strong>' + escapeHtml(name) + '</strong>. Give it to them privately. It is shown once and disappears in 2 minutes.</p>' +
      '<div class="temp-pw" id="temp-pw">' + escapeHtml(pw) + '</div>' +
      '<div class="btn-row"><button class="btn small" id="temp-copy" type="button">Copy</button><button class="btn small ghost" id="temp-done" type="button">Done</button></div>';
    const clear = () => { out.innerHTML = ""; out.hidden = true; };
    document.getElementById("temp-done").onclick = clear;
    document.getElementById("temp-copy").onclick = () => {
      const b = document.getElementById("temp-copy");
      const ok = () => { if (b) b.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pw).then(ok, function () {});
      else { const r = document.createRange(); r.selectNodeContents(document.getElementById("temp-pw")); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    };
    setTimeout(clear, 2 * 60 * 1000);
  }
  async function runReset() {
    const input = document.getElementById("reset-who");
    const err = document.getElementById("reset-err");
    const btn = document.getElementById("reset-go");
    const out = document.getElementById("reset-result");
    err.textContent = "";
    out.hidden = true;
    out.innerHTML = "";
    const q = input.value.trim().toLowerCase();
    const person = state.staff.find((s) => s.name.toLowerCase() === q || String(s.username).toLowerCase() === q);
    if (!person) { err.textContent = "Pick a name from the list."; return; }
    if (person.id === user.id) { err.textContent = "Use Change password in the menu for your own password."; return; }
    if (!confirm("Reset the password for " + person.name + "?\n\nThey will be signed out on every phone and must choose a new password when they next sign in.")) return;
    const sb = sbClient();
    if (!sb) { err.textContent = "The school server could not be reached. Check your data connection."; return; }
    btn.disabled = true;
    btn.textContent = "Resetting…";
    try {
      const res = await sb.functions.invoke(SERVER_FUNCTION, { body: { action: "reset_password", username: person.username } });
      if (res.error) { err.textContent = await resetErrorText(res.error); return; }
      const pw = res.data && res.data.temp_password;
      if (!pw) { err.textContent = "Could not reset the password. Try again."; return; }
      showTempPassword(person.name, pw);
      input.value = "";
    } catch (ex) {
      err.textContent = "Could not reset the password. Check your data connection and try again.";
    } finally {
      const b2 = document.getElementById("reset-go");
      if (b2) { b2.disabled = false; b2.textContent = "Reset password"; }
    }
  }

  function controlView() {
    const rows = state.staff.map((s) =>
      "<tr><td>" + escapeHtml(s.name) + "</td><td>" + escapeHtml(s.username) + '</td><td><select class="role-sel" data-id="' + s.id + '"><option value="teacher"' + (s.role === "teacher" ? " selected" : "") + '>teacher</option><option value="admin"' + (s.role === "admin" ? " selected" : "") + '>admin</option><option value="superadmin"' + (s.role === "superadmin" ? " selected" : "") + ">superadmin</option></select></td><td>" +
      (s.id !== user.id ? '<button class="btn small danger rm-staff" data-id="' + s.id + '">Remove</button>' : '<span class="chip head">you</span>') + "</td></tr>"
    ).join("");
    return '<div class="hero"><span class="motto">DEVELOPER CONTROL</span><h2>Full command of DutyDesk</h2><p>Manage the staff list and roles, export the official rota, or restore the stamped Term III 2026 sheet. Passwords are kept in Supabase only.</p></div>' +
      '<div class="grid two"><form class="card" id="staff-form"><h3>Add staff to the list</h3><label class="field"><span>Full name</span><input name="name" required></label><label class="field"><span>Username (optional)</span><input name="username" placeholder="auto from name"></label><label class="field"><span>Role</span><select name="role"><option value="teacher">Teacher</option><option value="admin">Admin / duty office</option><option value="superadmin">Super Admin</option></select></label><button class="btn" type="submit">Add to list</button><p class="hint">Their sign-in is made in Supabase (Authentication → Users).</p><p class="ok" id="staff-note"></p></form>' +
      '<div class="card"><h3>Dataset</h3><p class="muted">Passwords are kept only in Supabase and never shown here. Export JSON after you publish a new term so other devices can import it.</p><div class="btn-row"><button class="btn" id="export-json">Download JSON</button><label class="btn ghost">Import JSON<input type="file" id="import-json" accept="application/json" hidden></label><button class="btn danger" id="restore">Restore official rota</button></div></div></div>' +
      '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function bind() {
    const loginForm = document.getElementById("login-form");
    function bindTheme() {
      const themeBtn = document.getElementById("theme-btn");
      if (!themeBtn) return;
      themeBtn.onclick = () => {
        localStorage.setItem(THEME, currentTheme() === "dark" ? "light" : "dark");
        applyTheme();
        render();
      };
    }
    bindTheme();
    const pwToggle = document.getElementById("pw-toggle");
    const pwInput = document.getElementById("login-pass");
    if (pwToggle && pwInput) {
      pwToggle.onclick = () => {
        const show = pwInput.type === "password";
        pwInput.type = show ? "text" : "password";
        const lbl = pwToggle.querySelector(".lg-eye-label");
        if (lbl) lbl.textContent = show ? "Hide" : "Show";
        pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
        const ico = pwToggle.querySelector(".lg-eye-icon svg");
        if (ico) ico.innerHTML = show
          ? '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'
          : '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>';
      };
    }
    const installBtn = document.getElementById("install-btn");
    if (installBtn) {
      installBtn.onclick = async () => {
        if (window._p2Install) {
          window._p2Install.prompt();
          try { await window._p2Install.userChoice; } catch (e) {}
          window._p2Install = null;
          return;
        }
        const err = document.getElementById("login-error");
        if (err) {
          err.hidden = false;
          err.textContent = "On this phone: open the browser menu and tap Add to Home screen (or Share → Add to Home Screen).";
        }
      };
    }
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(loginForm);
        let username = String(fd.get("username") || "").trim().toLowerCase();
        if (username === "arch") username = "akampwera.arc";
        const password = String(fd.get("password") || "");
        const err = document.getElementById("login-error");
        const submitBtn = document.getElementById("login-submit");
        function readyBtn() {
          if (!submitBtn) return;
          submitBtn.disabled = false;
          const l = submitBtn.querySelector(".lg-submit-label");
          if (l) l.textContent = "Enter the staff desk";
        }
        function fail(msg) {
          err.textContent = msg;
          readyBtn();
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          const l = submitBtn.querySelector(".lg-submit-label");
          if (l) l.textContent = "Signing in…";
        }
        const cfg = window.P2_SUPABASE;
        if (cfg && window.supabase && cfg.url && cfg.anonKey) {
          try {
            const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
            const email = username + "@" + (cfg.emailDomain || "dutodesk.p2.internal");
            const { data, error } = await sb.auth.signInWithPassword({ email, password });
            if (error || !data.user) {
              fail("Those details were not accepted. See the duty office if you have forgotten your password.");
              return;
            }
            await completeSignIn(sb, data.user, username);
            return;
          } catch (ex) {
            fail("Could not reach the school server. Check data and try again.");
            return;
          }
        }
        fail("The school server could not be reached. Check your data connection and try again.");
      });
      const fpLogin = document.getElementById("fp-login");
      if (fpLogin) {
        fpLogin.onclick = () => { runFingerprintLogin(false); };
        fpAvailable().then((ok) => {
          if (!ok) {
            const f = document.getElementById("fp-login");
            if (f) { const nxt = f.nextElementSibling; f.remove(); if (nxt && nxt.classList.contains("lg-or-pw")) nxt.remove(); }
            const card = document.getElementById("login-form");
            if (card) card.classList.remove("fp-on");
          } else if (!window._fpAuto) {
            window._fpAuto = true;
            setTimeout(() => { if (document.getElementById("fp-login")) runFingerprintLogin(true); }, 450);
          }
        });
      }
      return;
    }
    if (window._deskPoll) {
      clearInterval(window._deskPoll);
      window._deskPoll = null;
    }
    const deskWeekSel = document.getElementById("desk-week");
    if (deskWeekSel) {
      deskWeekSel.onchange = () => {
        window._deskWeekId = deskWeekSel.value;
        render();
      };
      const dayBtn = document.getElementById("shift-day");
      const nightBtn = document.getElementById("shift-night");
      if (dayBtn) dayBtn.onclick = () => { window._deskShift = "day"; render(); };
      if (nightBtn) nightBtn.onclick = () => { window._deskShift = "night"; render(); };

      async function loadDesk() {
        const sb = sbClient();
        const w = deskWeek();
        const shift = window._deskShift || "day";
        const chatEl = document.getElementById("chat-log");
        const notesEl = document.getElementById("notes-log");
        if (!sb || !w) {
          if (chatEl) chatEl.innerHTML = "<p class=\"hint\">Sign in to the school server to use chat.</p>";
          return;
        }
        const termId = activeTerm().id;
        const { data: chats } = await sb.from("duty_chat").select("*").eq("term_id", termId).eq("week_id", w.id).eq("shift", shift).order("created_at", { ascending: true });
        const { data: notes } = await sb.from("duty_notes").select("*").eq("term_id", termId).eq("week_id", w.id).eq("shift", shift).order("note_date", { ascending: true }).order("created_at", { ascending: true });
        window._deskNotes = notes || [];
        if (chatEl) {
          chatEl.innerHTML = (chats || []).length
            ? chats.map((m) => '<div class="chat-line' + (m.author_username === user.username ? " mine" : "") + '"><div class="chat-meta"><b>' + escapeHtml(m.author_name) + "</b><time>" + escapeHtml(fmtClock(m.created_at)) + "</time></div><span>" + escapeHtml(m.body) + "</span></div>").join("")
            : '<p class="hint">No messages yet</p>';
          chatEl.scrollTop = chatEl.scrollHeight;
        }
        if (notesEl) {
          const days = datesInWeek(w);
          notesEl.innerHTML = days.map((iso) => {
            const hits = (notes || []).filter((n) => n.note_date === iso);
            const body = hits.length
              ? hits.map((n) => "<p><b>" + escapeHtml(n.author_name) + "</b> — " + escapeHtml(n.body) + "</p>").join("")
              : '<p class="hint">No record yet.</p>';
            return "<div class=\"note-day\"><h4>" + escapeHtml(fmtLong(iso)) + "</h4>" + body + "</div>";
          }).join("");
        }
      }
      loadDesk().catch(function () {});
      window._deskPoll = setInterval(function () {
        if (route() !== "/log") {
          clearInterval(window._deskPoll);
          window._deskPoll = null;
          return;
        }
        loadDesk().catch(function () {});
      }, 10000);
      const sbLive = sbClient();
      const liveWeek = deskWeek();
      if (sbLive && liveWeek) {
        try {
          if (window._deskChannel) sbLive.removeChannel(window._deskChannel);
          const shiftLive = window._deskShift || "day";
          window._deskChannel = sbLive.channel("desk-" + activeTerm().id + "-" + liveWeek.id + "-" + shiftLive)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "duty_chat" }, function () { loadDesk(); })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "duty_notes" }, function () { loadDesk(); })
            .subscribe();
        } catch (e) {}
      }

      const chatForm = document.getElementById("chat-form");
      if (chatForm) chatForm.onsubmit = async (e) => {
        e.preventDefault();
        const sb = sbClient();
        const w = deskWeek();
        const shift = window._deskShift || "day";
        if (!sb || !w || !canOpenChat(w, shift, user)) return;
        const body = String(new FormData(chatForm).get("body") || "").trim();
        if (!body) return;
        const ins = await sb.from("duty_chat").insert({
          term_id: activeTerm().id,
          week_id: w.id,
          shift: shift,
          body: body,
          author_name: user.name,
          author_username: user.username
        }).select("id").single();
        if (ins.error) {
          alert("Could not send the message. Check your connection and try again.");
          return;
        }
        chatForm.reset();
        loadDesk().catch(function () {});
        if (ins.data && ins.data.id) {
          Promise.resolve(sb.functions.invoke(SERVER_FUNCTION, { body: { message_id: ins.data.id } })).catch(function () {});
        }
      };

      const noteForm = document.getElementById("note-form");
      if (noteForm) noteForm.onsubmit = async (e) => {
        e.preventDefault();
        const sb = sbClient();
        const w = deskWeek();
        const shift = window._deskShift || "day";
        const can = onTeam(shift === "night" ? w.night : w.day, user) || isHeadTeacher();
        if (!sb || !w || !can) return;
        const fd = new FormData(noteForm);
        const body = String(fd.get("body") || "").trim();
        const date = String(fd.get("date") || todayISO());
        if (!body) return;
        const { error } = await sb.from("duty_notes").insert({
          term_id: activeTerm().id,
          week_id: w.id,
          shift: shift,
          note_date: date,
          body: body,
          author_name: user.name,
          author_username: user.username
        });
        const ok = document.getElementById("note-ok");
        if (ok) ok.textContent = error ? "Could not save. Run the Duty log SQL in Supabase." : "Saved.";
        if (!error) {
          noteForm.querySelector("textarea").value = "";
          loadDesk().catch(function () {});
        }
      };

      function reportText() {
        const w = deskWeek();
        const shift = window._deskShift || "day";
        return { w, shift, text: compileDutyReport(w, shift, window._deskNotes || []), name: "Duty-report-W" + w.week + "-" + shift + "-" + activeTerm().id + ".txt" };
      }
      function printReport(text) {
        const html = "<html><head><title>Duty report</title><style>body{font-family:Georgia,serif;padding:24px;max-width:720px;margin:auto;line-height:1.45}pre{white-space:pre-wrap;font-family:Georgia,serif}</style></head><body><pre>" + escapeHtml(text) + "</pre><script>window.onload=function(){window.print()}<\/script></body></html>";
        const win = window.open("", "_blank");
        if (win) { win.document.write(html); win.document.close(); }
      }
      async function shareReport(text, name) {
        const file = new File([text], name, { type: "text/plain" });
        try {
          if (navigator.share) {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ title: "Week duty report", text: text, files: [file] });
              return;
            }
            await navigator.share({ title: "Week duty report", text: text });
            return;
          }
        } catch (e) {}
        window.open("https://wa.me/?text=" + encodeURIComponent(text.slice(0, 1800)), "_blank");
      }
      const compileBtn = document.getElementById("compile-report");
      if (compileBtn) compileBtn.onclick = () => {
        const pack = reportText();
        download(pack.name, pack.text, "text/plain;charset=utf-8");
        printReport(pack.text);
      };
      const shareBtn = document.getElementById("share-report");
      if (shareBtn) shareBtn.onclick = () => {
        const pack = reportText();
        shareReport(pack.text, pack.name);
      };
      const pdfBtn = document.getElementById("pdf-report");
      if (pdfBtn) pdfBtn.onclick = () => {
        const pack = reportText();
        printReport(pack.text);
      };
    }
    const fpMenu = document.getElementById("fp-menu");
    if (fpMenu) fpMenu.onclick = async () => {
      if (fpOn()) {
        if (!confirm("Turn off fingerprint sign-in on this phone?")) return;
        await fpDisable();
        paintFp();
      } else { window._menuOpen = false; window._fpView = true; render(); }
    };
    const fpOnBtn = document.getElementById("fp-on");
    if (fpOnBtn) fpOnBtn.onclick = () => { window._fpView = true; render(); };
    const fpHide = document.getElementById("fp-hide");
    if (fpHide) fpHide.onclick = () => { localStorage.setItem(FP_HIDE_KEY, "1"); paintFp(); };
    paintFp();
    const pushBtn = document.getElementById("push-btn");
    if (pushBtn) pushBtn.onclick = () => togglePush(pushBtn.dataset.state !== "on");
    const pushOn = document.getElementById("push-on");
    if (pushOn) pushOn.onclick = () => togglePush(true);
    if (user && window._pushSyncedFor !== user.id) { window._pushSyncedFor = user.id; pushSync().catch(function () {}); }
    paintPush();
    const menuBtn = document.getElementById("menu-btn");
    if (menuBtn) menuBtn.onclick = () => { window._menuOpen = !window._menuOpen; window._termOpen = false; render(); };
    const menuScrim = document.getElementById("menu-scrim");
    if (menuScrim) menuScrim.onclick = () => { window._menuOpen = false; render(); };
    const menuClose = document.getElementById("menu-close");
    if (menuClose) menuClose.onclick = () => { window._menuOpen = false; render(); };
    const termOpen = document.getElementById("term-open");
    if (termOpen) termOpen.onclick = () => { window._termOpen = !window._termOpen; window._menuOpen = false; render(); };
    const logout = document.getElementById("logout");
    if (logout) logout.onclick = () => { signOutNow(); };
    const pwOpen = document.getElementById("pw-open");
    if (pwOpen) pwOpen.onclick = () => { window._menuOpen = false; window._pwView = true; render(); };
    const yearSel = document.getElementById("year-sel");
    const termSel = document.getElementById("term-sel");
    if (yearSel) yearSel.onchange = () => {
      const y = Number(yearSel.value);
      const termNo = Number((document.getElementById("term-sel") || {}).value || activeTerm().term || 1);
      const t = ensureTerm(y, termNo);
      switchTerm(t.id);
    };
    if (termSel) termSel.onchange = () => {
      const y = Number((document.getElementById("year-sel") || {}).value || activeTerm().year);
      const termNo = Number(termSel.value);
      const t = ensureTerm(y, termNo);
      switchTerm(t.id);
    };
    const newTermForm = document.getElementById("new-term-form");
    if (newTermForm) newTermForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!isEditor(user)) return;
      const fd = new FormData(newTermForm);
      const year = Number(fd.get("year"));
      const term = Number(fd.get("term"));
      const id = termId(year, term);
      const existing = (state.terms || []).find((x) => x.id === id);
      if (existing) { switchTerm(id); return; }
      const fresh = { id, year, term, label: termLabel(year, term), weeks: [], planner: [] };
      state.terms = [...(state.terms || []), fresh].sort((a, b) => a.year - b.year || a.term - b.term);
      switchTerm(id);
    });
    const parseTextBtn = document.getElementById("parse-text");
    if (parseTextBtn) parseTextBtn.onclick = () => {
      if (!isEditor(user)) return;
      const raw = (document.getElementById("rota-text") || document.getElementById("scan-text") || {}).value || "";
      const scan = document.getElementById("scan-text");
      const text = raw.trim() || (scan ? scan.value : "");
      const built = parseRotaText(text);
      const note = document.getElementById("parse-note");
      if (!built.length) {
        if (note) note.textContent = "No weeks found. Use: Week 1 | 2027-01-12 | 2027-01-18 then Day: names / Night: names.";
        return;
      }
      state.weeks = built;
      window._weekId = built[0].id;
      if (note) note.textContent = "Loaded " + built.length + " week(s) into " + activeTerm().label + ".";
      persist();
    };
    const scanFile = document.getElementById("scan-file");
    if (scanFile) scanFile.onchange = () => {
      const file = scanFile.files && scanFile.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      window._scanUrl = url;
      const preview = document.getElementById("scan-preview");
      if (preview) {
        preview.hidden = false;
        preview.innerHTML = '<img src="' + url + '" alt="Rota photo">';
      }
      const note = document.getElementById("scan-note");
      if (note) note.textContent = "Photo ready. Tap Read the photo.";
    };
    const scanRead = document.getElementById("scan-read");
    if (scanRead) scanRead.onclick = async () => {
      if (!isEditor(user)) return;
      const note = document.getElementById("scan-note");
      const file = scanFile && scanFile.files && scanFile.files[0];
      if (!file) {
        if (note) note.textContent = "Choose a photo first.";
        return;
      }
      if (note) note.textContent = "Reading the photo… keep the page open.";
      try {
        const Tesseract = await loadTesseract();
        const result = await Tesseract.recognize(file, "eng");
        const text = (result && result.data && result.data.text) || "";
        window._scanText = text;
        const box = document.getElementById("scan-text");
        if (box) box.value = text;
        const rota = document.getElementById("rota-text");
        if (rota && !rota.value.trim()) rota.value = text;
        if (note) note.textContent = "Check the names, then tap Build weeks from text.";
      } catch (err) {
        if (note) note.textContent = "Could not read that photo. Type the rota instead.";
      }
    };
    const printBtn = document.getElementById("print-btn");
    if (printBtn) printBtn.onclick = () => window.print();
    const syncMine = document.getElementById("sync-mine");
    if (syncMine) syncMine.onclick = () => download("DutyDesk-" + user.username + ".ics", buildIcs(user), "text/calendar;charset=utf-8");
    const syncAll = document.getElementById("sync-all");
    if (syncAll) syncAll.onclick = () => download("DutyDesk-planner-" + activeTerm().id + ".ics", buildIcs(user), "text/calendar;charset=utf-8");
    const planForm = document.getElementById("plan-form");
    if (planForm) planForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(planForm);
      state.planner.push({ id: "p" + Date.now(), date: fd.get("date"), title: String(fd.get("title")).trim(), kind: fd.get("kind") });
      state.planner.sort((a, b) => a.date.localeCompare(b.date));
      persist();
    });
    document.querySelectorAll(".rm-plan").forEach((b) => b.onclick = () => {
      state.planner = state.planner.filter((p) => p.id !== b.dataset.id);
      persist();
    });
    const prev = document.getElementById("cal-prev");
    const next = document.getElementById("cal-next");
    if (prev) prev.onclick = () => { const d = new Date(window._cal.y, window._cal.m - 1, 1); window._cal = { y: d.getFullYear(), m: d.getMonth(), sel: window._cal.sel }; render(); };
    if (next) next.onclick = () => { const d = new Date(window._cal.y, window._cal.m + 1, 1); window._cal = { y: d.getFullYear(), m: d.getMonth(), sel: window._cal.sel }; render(); };
    const calToday = document.getElementById("cal-today");
    if (calToday) calToday.onclick = () => {
      const t = todayISO();
      const dt = parseISO(t);
      window._cal = { y: dt.getFullYear(), m: dt.getMonth(), sel: t };
      render();
    };
    document.querySelectorAll(".gday[data-iso]").forEach((b) => {
      b.onclick = () => { window._cal.sel = b.dataset.iso; render(); };
    });
    const weekSel = document.getElementById("week-sel");
    if (weekSel) weekSel.onchange = () => { window._weekId = weekSel.value; render(); };
    const wStart = document.getElementById("w-start");
    const wEnd = document.getElementById("w-end");
    function patchWeek(patch) {
      state.weeks = state.weeks.map((w) => w.id === window._weekId ? { ...w, ...patch, label: (patch.start || w.start) + " – " + (patch.end || w.end) } : w);
      persist();
    }
    if (wStart) wStart.onchange = () => patchWeek({ start: wStart.value });
    if (wEnd) wEnd.onchange = () => patchWeek({ end: wEnd.value });
    document.querySelectorAll(".tog").forEach((b) => b.onclick = () => {
      const w = state.weeks.find((x) => x.id === window._weekId);
      const list = [...w[b.dataset.shift]];
      const i = list.indexOf(b.dataset.name);
      if (i >= 0) list.splice(i, 1); else list.push(b.dataset.name);
      patchWeek({ [b.dataset.shift]: list });
    });
    document.querySelectorAll(".headbtn").forEach((b) => b.onclick = () => {
      const w = state.weeks.find((x) => x.id === window._weekId);
      const list = w[b.dataset.shift].filter((n) => n !== b.dataset.name);
      patchWeek({ [b.dataset.shift]: [b.dataset.name, ...list] });
    });
    const resetLink = document.getElementById("reset-link");
    if (resetLink) resetLink.addEventListener("click", () => { window._scrollReset = true; });
    if (window._scrollReset && document.getElementById("reset-card")) {
      window._scrollReset = false;
      setTimeout(() => { const rc = document.getElementById("reset-card"); if (rc) rc.scrollIntoView({ block: "start" }); }, 60);
    }
    const resetGo = document.getElementById("reset-go");
    if (resetGo) resetGo.onclick = () => { runReset(); };
    const newWeek = document.getElementById("new-week");
    if (newWeek) newWeek.onclick = () => {
      const last = state.weeks[state.weeks.length - 1];
      const start = last ? addDays(last.end, 1) : todayISO();
      const end = addDays(start, 6);
      const id = "w" + Date.now();
      state.weeks.push({ id, week: state.weeks.length + 1, start, end, label: prettyRange(start, end), day: [], night: [] });
      window._weekId = id;
      persist();
    };
    const staffForm = document.getElementById("staff-form");
    if (staffForm) staffForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(staffForm);
      const name = String(fd.get("name")).trim();
      const username = String(fd.get("username") || slugify(name)).toLowerCase();
      if (state.staff.some((s) => s.username === username)) {
        document.getElementById("staff-note").textContent = "That username already exists.";
        return;
      }
      state.staff.push({ id: username, name, username, role: fd.get("role"), title: "Staff" });
      document.getElementById("staff-note").textContent = "Added " + name + " to the list. Now make their sign-in in Supabase.";
      persist();
    });
    document.querySelectorAll(".role-sel").forEach((s) => s.onchange = () => {
      state.staff = state.staff.map((p) => p.id === s.dataset.id ? { ...p, role: s.value } : p);
      persist();
    });
    document.querySelectorAll(".rm-staff").forEach((b) => b.onclick = () => {
      state.staff = state.staff.filter((p) => p.id !== b.dataset.id);
      persist();
    });
    const exp = document.getElementById("export-json");
    if (exp) exp.onclick = () => download("p2-dutodesk-" + activeTerm().id + ".json", JSON.stringify(state, null, 2), "application/json");
    const imp = document.getElementById("import-json");
    if (imp) imp.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { state = saveState(migrate(JSON.parse(reader.result))); syncTermMirror(); render(); } catch (err) { alert("Could not read that file."); }
      };
      reader.readAsText(file);
    };
    const restore = document.getElementById("restore");
    if (restore) restore.onclick = () => {
      if (confirm("Restore the official Term III 2026 rota? Other years and terms stay.")) {
        const fresh = seedTerm();
        const rest = (state.terms || []).filter((x) => x.id !== fresh.id);
        state.terms = [fresh, ...rest].sort((a, b) => a.year - b.year || a.term - b.term);
        state.staff = applyEditorStaff(state.staff && state.staff.length ? state.staff : buildStaff());
        switchTerm(fresh.id);
      }
    };
  }

  // ---------- change / set password ----------
  async function signOutNow() {
    window._menuOpen = false;
    try { await pushLeave(); } catch (e) {}
    const sbo = sbClient();
    if (sbo) { try { await sbo.auth.signOut({ scope: "local" }); } catch (e) {} }
    window._pushSyncedFor = null;
    window._pushState = null;
    window._pwView = false;
    window._fpView = false;
    window._fpAuto = true; // no fingerprint prompt straight after signing out
    user = null;
    sessionStorage.removeItem(SESSION);
    sessionStorage.removeItem(MUST_KEY);
    render();
  }
  function passwordView(forced) {
    const svg = (size, body, extra) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false" ' + (extra || 'fill="currentColor"') + ">" + body + "</svg>";
    const lock = (size) => svg(size, '<path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0z"/><circle cx="12" cy="16" r="1.6" fill="#fff" fill-opacity=".9"/>');
    const eyeOff = svg(22, '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"');
    const field = (label, id, auto, withEye) =>
      '<div class="lg-field"><label class="lg-label" for="' + id + '">' + lock(22) + "<span>" + label + "</span></label>" +
      '<div class="lg-input">' + lock(22) + '<input type="password" id="' + id + '" autocomplete="' + auto + '" autocapitalize="none" spellcheck="false">' +
      (withEye ? '<button type="button" class="lg-eye" id="pw-eye" aria-label="Show passwords"><span class="lg-eye-icon">' + eyeOff + '</span><span class="lg-eye-label">Show</span></button>' : "") +
      "</div></div>";
    return '<div class="lg-shell"><div class="lg-wrap">' +
      '<header class="lg-hero pw-hero"><img class="lg-badge" src="badge.jpg" alt="Plus Two High School badge"><div class="lg-hero-text"><h1>Duty Desk</h1><p class="lg-motto">Combine Efforts</p></div></header>' +
      '<div class="lg-frame"><span class="lg-glow" aria-hidden="true"><i></i></span><form class="lg-card" id="pw-form" novalidate>' +
        '<h2 class="lg-title">' + lock(34) + "<span>" + (forced ? "Set your own password" : "Change password") + "</span></h2>" +
        '<p class="lg-intro">' + (forced
          ? "For your security, choose a password only you know. Nobody, not even the developer, can see it."
          : "Enter your current password, then choose a new one. Other phones signed in as you will need to sign in again.") + "</p>" +
        (forced ? "" : field("Current password", "pw-cur", "current-password", false)) +
        field("New password", "pw-new", "new-password", true) +
        field("Confirm new password", "pw-conf", "new-password", false) +
        '<ul class="pw-rules" id="pw-rules"><li data-r="len">At least 8 characters</li><li data-r="mix">Letters and numbers</li><li data-r="match">Both passwords match</li></ul>' +
        '<p class="error lg-error" id="pw-error" role="alert"></p>' +
        '<button class="lg-submit" type="submit" id="pw-submit"><span class="lg-submit-label">Save new password</span></button>' +
        (forced ? '<button class="lg-theme" type="button" id="pw-signout"><span>Sign out</span></button>' : '<button class="lg-theme" type="button" id="pw-cancel"><span>Cancel</span></button>') +
      "</form></div></div></div>";
  }
  function pwFriendlyError(err) {
    const m = String((err && err.message) || "").toLowerCase();
    if (m.indexOf("different from the old") !== -1 || m.indexOf("same as") !== -1) return "Choose a password you have not used before.";
    if (m.indexOf("weak") !== -1 || m.indexOf("at least") !== -1 || m.indexOf("characters") !== -1) return "That password is too weak. Use at least 8 characters, with letters and numbers.";
    if (m.indexOf("rate") !== -1 || m.indexOf("too many") !== -1) return "Too many tries. Wait a minute and try again.";
    if (m.indexOf("session") !== -1 || m.indexOf("jwt") !== -1 || m.indexOf("not authenticated") !== -1) return "Your sign-in has expired. Sign out and sign in again.";
    return "Could not change the password. Check your data connection and try again.";
  }
  function bindPassword(forced) {
    const form = document.getElementById("pw-form");
    if (!form) return;
    const cur = document.getElementById("pw-cur");
    const nw = document.getElementById("pw-new");
    const cf = document.getElementById("pw-conf");
    const err = document.getElementById("pw-error");
    const btn = document.getElementById("pw-submit");
    const label = btn.querySelector(".lg-submit-label");
    function check() {
      const v = nw.value;
      const ok = { len: v.length >= 8, mix: /[A-Za-z]/.test(v) && /\d/.test(v), match: v.length > 0 && v === cf.value };
      document.querySelectorAll("#pw-rules li").forEach((li) => li.classList.toggle("ok", !!ok[li.dataset.r]));
      return ok;
    }
    nw.oninput = check;
    cf.oninput = check;
    const eye = document.getElementById("pw-eye");
    if (eye) eye.onclick = () => {
      const show = nw.type === "password";
      [cur, nw, cf].forEach((el) => { if (el) el.type = show ? "text" : "password"; });
      eye.querySelector(".lg-eye-label").textContent = show ? "Hide" : "Show";
      eye.setAttribute("aria-label", show ? "Hide passwords" : "Show passwords");
    };
    const cancel = document.getElementById("pw-cancel");
    if (cancel) cancel.onclick = () => { window._pwView = false; render(); };
    const so = document.getElementById("pw-signout");
    if (so) so.onclick = () => { signOutNow(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      const v = nw.value;
      const ok = check();
      if (!forced && !cur.value) { err.textContent = "Enter your current password."; return; }
      if (!ok.len || !ok.mix) { err.textContent = "Use at least 8 characters, with letters and numbers."; return; }
      if (!ok.match) { err.textContent = "The two new passwords do not match."; return; }
      if (v.toLowerCase().indexOf(String(user.username || "").toLowerCase()) !== -1) { err.textContent = "Do not put your username in your password."; return; }
      if (!forced && cur.value === v) { err.textContent = "Choose a password different from your current one."; return; }
      const sb = sbClient();
      if (!sb) { err.textContent = "The school server could not be reached. Check your data connection."; return; }
      btn.disabled = true;
      label.textContent = "Saving…";
      try {
        if (!forced) {
          const cfg = window.P2_SUPABASE || {};
          const email = String(user.username).toLowerCase() + "@" + (cfg.emailDomain || "dutodesk.p2.internal");
          const re = await sb.auth.signInWithPassword({ email, password: cur.value });
          if (re.error) { err.textContent = "Your current password is not correct."; return; }
        }
        const res = await sb.auth.updateUser({ password: v, data: { must_change_password: false } });
        if (res.error) { err.textContent = pwFriendlyError(res.error); return; }
        sessionStorage.removeItem(MUST_KEY);
        window._pwView = false;
        form.innerHTML = '<h2 class="lg-title"><span>Password saved</span></h2><p class="lg-intro lg-ok">Your new password is set. Use it the next time you sign in.</p><button class="lg-submit" type="button" id="pw-done"><span class="lg-submit-label">Continue</span></button>';
        document.getElementById("pw-done").onclick = () => { go("/"); render(); };
      } catch (ex) {
        err.textContent = pwFriendlyError(ex);
      } finally {
        const b2 = document.getElementById("pw-submit");
        if (b2) { b2.disabled = false; const l2 = b2.querySelector(".lg-submit-label"); if (l2) l2.textContent = "Save new password"; }
      }
    };
  }

  function render() {
    if (!user) {
      root.innerHTML = loginView();
      bind();
      return;
    }
    user = state.staff.find((s) => s.id === user.id) || user;
    if (sessionStorage.getItem(MUST_KEY) === "1" || window._pwView) {
      const forced = sessionStorage.getItem(MUST_KEY) === "1";
      root.innerHTML = passwordView(forced);
      bindPassword(forced);
      return;
    }
    if (window._fpView) {
      root.innerHTML = fingerprintView();
      bindFingerprint();
      return;
    }
    const path = route();
    let inner = homeView();
    if (path === "/rota") inner = rotaView();
    else if (path === "/planner") inner = plannerView();
    else if (path === "/calendar") inner = calendarView();
    else if (path === "/log") inner = logView();
    else if (path === "/admin") inner = isEditor(user) ? adminView() : homeView();
    else if (path === "/control") inner = isSuper(user) ? controlView() + resetCardHtml() : homeView();
    root.innerHTML = shell(inner);
    bind();
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window._p2Install = e;
  });
  window.addEventListener("hashchange", function () {
    window._menuOpen = false;
    window._termOpen = false;
    render();
  });
  render();
  if (user) {
    pullCloud().then(function () {
      if (isEditor(user)) return pushCloud();
    }).catch(function () {}).then(function () { render(); });
  }
})();
