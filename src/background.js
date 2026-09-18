importScripts("vendor/jsQR.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "region-scan-selection") {
    decodeRegionFromTab(sender.tab?.id, message).then((data) => sendResponse({ ok: true, data })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "region-scan-result") {
    chrome.storage.session.set({ pendingScan: message.data }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (!["get-login-matches", "save-login", "capture-login", "get-pending-login", "confirm-login", "dismiss-login", "auto-sync-webdav"].includes(message.type)) return;
  if (message.type === "auto-sync-webdav") {
    syncStoredWebdav().then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  handleLoginMessage(message, sender).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function decodeRegionFromTab(tabId, message) {
  if (!tabId) throw new Error("无法确定当前标签页");
  const dataUrl = await captureTab(tabId);
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scaleX = bitmap.width / Number(message.viewport.width || bitmap.width), scaleY = bitmap.height / Number(message.viewport.height || bitmap.height);
  const rect = message.rect;
  const sx = Math.max(0, Math.round(rect.x * scaleX)), sy = Math.max(0, Math.round(rect.y * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scaleX)), sh = Math.min(bitmap.height - sy, Math.round(rect.height * scaleY));
  if (sw < 8 || sh < 8) throw new Error("选区太小");
  const canvas = new OffscreenCanvas(sw, sh), context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const result = self.jsQR(context.getImageData(0, 0, sw, sh).data, sw, sh, { inversionAttempts: "attemptBoth" });
  if (!result?.data) throw new Error("选区内没有识别到二维码");
  return result.data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "webdav") return;
  handleWebDav(message).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function getUnlockedVault() {
  const stored = await chrome.storage.local.get(["salt", "vault"]);
  const session = await chrome.storage.session.get("sessionKey");
  if (!stored.salt || !stored.vault || !session.sessionKey) throw new Error("请先在扩展中解锁");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(session.sessionKey), { name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
  const entries = await decryptRecord(stored.vault, key);
  return { stored, key, entries };
}

async function handleLoginMessage(message, sender) {
  const pageUrl = sender.tab?.url || message.url || "";
  const site = new URL(message.url || pageUrl).origin;
  const tabId = sender.tab?.id;
  const pendingKey = tabId == null ? null : `pendingLogin:${tabId}`;
  if (message.type === "get-pending-login") {
    const stored = pendingKey ? await chrome.storage.session.get(pendingKey) : {};
    return { pending: stored[pendingKey] || null };
  }
  if (message.type === "dismiss-login") {
    if (pendingKey) await chrome.storage.session.remove(pendingKey);
    return { dismissed: true };
  }
  if (message.type === "capture-login") {
    const username = String(message.username || "").trim();
    const password = String(message.password || "");
    if (!username || !password) throw new Error("登录表单缺少账号或密码");
    const { entries } = await getUnlockedVault();
    const existing = entries.find((entry) => sameSite(entry.url, site) && entry.username === username);
    if (existing && existing.password === password) return { alreadySaved: true };
    const pending = { username, password, name: String(message.name || new URL(site).hostname).slice(0, 120), url: site, existing: Boolean(existing) };
    if (pendingKey) await chrome.storage.session.set({ [pendingKey]: pending });
    return { pending };
  }
  if (message.type === "confirm-login") {
    const stored = pendingKey ? await chrome.storage.session.get(pendingKey) : {};
    const pending = stored[pendingKey];
    if (!pending) throw new Error("待保存的登录信息已过期");
    const result = await saveLogin(pending);
    if (pendingKey) await chrome.storage.session.remove(pendingKey);
    return result;
  }
  const { stored, key, entries } = await getUnlockedVault();
  if (message.type === "get-login-matches") {
    const matches = entries.filter((entry) => sameSite(entry.url, site)).map((entry) => ({ id: entry.id, name: entry.name, username: entry.username, password: entry.password }));
    return { matches };
  }
  const username = String(message.username || "").trim();
  const password = String(message.password || "");
  if (!username || !password) throw new Error("登录表单缺少账号或密码");
  const name = String(message.name || new URL(pageUrl).hostname).slice(0, 120);
  const index = entries.findIndex((entry) => sameSite(entry.url, site) && entry.username === username);
  return saveLogin({ username, password, name, url: site });
}

async function saveLogin(candidate) {
  const { key, entries } = await getUnlockedVault();
  const site = new URL(candidate.url).origin;
  const username = String(candidate.username || "").trim();
  const password = String(candidate.password || "");
  const index = entries.findIndex((entry) => sameSite(entry.url, site) && entry.username === username);
  const entry = { id: index >= 0 ? entries[index].id : crypto.randomUUID(), name: String(candidate.name || new URL(site).hostname).slice(0, 120), url: site, username, password, notes: index >= 0 ? entries[index].notes || "" : "", otp: index >= 0 ? entries[index].otp || "" : "", algorithm: index >= 0 ? entries[index].algorithm || "SHA1" : "SHA1", digits: index >= 0 ? entries[index].digits || 6 : 6, period: index >= 0 ? entries[index].period || 30 : 30 };
  if (index >= 0) entries[index] = { ...entries[index], ...entry }; else entries.unshift(entry);
  await chrome.storage.local.set({ vault: await encryptRecord(entries, key) });
  syncStoredWebdav().catch(() => {});
  return { saved: true, updated: index >= 0 };
}

async function syncStoredWebdav() {
  const { stored, key, entries } = await getUnlockedVault();
  const configRecord = await chrome.storage.local.get(["webdavConfigStandalone", "webdavConfig"]);
  if (!configRecord.webdavConfigStandalone && !configRecord.webdavConfig) return { synced: 0 };
  let rawConfig;
  if (configRecord.webdavConfigStandalone) {
    const configKey = await crypto.subtle.importKey("raw", b64ToBytes(configRecord.webdavConfigStandalone.key), { name: "AES-GCM" }, false, ["decrypt"]);
    rawConfig = await decryptRecord(configRecord.webdavConfigStandalone.record, configKey);
  } else {
    rawConfig = await decryptRecord(configRecord.webdavConfig, key);
  }
  const config = rawConfig.url ? { primary: rawConfig, secondary: {} } : rawConfig;
  const targets = [config.primary, config.secondary].filter((target) => target?.url);
  let localEntries = entries;
  let packageData = { format: "local-password-otp-vault", version: 1, exportedAt: new Date().toISOString(), salt: stored.salt, vault: stored.vault };
  let synced = 0;
  for (const target of targets) {
    try {
      const remote = await handleWebDav({ method: "get", url: target.url, username: target.username, password: target.password });
      // Background sync cannot ask for the old master password. Never overwrite a remote vault
      // encrypted with another salt; manual sync can merge it after the user confirms the old password.
      if (remote?.data?.salt && remote.data.salt !== stored.salt) continue;
      if (remote?.data?.salt && remote.data.salt === stored.salt) {
        const remoteEntries = await decryptRecord(remote.data.vault, key);
        localEntries = [...new Map([...localEntries, ...remoteEntries].map((entry) => [entry.id, entry])).values()];
        stored.vault = await encryptRecord(localEntries, key);
        await chrome.storage.local.set({ vault: stored.vault });
        packageData = { ...packageData, exportedAt: new Date().toISOString(), vault: stored.vault };
      }
      await handleWebDav({ method: "put", url: target.url, username: target.username, password: target.password, data: packageData });
      synced++;
    } catch {}
  }
  return { synced, count: localEntries.length };
}

function sameSite(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

function b64ToBytes(value) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
function bytesToB64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
async function decryptRecord(record, key) { const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(record.iv) }, key, b64ToBytes(record.data)); return JSON.parse(new TextDecoder().decode(data)); }
async function encryptRecord(value, key) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))); return { iv: bytesToB64(iv), data: bytesToB64(data) }; }

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "capture-tab") return;
  captureTab(message.tabId).then((dataUrl) => sendResponse({ ok: true, dataUrl })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function captureTab(tabId) {
  const target = await chrome.tabs.get(Number(tabId));
  const active = await chrome.tabs.query({ active: true, windowId: target.windowId });
  const previous = active[0]?.id;
  await chrome.tabs.update(target.id, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 180));
  try { return await chrome.tabs.captureVisibleTab(target.windowId, { format: "png" }); }
  finally { if (previous && previous !== target.id) await chrome.tabs.update(previous, { active: true }).catch(() => {}); }
}

