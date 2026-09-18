const state = { key: null, entries: [], salt: null, etag: "", scanStream: null, cropImage: null, cropRect: null, cropPoint: null, showOnlyOtp: true, showOnlyPassword: false };
const $ = (id) => document.getElementById(id);

function bytesToB64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function b64ToBytes(value) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function encrypt(entries) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.key, new TextEncoder().encode(JSON.stringify(entries)));
  return { iv: bytesToB64(iv), data: bytesToB64(data) };
}
async function decrypt(record) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(record.iv) }, state.key, b64ToBytes(record.data));
  return JSON.parse(new TextDecoder().decode(data));
}
async function decryptWithKey(record, key) { const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(record.iv) }, key, b64ToBytes(record.data)); return JSON.parse(new TextDecoder().decode(data)); }
async function encryptWithKey(entries, key) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(entries))); return { iv: bytesToB64(iv), data: bytesToB64(data) }; }
let autoSyncTimer = null;
function queueAutoSync() { clearTimeout(autoSyncTimer); autoSyncTimer = setTimeout(() => chrome.runtime.sendMessage({ type: "auto-sync-webdav" }).catch(() => {}), 1200); }
async function saveVault() { await chrome.storage.local.set({ vault: await encrypt(state.entries) }); queueAutoSync(); }
function webdavId(suffix, field) { return suffix ? `webdav2${field}` : `webdav${field}`; }
function readWebdavConfig(suffix = "") { return { url: $(webdavId(suffix, "Url")).value.trim(), username: $(webdavId(suffix, "Username")).value, password: $(webdavId(suffix, "Password")).value }; }
function writeWebdavConfig(suffix, config = {}) { $(webdavId(suffix, "Url")).value = config.url || ""; $(webdavId(suffix, "Username")).value = config.username || ""; $(webdavId(suffix, "Password")).value = config.password || ""; }
async function saveWebdavConfig() { const config = { primary: readWebdavConfig(), secondary: readWebdavConfig("2") }; await chrome.storage.local.set({ webdavConfig: await encryptWithKey(config, state.key) }); $("syncMessage").textContent = "两个 WebDAV 配置已加密保存"; }
async function loadWebdavConfig() { const stored = await chrome.storage.local.get("webdavConfig"); if (!stored.webdavConfig || !state.key) return; try { const config = await decryptWithKey(stored.webdavConfig, state.key); if (config.url) { writeWebdavConfig("", config); return; } writeWebdavConfig("", config.primary); writeWebdavConfig("2", config.secondary); } catch { $("syncMessage").textContent = "检测到 WebDAV 配置，但无法解密；请确认主密码未更换。"; } }
async function migrateWebdavConfig(oldKey, newKey) { const stored = await chrome.storage.local.get("webdavConfig"); if (!stored.webdavConfig) return; const config = await decryptWithKey(stored.webdavConfig, oldKey); await chrome.storage.local.set({ webdavConfig: await encryptWithKey(config, newKey) }); }
async function changeMasterPassword() { const current = $("currentMasterPassword").value, next = $("newMasterPassword").value, confirm = $("confirmMasterPassword").value, message = $("masterPasswordMessage"); message.textContent = ""; if (next.length < 8) { message.textContent = "新主密码至少 8 位"; return; } if (next !== confirm) { message.textContent = "两次新主密码不一致"; return; } try { const stored = await chrome.storage.local.get(["salt", "vault"]); const oldKey = await deriveKey(current, b64ToBytes(stored.salt)); await decryptWithKey(stored.vault, oldKey); const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await deriveKey(next, salt); await migrateWebdavConfig(oldKey, key); const encrypted = await encryptWithKey(state.entries, key); await chrome.storage.local.set({ salt: bytesToB64(salt), vault: encrypted }); state.salt = salt; state.key = key; await saveSessionKey(); $("currentMasterPassword").value = ""; $("newMasterPassword").value = ""; $("confirmMasterPassword").value = ""; message.textContent = "主密码已修改，WebDAV 配置已迁移"; } catch (error) { message.textContent = error.message?.includes("OperationError") ? "当前主密码不正确，或 WebDAV 配置无法迁移；主密码未修改" : "当前主密码不正确或保险库损坏"; } }
async function saveSessionKey() { const raw = await crypto.subtle.exportKey("raw", state.key); await chrome.storage.session.set({ sessionKey: bytesToB64(raw) }); }
async function restoreSession() {
  const stored = await chrome.storage.local.get(["salt", "vault"]), session = await chrome.storage.session.get("sessionKey");
  if (!stored.vault || !stored.salt || !session.sessionKey) return false;
  try { state.salt = b64ToBytes(stored.salt); state.key = await crypto.subtle.importKey("raw", b64ToBytes(session.sessionKey), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]); state.entries = await decrypt(stored.vault); showVault(); return true; } catch { await chrome.storage.session.remove("sessionKey"); return false; }
}
async function vaultPackage() { const stored = await chrome.storage.local.get(["salt", "vault"]); return { format: "local-password-otp-vault", version: 1, exportedAt: new Date().toISOString(), salt: stored.salt, vault: stored.vault }; }
async function exportVault() { const blob = new Blob([JSON.stringify(await vaultPackage(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); chrome.downloads.download({ url, filename: `password-otp-vault-${new Date().toISOString().slice(0, 10)}.json`, saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(url), 10000)); }
async function importVault(file) { const data = JSON.parse(await file.text()); if (data.encrypted === true) throw new Error("Bitwarden 加密导出需要先在 Bitwarden 中导出为未加密 JSON"); if (Array.isArray(data.items) && data.encrypted === false) { if (!state.key) throw new Error("请先解锁后再导入 Bitwarden 数据"); let added = 0; for (const item of data.items) { if (item.type !== 1 || !item.login) continue; const rawOtp = String(item.login.totp || ""); let otp = "", algorithm = "SHA1", digits = 6, period = 30; if (rawOtp) { try { const parsed = rawOtp.toLowerCase().startsWith("otpauth://") ? parseOtpInput(rawOtp) : { secret: normalizeBase32(rawOtp) }; otp = parsed.secret; algorithm = parsed.algorithm || algorithm; digits = parsed.digits || digits; period = parsed.period || period; } catch {} } const entry = { id: crypto.randomUUID(), name: item.name || "未命名", username: item.login.username || "", password: item.login.password || "", notes: item.notes || "", otp, algorithm, digits, period }; if (!state.entries.some((existing) => existing.name === entry.name && existing.username === entry.username && existing.password === entry.password)) { state.entries.unshift(entry); added++; } } await saveVault(); closeSettings(); render(); alert(`Bitwarden 导入完成：新增 ${added} 项`); return; } if (data.format !== "local-password-otp-vault" || !data.salt || !data.vault) throw new Error("不是本扩展的有效导出文件或 Bitwarden 未加密 JSON"); await chrome.storage.local.set({ salt: data.salt, vault: data.vault }); await chrome.storage.session.remove("sessionKey"); lock(); alert("导入成功，请使用导出时的主密码解锁"); }
async function syncWebdavTarget(target, packageData) {
  const remote = await chrome.runtime.sendMessage({ type: "webdav", method: "get", url: target.url, username: target.username, password: target.password });
  if (remote?.result?.data) {
    if (remote.result.data.salt !== bytesToB64(state.salt)) throw new Error("远程保险库主密码不同");
    const remoteEntries = await decryptWithKey(remote.result.data.vault, state.key);
    const merged = new Map([...state.entries, ...remoteEntries].map((entry) => [entry.id, entry]));
    state.entries = [...merged.values()];
    const encrypted = await encryptWithKey(state.entries, state.key);
    await chrome.storage.local.set({ salt: bytesToB64(state.salt), vault: encrypted });
    await saveSessionKey();
    packageData = await vaultPackage();
  }
  await putWebdav(target.url, target.username, target.password, packageData, remote?.result?.etag || "");
}
async function syncWebdav() {
  const targets = [
    { label: "主库", ...readWebdavConfig() },
    { label: "备用库", ...readWebdavConfig("2") }
  ].filter((target) => target.url);
  if (!targets.length) { $("syncMessage").textContent = "请至少填写一个 WebDAV 地址"; return; }
  $("syncMessage").textContent = "正在同步...";
  let packageData = await vaultPackage();
  const results = [];
  for (const target of targets) {
    try { await syncWebdavTarget(target, packageData); packageData = await vaultPackage(); results.push(`${target.label}成功`); }
    catch (error) { results.push(`${target.label}失败：${error.message || "连接失败"}`); }
  }
  render(); $("syncMessage").textContent = `${results.join("；")}，共 ${state.entries.length} 项`;
}
async function putWebdav(url, username, password, data, etag = "") { const response = await chrome.runtime.sendMessage({ type: "webdav", method: "put", url, username, password, data, etag }); if (!response?.ok) throw new Error(response?.error || "WebDAV 写入失败"); }

async function startScanner() {
  $("scanMessage").textContent = "正在启动摄像头...";
  if (!window.jsQR) { $("scanMessage").textContent = "二维码解码器未加载，请重新加载扩展。"; return; }
  try { state.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }); $("scanVideo").srcObject = state.scanStream; await $("scanVideo").play(); scanVideoFrames(); } catch { $("scanMessage").textContent = "摄像头不可用，请选择二维码图片。"; }
}
function stopScanner() { state.scanStream?.getTracks().forEach((track) => track.stop()); state.scanStream = null; $("scanVideo").srcObject = null; }
async function captureCurrentTabImage() { const session = await chrome.storage.session.get("scanTabId"); if (!session.scanTabId) throw new Error("没有记录到目标标签页，请返回首页后重新进入设置"); const response = await chrome.runtime.sendMessage({ type: "capture-tab", tabId: session.scanTabId }); if (!response?.ok) throw new Error(response.error || "无法捕获当前标签页"); const blob = await (await fetch(response.dataUrl)).blob(); return createImageBitmap(blob); }
function drawCropCanvas() { const canvas = $("scanCanvas"), image = state.cropImage; if (!image) return; canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); if (!state.cropRect) return; const { x, y, width, height } = state.cropRect; context.fillStyle = "rgba(0,0,0,.45)"; context.fillRect(0, 0, canvas.width, canvas.height); context.clearRect(x, y, width, height); context.drawImage(image, x, y, width, height, x, y, width, height); context.strokeStyle = "#42a5f5"; context.lineWidth = Math.max(3, canvas.width / 300); context.strokeRect(x, y, width, height); }
function canvasPoint(event) { const canvas = $("scanCanvas"), rect = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) }; }
async function openRegionScanner() { if (!window.jsQR) throw new Error("二维码解码器未加载，请重新加载扩展"); $("scanMessage").textContent = "正在截取当前标签页，请拖动框选一个二维码"; state.cropImage = await captureCurrentTabImage(); state.cropRect = null; $("scanRegion").classList.remove("hidden"); drawCropCanvas(); }
function bindCropCanvas() { const canvas = $("scanCanvas"); canvas.onpointerdown = (event) => { canvas.setPointerCapture(event.pointerId); state.cropPoint = canvasPoint(event); state.cropRect = { x: state.cropPoint.x, y: state.cropPoint.y, width: 0, height: 0 }; drawCropCanvas(); }; canvas.onpointermove = (event) => { if (!state.cropPoint) return; const point = canvasPoint(event); state.cropRect = { x: Math.min(state.cropPoint.x, point.x), y: Math.min(state.cropPoint.y, point.y), width: Math.abs(point.x - state.cropPoint.x), height: Math.abs(point.y - state.cropPoint.y) }; drawCropCanvas(); }; canvas.onpointerup = () => { state.cropPoint = null; }; }
function closeRegionScanner() { $("scanRegion").classList.add("hidden"); state.cropImage = null; state.cropRect = null; state.cropPoint = null; }
async function scanSelectedRegion() { const image = state.cropImage, rect = state.cropRect; if (!image || !rect || rect.width < 8 || rect.height < 8) throw new Error("请先拖动框选二维码区域"); const canvas = document.createElement("canvas"); canvas.width = Math.round(rect.width); canvas.height = Math.round(rect.height); const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height); const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" }); if (!result?.data) throw new Error("选区内没有识别到二维码"); closeRegionScanner(); await addAuthenticatorUri(result.data); }
function scannedEntry(uri) { const parsed = parseOtpInput(uri); if (!parsed.secret) throw new Error("二维码中没有有效 OTP 密钥"); return { name: parsed.label || parsed.issuer || "未命名", username: parsed.label?.includes(":") ? parsed.label.slice(parsed.label.indexOf(":") + 1) : "", otp: parsed.secret, algorithm: parsed.algorithm || "SHA1", digits: parsed.digits || 6, period: parsed.period || 30 }; }
function scanVideoFrames() { if (!state.scanStream) return; const video = $("scanVideo"), canvas = document.createElement("canvas"); canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480; const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(video, 0, 0, canvas.width, canvas.height); const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" }); if (result?.data) { stopScanner(); openEditor(scannedEntry(result.data)); $("scanMessage").textContent = "已读取二维码，请确认并保存"; return; } requestAnimationFrame(scanVideoFrames); }
async function scanImage(file) { if (!window.jsQR) throw new Error("二维码解码器未加载，请重新加载扩展"); const bitmap = await createImageBitmap(file); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" }); if (!result?.data) throw new Error("没有识别到二维码"); openEditor(scannedEntry(result.data)); stopScanner(); }
async function scanCurrentTab() { const session = await chrome.storage.session.get("scanTabId"); if (!session.scanTabId) throw new Error("没有记录到目标标签页，请返回首页后重新进入设置"); const response = await chrome.runtime.sendMessage({ type: "capture-tab", tabId: session.scanTabId }); if (!response?.ok) throw new Error(response?.error || "无法捕获当前标签页"); const blob = await (await fetch(response.dataUrl)).blob(); const bitmap = await createImageBitmap(blob); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" }); if (!result?.data) throw new Error("当前标签页没有识别到二维码"); await addAuthenticatorUri(result.data); }
async function addAuthenticatorUri(uri) { const item = parseOtpInput(uri); if (!item.secret) throw new Error("二维码中没有有效 OTP 密钥"); const name = item.label || item.issuer || "未命名"; const exists = state.entries.some((entry) => entry.otp === item.secret && entry.name === name); if (!exists) { state.entries.unshift({ id: crypto.randomUUID(), name, username: item.label?.includes(":") ? item.label.slice(item.label.indexOf(":") + 1) : "", password: "", otp: item.secret, algorithm: item.algorithm || "SHA1", digits: item.digits || 6, period: item.period || 30 }); await saveVault(); } $("scanMessage").textContent = exists ? "该 OTP 已存在" : `已添加：${name}`; }
async function importAuthenticatorText(file) { const lines = (await file.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); let added = 0; for (const line of lines) { try { const item = parseOtpInput(line); const name = item.label || item.issuer || "未命名"; if (!item.secret || state.entries.some((entry) => entry.otp === item.secret && entry.name === name)) continue; state.entries.unshift({ id: crypto.randomUUID(), name, username: item.label?.includes(":") ? item.label.slice(item.label.indexOf(":") + 1) : "", password: "", otp: item.secret, algorithm: item.algorithm || "SHA1", digits: item.digits || 6, period: item.period || 30 }); added++; } catch {} } await saveVault(); $("syncMessage").textContent = `Authenticator 导入完成：新增 ${added} 项，共读取 ${lines.length} 行`; }

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";
  const values = crypto.getRandomValues(new Uint32Array(20));
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}
async function copyText(value) {
  const text = String(value || "");
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); if (!document.execCommand("copy")) throw new Error("剪贴板写入失败"); area.remove();
}
function parseOtpInput(value) {
  const raw = value.trim();
  if (!raw.toLowerCase().startsWith("otpauth://")) return { secret: normalizeBase32(raw) };
  const url = new URL(raw);
  const params = url.searchParams;
  return {
    secret: normalizeBase32(params.get("secret") || ""),
    algorithm: String(params.get("algorithm") || "SHA1").toUpperCase().replace("-", ""),
    digits: Number(params.get("digits") || 6),
    period: Number(params.get("period") || 30),
    issuer: params.get("issuer") || "",
    label: decodeURIComponent(url.pathname.slice(1))
  };
}
function normalizeBase32(value) { return String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, ""); }
function base32Bytes(value) {
  let bits = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  for (const char of normalizeBase32(value)) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
}
async function totp(entry) {
  const period = Number(entry.period || 30), digits = Number(entry.digits || 6);
  const counter = Math.floor(Date.now() / 1000 / period);
  const msg = new ArrayBuffer(8), view = new DataView(msg); view.setUint32(0, Math.floor(counter / 0x100000000)); view.setUint32(4, counter >>> 0);
  const algorithm = String(entry.algorithm || "SHA1").toUpperCase().replace("-", "");
  const hashName = algorithm === "SHA256" ? "SHA-256" : algorithm === "SHA512" ? "SHA-512" : "SHA-1";
  const key = await crypto.subtle.importKey("raw", base32Bytes(entry.otp), { name: "HMAC", hash: hashName }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = hash[hash.length - 1] & 15;
  const code = ((hash[offset] & 127) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(code % (10 ** digits)).padStart(digits, "0");
}
async function loadFilterSetting() { const saved = await chrome.storage.local.get(["showOnlyOtp", "showOnlyPassword"]); state.showOnlyOtp = saved.showOnlyOtp !== false; state.showOnlyPassword = saved.showOnlyPassword === true; }
function showVault() { $("unlockView").classList.add("hidden"); $("settingsView").classList.add("hidden"); $("editView").classList.add("hidden"); $("appHeader").classList.remove("hidden"); $("vaultView").classList.remove("hidden"); $("lockButton").classList.remove("hidden"); $("settingsButton").classList.remove("hidden"); loadFilterSetting().then(() => { $("homeOtpFilter").checked = state.showOnlyOtp; render(); }); }
async function openSettings() { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); await chrome.storage.session.set({ scanTabId: tabs[0]?.id || null }); $("appHeader").classList.add("hidden"); $("vaultView").classList.add("hidden"); $("editView").classList.add("hidden"); $("settingsView").classList.remove("hidden"); writeWebdavConfig("", {}); writeWebdavConfig("2", {}); await loadWebdavConfig(); const pending = await chrome.storage.session.get("pendingScan"); if (pending.pendingScan) { await chrome.storage.session.remove("pendingScan"); openEditor(scannedEntry(pending.pendingScan)); } }
function closeSettings() { stopScanner(); $("settingsView").classList.add("hidden"); $("editView").classList.add("hidden"); $("appHeader").classList.remove("hidden"); $("vaultView").classList.remove("hidden"); $("settingsButton").classList.remove("hidden"); loadFilterSetting().then(render); }
async function lock() { state.key = null; state.entries = []; await chrome.storage.session.remove("sessionKey"); $("vaultView").classList.add("hidden"); $("settingsView").classList.add("hidden"); $("editView").classList.add("hidden"); $("appHeader").classList.add("hidden"); $("unlockView").classList.remove("hidden"); $("lockButton").classList.add("hidden"); $("settingsButton").classList.add("hidden"); $("masterPassword").value = ""; }
async function unlock() {
  const password = $("masterPassword").value;
  if (password.length < 8) { $("unlockError").textContent = "主密码至少 8 位"; return; }
  const stored = await chrome.storage.local.get(["salt", "vault"]);
  try {
    state.salt = stored.salt ? b64ToBytes(stored.salt) : crypto.getRandomValues(new Uint8Array(16));
    state.key = await deriveKey(password, state.salt);
    state.entries = stored.vault ? await decrypt(stored.vault) : [];
    if (!stored.salt) await chrome.storage.local.set({ salt: bytesToB64(state.salt) });
    await saveSessionKey();
    $("unlockError").textContent = ""; showVault();
  } catch { state.key = null; $("unlockError").textContent = "主密码不正确或数据已损坏"; }
}
function render() {
  const query = $("search").value.trim().toLowerCase();
  const hasOtp = (e) => Boolean(String(e.otp || "").trim()); const hasPassword = (e) => Boolean(String(e.password || "").trim()); const filtersActive = state.showOnlyOtp || state.showOnlyPassword; const list = state.entries.filter((e) => (!filtersActive || (state.showOnlyOtp && hasOtp(e)) || (state.showOnlyPassword && hasPassword(e))) && `${e.name} ${e.username}`.toLowerCase().includes(query));
  $("entries").innerHTML = list.length ? list.map((e) => `<article class="entry"><div class="entryTop"><span class="entryName">${escapeHtml(e.name)}</span>${e.otp ? `<span class="otpWrap"><span class="otpCode" data-otp-id="${e.id}">------</span><span class="otpTimer" data-timer-id="${e.id}"></span></span>` : ""}<button class="secondary edit" data-id="${e.id}">编辑</button></div><div class="entryMeta">${escapeHtml(e.username || "无用户名")}</div><div class="entryActions"><button class="copy" data-kind="username" data-id="${e.id}">账号</button><button class="copy" data-kind="password" data-id="${e.id}">密码</button>${e.otp ? `<button class="copy" data-kind="otp" data-id="${e.id}">OTP</button>` : ""}</div></article>`).join("") : `<div class="empty">暂无已保存项目</div>`;
  list.filter((e) => e.otp).forEach((e) => updateOtpDisplay(e));
}
async function updateOtpDisplay(entry) { try { const code = await totp(entry); const codeNode = document.querySelector(`[data-otp-id="${entry.id}"]`); const timerNode = document.querySelector(`[data-timer-id="${entry.id}"]`); const period = Number(entry.period || 30); const remaining = period - (Math.floor(Date.now() / 1000) % period); if (codeNode) codeNode.textContent = code; if (timerNode) timerNode.textContent = `${remaining}`; } catch {} }
setInterval(() => state.key && state.entries.filter((e) => e.otp).forEach(updateOtpDisplay), 1000);
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function resizeNotes() { const notes = $("entryNotes"); notes.style.height = "auto"; notes.style.height = `${notes.scrollHeight}px`; }
function openEditor(entry = {}) { $("appHeader").classList.add("hidden"); $("vaultView").classList.add("hidden"); $("settingsView").classList.add("hidden"); $("editView").classList.remove("hidden"); $("entryForm").classList.remove("hidden"); $("entryId").value = entry.id || ""; $("deleteButton").classList.toggle("hidden", !entry.id); $("entryName").value = entry.name || ""; $("entryUrl").value = entry.url || ""; $("entryUsername").value = entry.username || ""; $("entryPassword").value = entry.password || ""; $("entryNotes").value = entry.notes || ""; $("entryOtp").value = entry.otp || ""; $("entryAlgorithm").value = entry.algorithm || "SHA1"; $("entryDigits").value = String(entry.digits || 6); $("entryPeriod").value = String(entry.period || 30); resizeNotes(); $("entryName").focus(); }
async function deleteEntry() { const id = $("entryId").value; if (!id || !confirm("确定删除这条数据吗？删除后无法撤销。")) return; state.entries = state.entries.filter((entry) => entry.id !== id); await saveVault(); closeEditor(); render(); }
function closeEditor() { $("editView").classList.add("hidden"); $("appHeader").classList.remove("hidden"); $("vaultView").classList.remove("hidden"); }
async function startTabRegionScanner() { const session = await chrome.storage.session.get("scanTabId"); if (!session.scanTabId) throw new Error("没有记录到目标标签页，请返回首页后重新进入设置"); const response = await chrome.tabs.sendMessage(session.scanTabId, { type: "start-region-scan" }); if (!response?.ok && response?.error) throw new Error(response.error); }

$("unlockButton").onclick = unlock; $("masterPassword").onkeydown = (e) => { if (e.key === "Enter") unlock(); }; $("lockButton").onclick = lock; $("addButton").onclick = () => openEditor(); $("cancelButton").onclick = closeEditor; $("editBackButton").onclick = closeEditor; $("deleteButton").onclick = deleteEntry; $("generateButton").onclick = () => $("entryPassword").value = randomPassword(); $("search").oninput = render;
$("entryNotes").oninput = resizeNotes;
function bindPasswordToggle(buttonId, inputId) { $(buttonId).onclick = () => { const input = $(inputId), button = $(buttonId); const visible = input.type === "text"; input.type = visible ? "password" : "text"; button.textContent = visible ? "显示" : "隐藏"; }; }
bindPasswordToggle("togglePassword", "entryPassword"); bindPasswordToggle("toggleCurrentMaster", "currentMasterPassword"); bindPasswordToggle("toggleNewMaster", "newMasterPassword"); bindPasswordToggle("toggleConfirmMaster", "confirmMasterPassword"); bindPasswordToggle("toggleWebdavPassword", "webdavPassword"); bindPasswordToggle("toggleWebdav2Password", "webdav2Password");
$("entryForm").onsubmit = async (e) => { e.preventDefault(); const id = $("entryId").value || crypto.randomUUID(); let parsed; try { parsed = parseOtpInput($("entryOtp").value); } catch { alert("OTP URI 格式无效"); return; } const entry = { id, name: $("entryName").value.trim() || parsed.label || "未命名", url: $("entryUrl").value.trim(), username: $("entryUsername").value, password: $("entryPassword").value, notes: $("entryNotes").value, otp: parsed.secret, algorithm: parsed.algorithm || $("entryAlgorithm").value, digits: parsed.digits || Number($("entryDigits").value), period: parsed.period || Number($("entryPeriod").value) }; const index = state.entries.findIndex((item) => item.id === id); if (index >= 0) state.entries[index] = entry; else state.entries.unshift(entry); await saveVault(); closeEditor(); render(); };
$("entries").onclick = async (e) => { const button = e.target.closest("button"); if (!button) return; const entry = state.entries.find((item) => item.id === button.dataset.id); if (!entry) return; if (button.classList.contains("edit")) { openEditor(entry); return; } if (button.classList.contains("copy")) { const original = button.textContent; button.disabled = true; try { const value = button.dataset.kind === "otp" ? await totp(entry) : entry[button.dataset.kind]; await copyText(value); button.textContent = "已复制"; } catch (error) { button.textContent = error.message || "复制失败"; } finally { setTimeout(() => { button.textContent = original; button.disabled = false; }, 1000); } } };
$("settingsButton").onclick = openSettings; $("backButton").onclick = closeSettings; $("homeOtpFilter").onchange = async () => { state.showOnlyOtp = $("homeOtpFilter").checked; await chrome.storage.local.set({ showOnlyOtp: state.showOnlyOtp }); render(); }; $("homePasswordFilter").onchange = async () => { state.showOnlyPassword = $("homePasswordFilter").checked; await chrome.storage.local.set({ showOnlyPassword: state.showOnlyPassword }); render(); }; $("changeMasterPassword").onclick = changeMasterPassword; $("saveWebdav").onclick = saveWebdavConfig;
$("scanTabButton").onclick = () => scanCurrentTab().catch((error) => $("scanMessage").textContent = error.message); $("scanRegionButton").onclick = () => startTabRegionScanner().catch((error) => $("scanMessage").textContent = error.message); $("scanRegionConfirm").onclick = () => scanSelectedRegion().catch((error) => $("scanMessage").textContent = error.message); $("scanRegionCancel").onclick = closeRegionScanner; bindCropCanvas(); $("scanCameraButton").onclick = () => startScanner().catch((error) => $("scanMessage").textContent = error.message); $("stopScanButton").onclick = () => { stopScanner(); $("scanVideo").classList.add("hidden"); $("stopScanButton").classList.add("hidden"); }; $("scanFile").onchange = (e) => scanImage(e.target.files[0]).catch((error) => $("scanMessage").textContent = error.message);
$("exportButton").onclick = () => exportVault().catch((error) => $("syncMessage").textContent = error.message); $("vaultFile").onchange = async (e) => { try { await importVault(e.target.files[0]); } catch (error) { $("syncMessage").textContent = error.message; } e.target.value = ""; }; $("authFile").onchange = (e) => importAuthenticatorText(e.target.files[0]).catch((error) => $("syncMessage").textContent = error.message); $("webdavSync").onclick = async () => { await chrome.storage.local.set({ webdavUrl: $("webdavUrl").value.trim(), webdavUsername: $("webdavUsername").value }); await syncWebdav(); }; $("onedriveButton").onclick = () => $("syncMessage").textContent = "OneDrive 需要配置自己的 Microsoft OAuth 应用，当前请使用 WebDAV 或加密导出";

restoreSession().catch(() => {});
