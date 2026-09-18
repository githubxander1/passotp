(() => {
  const state = { matches: [], activeForm: null, host: null, submitted: new WeakSet(), saveShown: new WeakSet(), saveRequested: new WeakSet(), autofilled: new WeakSet(), scanTimer: null };

  function usable(input) {
    if (!input || input.disabled || input.readOnly) return false;
    const style = getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden" && input.getClientRects().length > 0;
  }
  function passwordInput(form) { return [...(form?.querySelectorAll('input[type="password"]') || [])].find(usable) || null; }
  function usernameInput(form) {
    if (!form) return null;
    const candidates = [...form.querySelectorAll('input[autocomplete="username"], input[type="email"], input:not([type]), input[type="text"]')].filter(usable);
    return candidates.sort((a, b) => {
      const score = (input) => {
        const value = `${input.autocomplete} ${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
        return (input.autocomplete === "username" ? 100 : 0) + (/(user|account|login|email|邮箱|账号)/.test(value) ? 20 : 0);
      };
      return score(b) - score(a);
    })[0] || null;
  }
  function forms() {
    const result = [...document.querySelectorAll("form")].filter((form) => passwordInput(form));
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.form || result.includes(input.parentElement)) return;
      const container = input.closest("[role=dialog], .modal, .login, .signin, .auth") || input.parentElement;
      if (container && passwordInput(container) && !result.includes(container)) result.push(container);
    });
    return result;
  }
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
  function fillForm(form, entry) {
    const user = usernameInput(form); const pass = passwordInput(form);
    user?.focus();
    if (user && entry.username) setValue(user, entry.username);
    if (pass && entry.password) setValue(pass, entry.password);
    pass?.dispatchEvent(new Event("blur", { bubbles: true }));
    state.autofilled.add(form); hideBar();
  }
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
      const button = document.createElement("button"); button.textContent = "填充"; button.onclick = () => fillForm(form, entry);
      row.append(account, button); box.append(row);
    });
    root.append(box);
  }

  function showSaveBar(form, username, password, existing) {
    if (!username || !password) return;
    state.activeForm = form;
    const { root } = createHost(); root.replaceChildren();
    const box = document.createElement("div"); box.className = "box";
    const title = document.createElement("div"); title.className = "title"; title.textContent = existing ? "更新本地密码库" : "保存到本地密码库";
    const close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.onclick = hideBar; title.append(close); box.append(title);
    const text = document.createElement("div"); text.textContent = existing ? `检测到 ${username} 的密码发生变化，是否更新？` : `检测到 ${username} 的新登录信息，是否保存？`; box.append(text);
    const row = document.createElement("div"); row.className = "row";
    const save = document.createElement("button"); save.textContent = existing ? "更新" : "保存"; save.onclick = async () => { save.disabled = true; const result = await send({ type: "confirm-login" }); if (result.ok) { box.textContent = existing ? "已更新" : "已保存"; state.matches = state.matches.filter((item) => item.username !== username); state.matches.push({ username, password, name: document.title || location.hostname }); setTimeout(hideBar, 1200); } else { save.disabled = false; text.textContent = result.error || "保存失败，请先解锁扩展"; } };
    const dismiss = document.createElement("button"); dismiss.className = "alt"; dismiss.textContent = "忽略"; dismiss.onclick = async () => { await send({ type: "dismiss-login" }); hideBar(); }; row.append(save, dismiss); box.append(row); root.append(box);
  }

  function setValue(input, value) {
    if (!input) return;
    const prototype = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const previous = input.value;
    setter ? setter.call(input, value) : (input.value = value);
    // React tracks the last value separately; clear it so the synthetic input event is observed.
    if (input._valueTracker) input._valueTracker.setValue(previous);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: String(value) }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  function captureCredentials(form) { return { username: usernameInput(form)?.value?.trim() || "", password: passwordInput(form)?.value || "" }; }
  async function saveSubmittedCredentials(form) {
    if (state.saveRequested.has(form)) return;
    const { username, password } = captureCredentials(form);
    if (!username || !password) return;
    const existing = state.matches.find((item) => item.username === username);
    if (existing && existing.password === password) return;
    state.saveRequested.add(form);
    const result = await send({ type: "capture-login", username, password, name: document.title || location.hostname, url: location.href });
    if (result.ok) {
      if (result.alreadySaved) return;
      showSaveBar(form, username, password, existing);
    } else {
      showSaveBar(form, username, password, existing);
    }
  }
  function scheduleSave(form) {
    // The submit event is the reliable point before navigation; the timeout is only a fallback for JS login buttons.
    saveSubmittedCredentials(form);
    setTimeout(() => saveSubmittedCredentials(form), 80);
  }
  function showSavedBar(message) {
    const { root } = createHost(); root.replaceChildren();
    const box = document.createElement("div"); box.className = "box"; box.textContent = message;
    root.append(box); setTimeout(hideBar, 1800);
  }
  function observeForm(form) {
    if (form.dataset.localVaultObserved) return;
    form.dataset.localVaultObserved = "1";
    form.addEventListener("submit", () => { state.submitted.add(form); scheduleSave(form); }, true);
    form.querySelectorAll("button, input[type=submit]").forEach((button) => button.addEventListener("click", () => scheduleSave(form), true));
    form.querySelectorAll('input[type="password"], input[type="email"], input[autocomplete="username"]').forEach((input) => input.addEventListener("focus", () => showFillBar(form), { once: true }));
  }
  async function scan() {
    const list = forms(); list.forEach(observeForm);
    const result = await send({ type: "get-login-matches", url: location.href });
    if (result.ok) {
      state.matches = result.matches || [];
      const form = currentForm();
      const pendingResult = await send({ type: "get-pending-login" });
      if (pendingResult.ok && pendingResult.pending) showSaveBar(form, pendingResult.pending.username, pendingResult.pending.password, pendingResult.pending.existing);
      if (form && state.matches.length) {
        if (state.matches.length === 1 && !usernameInput(form)?.value && !passwordInput(form)?.value) setTimeout(() => fillForm(form, state.matches[0]), 250);
        else showFillBar(form);
      }
    }
  }
  function scheduleScan() { clearTimeout(state.scanTimer); state.scanTimer = setTimeout(() => scan().catch(() => {}), 250); }
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
  new MutationObserver(() => { forms().forEach(observeForm); scheduleScan(); }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
