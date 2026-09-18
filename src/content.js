(() => {
  const state = { matches: [], activeForm: null, host: null, submitted: new WeakSet() };

  function passwordInput(form) { return form?.querySelector('input[type="password"]'); }
  function usernameInput(form) {
    if (!form) return null;
    return form.querySelector('input[autocomplete="username"], input[type="email"], input:not([type]), input[type="text"]');
  }
  function forms() { return [...document.querySelectorAll("form")].filter((form) => passwordInput(form)); }
  function send(message) { return chrome.runtime.sendMessage(message).catch(() => ({ ok: false })); }
  function currentForm() { return forms()[0] || null; }

  function createHost() {
    if (state.host) return state.host;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host{all:initial} .box{font:13px Arial,sans-serif;color:#182230;background:#fff;border:1px solid #d5dce6;border-radius:8px;box-shadow:0 5px 22px #0002;min-width:245px;max-width:310px;padding:10px} .title{font-weight:700;margin-bottom:7px} .row{display:flex;align-items:center;gap:6px;margin-top:7px} .account{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#566273} button{border:0;border-radius:5px;padding:6px 9px;background:#2463eb;color:#fff;cursor:pointer;font-weight:600} button.alt{background:#e7ebf2;color:#334155} .close{float:right;background:transparent;color:#687385;padding:0 2px;font-size:16px} </style><div id="root"></div>`;
    state.host = { host, root: shadow.querySelector("#root") };
    return state.host;
  }

  function hideBar() { if (state.host) state.host.root.replaceChildren(); state.activeForm = null; }
  function showFillBar(form) {
    if (!state.matches.length || state.submitted.has(form)) return;
    state.activeForm = form;
    const { root } = createHost();
    root.replaceChildren();
    const box = document.createElement("div"); box.className = "box";
    const title = document.createElement("div"); title.className = "title"; title.textContent = "本地密码库";
    const close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.title = "关闭"; close.onclick = hideBar;
    title.append(close); box.append(title);
    state.matches.forEach((entry) => {
      const row = document.createElement("div"); row.className = "row";
      const account = document.createElement("span"); account.className = "account"; account.textContent = `${entry.name || "未命名"} · ${entry.username || "无账号"}`;
      const button = document.createElement("button"); button.textContent = "填充"; button.onclick = () => { const user = usernameInput(form); const pass = passwordInput(form); if (user) setValue(user, entry.username); setValue(pass, entry.password); hideBar(); };
      row.append(account, button); box.append(row);
    });
    root.append(box);
  }

  function showSaveBar(form, username, password) {
    if (!username || !password) return;
    state.activeForm = form;
    const { root } = createHost(); root.replaceChildren();
    const box = document.createElement("div"); box.className = "box";
    const title = document.createElement("div"); title.className = "title"; title.textContent = "保存到本地密码库";
    const close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.onclick = hideBar; title.append(close); box.append(title);
    const text = document.createElement("div"); text.textContent = `检测到 ${username} 的登录信息，是否保存？`; box.append(text);
    const row = document.createElement("div"); row.className = "row";
    const save = document.createElement("button"); save.textContent = "保存"; save.onclick = async () => { save.disabled = true; const result = await send({ type: "save-login", username, password, name: document.title || location.hostname }); if (result.ok) { box.textContent = "已保存"; setTimeout(hideBar, 1200); } else { save.disabled = false; text.textContent = result.error || "保存失败，请先解锁扩展"; } };
    const dismiss = document.createElement("button"); dismiss.className = "alt"; dismiss.textContent = "忽略"; dismiss.onclick = hideBar; row.append(save, dismiss); box.append(row); root.append(box);
  }

  function setValue(input, value) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }
  function observeForm(form) {
    if (form.dataset.localVaultObserved) return;
    form.dataset.localVaultObserved = "1";
    form.addEventListener("submit", () => { const user = usernameInput(form)?.value?.trim(); const pass = passwordInput(form)?.value || ""; state.submitted.add(form); setTimeout(() => showSaveBar(form, user, pass), 350); }, true);
    form.querySelectorAll("button, input[type=submit]").forEach((button) => button.addEventListener("click", () => { const user = usernameInput(form)?.value?.trim(); const pass = passwordInput(form)?.value || ""; setTimeout(() => showSaveBar(form, user, pass), 450); }, true));
  }
  async function scan() {
    const list = forms(); list.forEach(observeForm);
    const result = await send({ type: "get-login-matches", url: location.href });
    if (result.ok) { state.matches = result.matches || []; const form = currentForm(); if (form) showFillBar(form); }
  }
  function startRegionPicker() {
    const overlay = document.createElement("div"); overlay.id = "local-vault-region-picker"; overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.16);cursor:crosshair";
    const box = document.createElement("div"); box.style.cssText = "position:absolute;border:2px solid #2463eb;background:rgba(36,99,235,.14);display:none";
    const toolbar = document.createElement("div"); toolbar.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;padding:8px;background:#fff;border:1px solid #d5dce6;border-radius:8px;box-shadow:0 5px 22px #0003;font:13px Arial,sans-serif;cursor:default";
    const confirm = document.createElement("button"); confirm.textContent = "识别选区"; confirm.style.cssText = "border:0;border-radius:5px;padding:6px 10px;background:#2463eb;color:#fff;font-weight:600;cursor:pointer";
    const cancel = document.createElement("button"); cancel.textContent = "取消"; cancel.style.cssText = "border:0;border-radius:5px;padding:6px 10px;background:#e7ebf2;color:#334155;cursor:pointer"; toolbar.append(confirm, cancel); overlay.append(box, toolbar); document.documentElement.appendChild(overlay);
    let start = null, rect = null;
    const point = (event) => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
    overlay.onpointerdown = (event) => { if (event.target !== overlay) return; start = point(event); rect = { x: start.x, y: start.y, width: 0, height: 0 }; box.style.display = "block"; };
    overlay.onpointermove = (event) => { if (!start) return; const end = point(event); rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); };
    overlay.onpointerup = () => { start = null; };
    const close = () => overlay.remove(); cancel.onclick = close;
    confirm.onclick = async () => { if (!rect || rect.width < 8 || rect.height < 8) return; close(); const result = await send({ type: "region-scan-selection", rect, viewport: { width: innerWidth, height: innerHeight } }); if (result.ok) chrome.runtime.sendMessage({ type: "region-scan-result", data: result.data }).catch(() => {}); };
  }
  chrome.runtime.onMessage.addListener((message) => { if (message.type === "start-region-scan") startRegionPicker(); });
  new MutationObserver(() => forms().forEach(observeForm)).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
