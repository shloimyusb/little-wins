(() => {
  const standalone = () =>
    !!navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const dialog = document.createElement("dialog");
  dialog.id = "pwaInstallDialog";
  dialog.className = "pwa-install-dialog";
  dialog.innerHTML =
    '<img class="install-icon" src="./icons/icon-180.png" alt="Little Wins icon"><h2>Little Wins on your Home Screen</h2><p>Open this page in Safari on your iPhone or iPad, then:</p><ol><li>Tap Safari’s <b>Share</b> button (the square with an upward arrow).</li><li>Choose <b>Add to Home Screen</b> (you may need to scroll down).</li><li>Tap <b>Add</b>, then open Little Wins from its new icon.</li></ol><p id="pwaOfflineStatus" class="pwa-status-note">Preparing offline access…</p><p style="font-size:12px">Saved changes stay on this device until synced. Keep the app open for timer sounds; timer sounds cannot play while this web app is closed or the device is locked.</p><div class="actions"><button type="button" id="pwaInstallDone" class="btn primary">Done</button></div>';
  document.body.append(dialog);
  document.getElementById("pwaInstallDone").onclick = () => dialog.close();
  const link = document.createElement("button");
  link.id = "pwaInstall";
  link.type = "button";
  link.className = "pwa-install-link";
  link.textContent = "Add to Home Screen";
  link.hidden = standalone() || !ios;
  link.onclick = () => dialog.showModal();
  document
    .getElementById("previewBar")
    .insertBefore(link, document.getElementById("previewSync"));
  const welcome = document.createElement("button");
  welcome.id = "pwaWelcomeInstall";
  welcome.type = "button";
  welcome.className = "pwa-install-link pwa-welcome-install";
  welcome.textContent = ios
    ? "Add to your iPhone Home Screen"
    : "How to install on iPhone";
  welcome.hidden = standalone();
  welcome.onclick = () => dialog.showModal();
  document.getElementById("tabletWelcome").append(welcome);
  const update = document.createElement("button");
  update.id = "pwaUpdate";
  update.type = "button";
  update.textContent = "Update available";
  update.hidden = true;
  document.getElementById("previewBar").append(update);
  const viewport = () =>
    document.documentElement.style.setProperty(
      "--app-visible-height",
      (window.visualViewport?.height || innerHeight) + "px",
    );
  viewport();
  window.visualViewport?.addEventListener("resize", viewport);
  let registration,
    updating = false;
  const status = (text, warning = false) => {
    const el = document.getElementById("pwaOfflineStatus");
    el.textContent = text;
    el.dataset.state = warning ? "warning" : "ready";
  };
  const ready = () =>
    status(
      "Offline app screens are ready on this device. New sign-ins and reward approvals still need a connection.",
    );
  window.pwaPreview = { standalone: standalone(), ios, offlineReady: false };
  const markReady = () => {
    window.pwaPreview.offlineReady = true;
    ready();
  };
  update.onclick = async () => {
    if (window.prototypeSync?.outbox.length && !(await prototypeSync.sync())) {
      toast("Reconnect and sync your saved changes before updating.");
      return;
    }
    if (registration?.waiting) {
      updating = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };
  if (!isSecureContext || !("serviceWorker" in navigator)) {
    status(
      "Open Little Wins using its secure HTTPS address to install it.",
      true,
    );
    return;
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "OFFLINE_READY") markReady();
    if (event.data?.type === "UPDATE_CACHED") checkWaiting(true);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) location.reload();
  });
  const watched = new WeakSet();
  function watch(reg) {
    registration = reg;
    if (reg.waiting) update.hidden = false;
    if (watched.has(reg)) return;
    watched.add(reg);
    const installing = () => {
      const worker = reg.installing;
      if (!worker) return;
      const changed = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          update.hidden = false;
      };
      worker.addEventListener("statechange", changed);
      changed();
    };
    reg.addEventListener("updatefound", installing);
    installing();
  }
  async function checkWaiting(retry = false) {
    for (let attempt = 0; attempt < (retry ? 12 : 1); attempt++) {
      const reg = await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
      if (reg) {
        watch(reg);
        if (reg.waiting) {
          update.hidden = false;
          return;
        }
      }
      if (retry) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  window.addEventListener("focus", () => checkWaiting().catch(() => {}));
  window.addEventListener("online", () => checkWaiting().catch(() => {}));
  (async () => {
    // register() may reject during an offline launch even though a valid worker
    // is already installed. Keep that registration and its update listeners.
    const existing = await navigator.serviceWorker.getRegistration(new URL("./",location.href).href);
    if (existing) {
      watch(existing);
      await navigator.serviceWorker.ready;
      markReady();
    }
    try {
      const reg = await navigator.serviceWorker.register(new URL("./sw.js",location.href), {scope:new URL("./",location.href).href});
      watch(reg);
      await navigator.serviceWorker.ready;
      markReady();
    } catch (error) {
      if (!existing) throw error;
    }
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  })().catch(() =>
    status(
      "Offline access could not be saved. Keep a connection and try again.",
      true,
    ),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && window.tabletPreview) tabletPreview.background();
  });
  window.addEventListener("pagehide", () => {
    if (window.tabletPreview) tabletPreview.background();
  });
})();
