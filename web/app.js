// Fygo Cinema admin page. Talks to cinemad on the gateway socket: this page
// is /app/fygo-cinema/, so "api/..." is the backend.
import { TrimApp } from "./web-app.js";

// The SDK is only for theme + language: if it can't start in some client
// (desktop app, mobile webview, ...), the page must still work without it.
let sdk = { isWeb: false, isStandaloneWeb: true, getPlatformConfig: () => Promise.reject(new Error("no sdk")), $on() {} };
try {
  sdk = new TrimApp();
} catch (e) {
  console.warn("TrimApp unavailable:", e);
}
// Outside the fnOS desktop the SDK can't report a language: follow the browser.
let platformConfig = { language: navigator.language || "en-US", theme: null };
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function hostTheme(v) {
  const theme = v && typeof v === "object" && "theme" in v ? v.theme : v;
  const s = String(theme || "").toLowerCase();
  return s === "dark" || s === "light" ? s : null;
}
function resolvedTheme() {
  return hostTheme(platformConfig.theme) || (darkQuery && darkQuery.matches ? "dark" : "light");
}
document.documentElement.dataset.theme = resolvedTheme();

const state = { language: "en-US", version: "", status: null };

const I18N = {
  "zh-CN": {
    appTitle: "Fygo Cinema",
    loading: "正在加载...",
    refresh: "刷新",
    tvApp: "电视应用",
    tvAppHint: "在电视上用遥控器看飞牛影视。插上电视时自动启动，拔下时停止。",
    status: "状态",
    tv: "电视",
    signIn: "登录",
    version: "版本",
    running: "运行中",
    starting: "启动中",
    off: "已关闭",
    needsAccount: "需要账户",
    noTv: "未连接电视",
    unplugged: "电视已拔下",
    noCompositor: "显示服务未运行",
    signedIn: "已登录",
    signingIn: "正在登录…",
    retrying: "正在重试…",
    signInFailed: "失败：{msg}",
    account: "账户",
    accountHint: "电视用来登录的飞牛影视账户。加密保存在这台 NAS 上，保存后不再显示密码。",
    noAccount: "未设置账户",
    noAccountSub: "输入账户后电视应用才能启动。",
    accountSub: "电视以此账户登录。输入新的用户名和密码可替换它。",
    username: "用户名",
    password: "密码",
    save: "保存",
    remove: "移除",
    accountSaved: "账户已保存，电视应用正在重新登录",
    accountRemoved: "账户已移除",
    removeTitle: "移除账户？",
    removeBody: "电视应用将停止，直到重新输入账户。",
    needBoth: "请输入用户名和密码",
    screen: "屏幕",
    tvScreen: "电视屏幕",
    tvScreenHint: "自动：选择插着电视、且未被其他应用使用的显示接口。更改会重启显示服务：其他屏幕会黑几秒。",
    automatic: "自动",
    pageSize: "页面大小",
    pageSizeHint: "自动：高于 1080p 的屏幕 200%，1080p 及以下 150%。应用时电视应用会重启。",
    zoomAuto: "自动（{p}%）",
    automaticTv: "自动（{tv}）",
    automaticNone: "自动（未检测到电视）",
    connected: "已连接",
    notConnected: "未连接",
    usedBy: "{app} 在使用",
    builtIn: "内置屏幕",
    screenTitle: "更换电视屏幕？",
    screenBody: "显示服务会重启：所有屏幕会黑几秒，电视应用和其他应用随后重新出现。",
    change: "更换",
    sound: "声音",
    output: "输出",
    outputHint: "自动：从电视自带的扬声器播放（HDMI 声音）。",
    automaticSound: "自动（电视扬声器）",
    automaticSoundTv: "自动（{name}）",
    systemDefault: "系统默认输出",
    volume: "音量",
    volumeHint: "上面所选输出的音量。遥控器的音量键也会改变它。",
    mute: "静音",
    actions: "操作",
    restartApp: "重启电视应用",
    restartAppHint: "电视应用卡住或显示异常时使用；它会自动重新登录。",
    restart: "重启",
    restartTitle: "重启电视应用？",
    restartBody: "电视会黑屏几秒后重新显示，正在播放的视频会中断。",
    restarting: "正在重启电视应用…",
    offTitle: "关闭电视应用？",
    offBody: "电视应用将停止，插上电视也不会启动，直到在这里重新开启。",
    turnOff: "关闭",
    appOn: "电视应用已开启",
    appOff: "电视应用已关闭",
    summaryRunning: "正在 {tv} 上运行",
    summaryWaiting: "等待电视",
    summaryStarting: "正在 {tv} 上启动",
    summaryOff: "电视应用已关闭",
    summaryNeedsAccount: "请在下方输入账户（电视上正显示操作说明）",
    saved: "已保存",
    cancel: "取消",
    confirm: "确定",
    forbidden: "需要管理员账户",
    failed: "操作失败：{msg}",
  },
  "en-US": {
    appTitle: "Fygo Cinema",
    loading: "Loading...",
    refresh: "Refresh",
    tvApp: "TV app",
    tvAppHint: "Fygo TV on the TV, driven by a remote. It starts when the TV is plugged in and stops when it is unplugged.",
    status: "Status",
    tv: "TV",
    signIn: "Sign-in",
    version: "Version",
    running: "Running",
    starting: "Starting",
    off: "Off",
    needsAccount: "Needs an account",
    noTv: "No TV connected",
    unplugged: "TV unplugged",
    noCompositor: "Display server not running",
    signedIn: "Signed in",
    signingIn: "Signing in…",
    retrying: "Retrying…",
    signInFailed: "Failed: {msg}",
    account: "Account",
    accountHint: "The Fygo TV account the TV signs in with. It is stored encrypted on this NAS and never shown again.",
    noAccount: "No account",
    noAccountSub: "The TV app starts once an account is entered.",
    accountSub: "The TV signs in as this user. Enter another username and password to replace it.",
    username: "Username",
    password: "Password",
    save: "Save",
    remove: "Remove",
    accountSaved: "Account saved; the TV app is signing in again",
    accountRemoved: "Account removed",
    removeTitle: "Remove the account?",
    removeBody: "The TV app stops until an account is entered again.",
    needBoth: "Enter a username and a password",
    screen: "Screen",
    tvScreen: "TV screen",
    tvScreenHint: "Automatic takes the display that has a TV plugged in and is not used by another app. Changing it restarts the display server: other screens go dark for a few seconds.",
    automatic: "Automatic",
    pageSize: "Page size",
    pageSizeHint: "Automatic: 200 % above 1080p, 150 % at 1080p and below. The TV app restarts to apply it.",
    zoomAuto: "Automatic ({p}%)",
    automaticTv: "Automatic ({tv})",
    automaticNone: "Automatic (no TV found)",
    connected: "connected",
    notConnected: "not connected",
    usedBy: "used by {app}",
    builtIn: "built-in screen",
    screenTitle: "Change the TV screen?",
    screenBody: "The display server restarts: every screen goes dark for a few seconds, then the TV app and the other apps come back.",
    change: "Change",
    sound: "Sound",
    output: "Output",
    outputHint: "Automatic plays through the TV's own speakers (its HDMI sound).",
    automaticSound: "Automatic (TV speakers)",
    automaticSoundTv: "Automatic ({name})",
    systemDefault: "System default output",
    volume: "Volume",
    volumeHint: "Of the output above. The remote's volume keys change it too.",
    mute: "Mute",
    actions: "Actions",
    restartApp: "Restart TV app",
    restartAppHint: "For a frozen or misbehaving TV app; it signs in again by itself.",
    restart: "Restart",
    restartTitle: "Restart the TV app?",
    restartBody: "The TV goes dark for a few seconds and comes back; a playing video stops.",
    restarting: "Restarting the TV app…",
    offTitle: "Turn the TV app off?",
    offBody: "The TV app stops and does not start when the TV is plugged in, until you turn it on here again.",
    turnOff: "Turn off",
    appOn: "TV app on",
    appOff: "TV app off",
    summaryRunning: "Running on {tv}",
    summaryWaiting: "Waiting for a TV",
    summaryStarting: "Starting on {tv}",
    summaryOff: "TV app off",
    summaryNeedsAccount: "Enter an account below (the TV shows how)",
    saved: "Saved",
    cancel: "Cancel",
    confirm: "OK",
    forbidden: "An administrator account is required",
    failed: "Failed: {msg}",
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  summary: $("summary"),
  refresh: $("refreshBtn"),
  enabled: $("enabledSwitch"),
  statStatus: $("statStatus"),
  statTv: $("statTv"),
  statSignIn: $("statSignIn"),
  statVersion: $("statVersion"),
  accountLabel: $("accountLabel"),
  accountSub: $("accountSub"),
  removeAccount: $("removeAccountBtn"),
  accountForm: $("accountForm"),
  user: $("userInput"),
  pass: $("passInput"),
  saveAccount: $("saveAccountBtn"),
  screen: $("screenSel"),
  zoom: $("zoomSel"),
  audio: $("audioSel"),
  volume: $("volumeRange"),
  volumeValue: $("volumeValue"),
  mute: $("muteSwitch"),
  restart: $("restartBtn"),
  modal: $("modal"),
  modalTitle: $("modalTitle"),
  modalBody: $("modalBody"),
  modalOk: $("modalOk"),
  modalCancel: $("modalCancel"),
  toast: $("toast"),
};

function t(key, params = {}) {
  const text = (I18N[state.language] || I18N["en-US"])[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

// ---- platform (language + theme from the fnOS desktop) ----
function applyPreferences() {
  const lang = String(platformConfig.language || "").replace("_", "-");
  state.language = lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  document.documentElement.lang = state.language;
  document.documentElement.dataset.theme = resolvedTheme();
  document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((n) => (n.placeholder = t(n.dataset.i18nPh)));
  document.querySelectorAll("[data-i18n-title]").forEach((n) => (n.title = t(n.dataset.i18nTitle)));
  render();
}

// ---- backend ----
async function api(path, method = "GET", body) {
  const res = await fetch(`api/${path}`, {
    method,
    cache: "no-store",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 403) throw new Error(t("forbidden"));
  if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
  const r = await res.json();
  state.version = r.version;
  state.status = r.status;
  return r;
}

async function load() {
  try {
    await api("status");
  } catch (e) {
    state.status = null;
    els.summary.textContent = e.message;
  }
  render();
}

// ---- render ----
const tvName = (s) => (s ? s.monitor || s.name : "");

function statusKey(s) {
  if (!s.settings.enabled) return "off";
  switch (s.idle_reason) {
    case "no-screen": return "noTv";
    case "disconnected": return "unplugged";
    case "no-compositor": return "noCompositor";
    // (without an account the TV app runs and shows how to add one)
    default: return !s.account ? "needsAccount" : s.kiosk_active ? "running" : "starting";
  }
}

function render() {
  const s = state.status;
  if (!s) return;
  const key = statusKey(s);
  const tv = s.screen && s.screen.connected ? s.screen : null;
  els.summary.textContent =
    key === "running" ? t("summaryRunning", { tv: tvName(tv) || "-" })
      : key === "starting" ? t("summaryStarting", { tv: tvName(tv) || "-" })
      : key === "off" ? t("summaryOff")
        : key === "needsAccount" ? t("summaryNeedsAccount")
          : t("summaryWaiting");
  els.enabled.disabled = false;
  els.enabled.checked = s.settings.enabled;
  els.statStatus.textContent = t(key);
  els.statStatus.classList.toggle("ok", key === "running");
  els.statTv.textContent = tv ? [tvName(tv), tv.mode, inches(tv)].filter(Boolean).join(" · ") : "-";
  renderSignIn(s);
  els.statVersion.textContent = state.version || "-";

  // account
  const acct = s.account;
  els.accountLabel.textContent = acct ? acct.username : t("noAccount");
  els.accountSub.textContent = t(acct ? "accountSub" : "noAccountSub");
  els.removeAccount.hidden = !acct;

  renderScreens(s);
  renderZoom(s);
  renderSinks(s);
  const lv = s.level || {};
  if (document.activeElement !== els.volume) els.volume.value = String(lv.volume ?? 0);
  els.volumeValue.textContent = lv.volume == null ? "-" : String(lv.volume);
  els.volume.disabled = lv.volume == null;
  els.mute.checked = !!lv.muted;
  els.mute.disabled = lv.volume == null;
  els.restart.disabled = !s.kiosk_active;
}

function renderSignIn(s) {
  const k = s.kiosk_state;
  let text = "-";
  let ok = false;
  let warn = false;
  if (s.kiosk_active && k) {
    if (k.login === "ok") { text = t("signedIn"); ok = true; }
    else if (k.login === "signing-in") text = t("signingIn");
    else if (k.login === "retrying") text = t("retrying");
    else if (k.login === "failed") { text = t("signInFailed", { msg: k.message || "" }); warn = true; }
  }
  els.statSignIn.textContent = text;
  els.statSignIn.classList.toggle("ok", ok);
  els.statSignIn.classList.toggle("warn", warn);
}

// Selects are rebuilt only when their options change, and left alone while
// open, so the periodic refresh never closes one under the cursor.
function fill(sel, options, value) {
  if (document.activeElement === sel) return;
  const key = state.language + "|" + options.map((o) => `${o.value}=${o.label}`).join(",");
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.innerHTML = "";
    for (const o of options) {
      const opt = new Option(o.label, o.value);
      opt.disabled = !!o.disabled;
      sel.add(opt);
    }
  }
  sel.value = value;
  sel.disabled = options.length < 2;
}

function renderScreens(s) {
  const auto = s.settings.screen === "auto";
  const autoTv = auto && s.screen ? s.screen : (s.screens || []).find((x) => x.connected && x.monitor && !x.internal && !x.claimed_by);
  const options = [{ value: "auto", label: autoTv ? t("automaticTv", { tv: `${tvName(autoTv)}, ${autoTv.name}` }) : t("automaticNone") }];
  for (const x of s.screens || []) {
    const notes = [x.connected ? (x.monitor || t("connected")) : t("notConnected")];
    if (x.internal) notes.push(t("builtIn"));
    if (x.claimed_by) notes.push(t("usedBy", { app: x.claimed_by }));
    options.push({ value: x.name, label: `${x.name} — ${notes.join(", ")}`, disabled: !!x.claimed_by && x.name !== s.settings.screen });
  }
  fill(els.screen, options, s.settings.screen);
}

function inches(sc) {
  if (!sc.size_mm) return "";
  const [w, h] = sc.size_mm;
  return `${Math.round(Math.hypot(w, h) / 25.4)}″`;
}

const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300];

function renderZoom(s) {
  const options = [{ value: "auto", label: t("zoomAuto", { p: Math.round((s.zoom_auto || 1) * 100) }) }];
  for (const z of ZOOMS) options.push({ value: String(z), label: `${z}%` });
  if (!options.some((o) => o.value === s.settings.zoom)) options.push({ value: s.settings.zoom, label: `${s.settings.zoom}%` });
  fill(els.zoom, options, s.settings.zoom);
}

function renderSinks(s) {
  const tvSink = s.settings.audio === "auto" ? s.sink : null;
  const options = [
    { value: "auto", label: tvSink ? t("automaticSoundTv", { name: tvSink.nick || tvSink.description }) : t("automaticSound") },
    { value: "default", label: t("systemDefault") },
  ];
  for (const k of s.sinks || []) options.push({ value: k.name, label: k.description });
  // a chosen output that is gone (unplugged USB speaker) still shows
  if (!options.some((o) => o.value === s.settings.audio)) options.push({ value: s.settings.audio, label: s.settings.audio, disabled: true });
  fill(els.audio, options, s.settings.audio);
}

// ---- dialog + toast ----
function confirmDialog(title, body, okText) {
  return new Promise((resolve) => {
    els.modalTitle.textContent = title;
    els.modalBody.textContent = body;
    els.modalOk.textContent = okText || t("confirm");
    els.modal.classList.remove("hidden");
    const done = (v) => {
      els.modal.classList.add("hidden");
      els.modalOk.onclick = els.modalCancel.onclick = null;
      resolve(v);
    };
    els.modalOk.onclick = () => done(true);
    els.modalCancel.onclick = () => done(false);
  });
}

let toastTimer = 0;
function showToast(msg, error = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("error", error);
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) showToast(okMsg);
  } catch (e) {
    showToast(t("failed", { msg: e.message }), true);
  }
  render();
}