async function handleWebDav(message) {
  const url = normalizeWebDavUrl(message.url);
  const headers = { "Content-Type": "application/json" };
  if (message.username || message.password) headers.Authorization = `Basic ${btoa(`${message.username || ""}:${message.password || ""}`)}`;
  if (message.method === "get") {
    const response = await fetch(url, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`WebDAV 读取失败：HTTP ${response.status}`);
    return { data: await response.json(), etag: response.headers.get("ETag") || "" };
  }
  const body = JSON.stringify(message.data);
  let response = await fetch(url, { method: "PUT", headers, body });
  if (response.status === 404) {
    await ensureWebDavDirectory(url, headers);
    response = await fetch(url, { method: "PUT", headers, body });
  }
  if (!response.ok) throw new Error(`WebDAV 写入失败：HTTP ${response.status}`);
  return { etag: response.headers.get("ETag") || "" };
}

async function ensureWebDavDirectory(fileUrl, headers) {
  const url = new URL(fileUrl);
  url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  const response = await fetch(url.toString(), { method: "MKCOL", headers: headers.Authorization ? { Authorization: headers.Authorization } : {} });
  if (![201, 405, 409].includes(response.status)) throw new Error(`WebDAV 目录不可用：HTTP ${response.status}`);
}

function normalizeWebDavUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) throw new Error("WebDAV 地址必须以 http:// 或 https:// 开头");
  const url = new URL(raw);
  if (url.hostname === "dav.jianguoyun.com" && ["/dav", "/dav/", "/dav/password-otp-vault.json"].includes(url.pathname)) url.pathname = "/dav/password-otp/";
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  if (!url.pathname.endsWith("/") && !/\.[^/]+$/.test(lastSegment)) url.pathname += "/";
  if (url.pathname.endsWith("/")) url.pathname += "password-otp-vault.json";
  return url.toString();
}