// ---- actions ----
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

els.refresh.addEventListener("click", load);

els.enabled.addEventListener("change", async () => {
  const want = els.enabled.checked;
  if (!want && !(await confirmDialog(t("offTitle"), t("offBody"), t("turnOff")))) {
    els.enabled.checked = true;
    return;
  }
  els.enabled.disabled = true;
  await run(() => api("enabled", "PUT", { enabled: want }), t(want ? "appOn" : "appOff"));
});

els.accountForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = els.user.value.trim();
  const password = els.pass.value;
  if (!username || !password) {
    showToast(t("needBoth"), true);
    return;
  }
  els.saveAccount.disabled = true;
  await run(async () => {
    await api("account", "PUT", { username, password });
    els.user.value = "";
    els.pass.value = "";
  }, t("accountSaved"));
  els.saveAccount.disabled = false;
});

els.removeAccount.addEventListener("click", async () => {
  if (!(await confirmDialog(t("removeTitle"), t("removeBody"), t("remove")))) return;
  await run(() => api("account", "DELETE"), t("accountRemoved"));
});

els.screen.addEventListener("change", async () => {
  const value = els.screen.value;
  if (!(await confirmDialog(t("screenTitle"), t("screenBody"), t("change")))) {
    els.screen.dataset.key = "";
    render();
    return;
  }
  await run(() => api("screen", "PUT", { value }), t("saved"));
});

els.zoom.addEventListener("change", () => {
  run(() => api("zoom", "PUT", { value: els.zoom.value }), t("saved"));
});

els.audio.addEventListener("change", () => {
  run(() => api("audio", "PUT", { value: els.audio.value }), t("saved"));
});

els.volume.addEventListener("input", () => (els.volumeValue.textContent = els.volume.value));
els.volume.addEventListener("change", () => {
  run(() => api("volume", "PUT", { volume: Number(els.volume.value) }));
});

els.mute.addEventListener("change", () => {
  run(() => api("volume", "PUT", { muted: els.mute.checked }));
});

els.restart.addEventListener("click", async () => {
  if (!(await confirmDialog(t("restartTitle"), t("restartBody"), t("restart")))) return;
  await run(() => api("kiosk/restart", "POST"), t("restarting"));
});

// ---- start ----
// The page must not depend on the SDK answering: render and load first, then
// pick up the fnOS language/theme when (if) the desktop replies.
async function initPlatform() {
  try {
    platformConfig = { ...platformConfig, ...(await withTimeout(sdk.getPlatformConfig(), 2000)) };
  } catch {
    // opened outside the fnOS desktop, or no reply: browser language + dark mode
  }
  applyPreferences();
  darkQuery?.addEventListener?.("change", () => { if (!hostTheme(platformConfig.theme)) applyPreferences(); });
  if (sdk.isWeb === true && sdk.isStandaloneWeb === false) {
    try {
      sdk.$on("os/theme", (theme) => {
        platformConfig = { ...platformConfig, theme };
        applyPreferences();
      });
      sdk.$on("os/language", (language) => {
        platformConfig = { ...platformConfig, language };
        applyPreferences();
      });
    } catch {
      // no live updates; the initial values still apply
    }
  }
}

applyPreferences();
load();
initPlatform();
setInterval(() => {
  if (els.modal.classList.contains("hidden")) load();
}, 4000);
