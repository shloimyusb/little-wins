/* Tablet-facing preview flow. No developer console or pairing controls are shown. */
(() => {
  const $ = (id) => document.getElementById(id),
    sync = window.prototypeSync;
  let mode = "signin",
    emailScreen = false,
    formBusy = false,
    pinBusy = false,
    pinTarget = null,
    pinEnroll = false,
    pinTimer = null,
    pinEpoch = 0,
    lastTried = null,
    pendingAction = null;
  let accounts = {
    pinLengths: JSON.parse(localStorage.getItem("preview-pin-lengths") || "{}"),
  };
  const accountName = (id) =>
    id === "parent"
      ? (sync.connection.parentLabel || "Parent")
      : state.members.find((m) => m.id === id)?.name || "Child";
  const showError = (id, error) =>
    ($(id).textContent = error.message || String(error));
  function setStage() {
    const connection = sync.connection;
    document.body.dataset.tabletStage =
      !connection.deviceToken || emailScreen ? "welcome" : "app";
    $("welcomeBack").hidden = !connection.deviceToken && mode!=="setup";
    $("previewFamily").hidden = !parentMode;
  }
  function refreshStatus() {
    const queued = sync.outbox.length,
      connection = sync.connection,
      offline = !navigator.onLine;
    const last = $("protoStatus").textContent;
    let text = "Synced",
      kind = "online";
    if (offline) {
      text = queued ? `Offline · ${queued} waiting` : "Offline";
      kind = "offline";
    } else if (!connection.sessionToken) {
      text = "Ready to sign in";
    } else if (queued) {
      text = `${queued} change${queued === 1 ? "" : "s"} waiting`;
      kind = "offline";
    } else if (/unavailable|Sign in again|Approval not completed/i.test(last)) {
      text = "Check connection";
      kind = "error";
    }
    $("previewSync").textContent = text;
    $("previewSync").dataset.state = kind;
    $("familyEmail").textContent =
      parentMode && connection.parentEmail
        ? (connection.parentLabel && connection.parentLabel!=="Parent" ? connection.parentLabel+" · " : "") + connection.parentEmail
        : "Your family";
    $("familySyncState").textContent = offline
      ? "You’re offline. Saved changes will sync when this tablet reconnects."
      : queued
        ? `${queued} saved change(s) waiting to sync. Offline points are provisional.`
        : connection.sessionToken
          ? "Your family is up to date."
          : "Sign in to sync your family.";
    $("familyConflicts").textContent = parentMode
      ? sync.conflicts
          .slice(-3)
          .map((x) => x.message)
          .join(" ")
      : "";
    $("familySetParentPin").hidden = !parentMode;
    setStage();
  }
  async function refreshAccounts() {
    if (!sync.connection.deviceToken) return;
    try {
      accounts = await sync.api(
        "device/accounts",
        undefined,
        sync.connection.deviceToken,
      );
      localStorage.setItem(
        "preview-pin-lengths",
        JSON.stringify(accounts.pinLengths),
      );
    } catch {}
  }
  function setMode(value) {
    mode=value;const create=mode==='create',setup=mode==='setup',join=mode==='join';
    document.getElementById('joinCodeWrap')?.toggleAttribute('hidden',!join);
    const jc=document.getElementById('joinCode');if(jc){jc.disabled=!join;jc.required=join;}
    document.getElementById('welcomeJoinHelp')?.toggleAttribute('hidden',!join);
    $('welcomeCreateTab').textContent='Create account';
    $('welcomeCreateTab').setAttribute('aria-selected',String(create));$('welcomeSignInTab').setAttribute('aria-selected',String(!create));
    $('welcomeCreateTab').parentElement.hidden=setup;
    $('welcomePinFields').hidden=!setup;
    for(const id of ['initialParentPin','initialChildPin']){$(id).disabled=!setup;$(id).required=setup;}
    $('welcomeEmail').disabled=setup;$('welcomePassword').disabled=setup;$('welcomePassword').required=!setup;
    $('welcomePassword').hidden=setup;document.querySelector('label[for="welcomePassword"]').hidden=setup;$('welcomeShowPassword').closest('label').hidden=setup;
    $('welcomePassword').minLength=create?10:1;$('welcomePassword').autocomplete=create?'new-password':'current-password';
    $('welcomeTitle').textContent=setup?'Choose your family PINs':'Welcome to Little Wins';
    $('welcomeHelp').textContent=setup?'Your email is verified. Choose a Parent PIN and a starting child PIN to finish setting up your family.':'Connect this device to your family. Your chores, points and rewards stay together.';
    $('welcomeSubmit').textContent=setup?'Save family PINs':create?'Create parent account':join?'Join existing family':'Sign in';
    $('welcomeForgot').hidden=create||setup;$('welcomeError').textContent='';$('welcomeError').style.color='';
    $('welcomeBack').hidden=!sync.connection.deviceToken&&!setup;
  }
  function showEmail() {
    emailScreen = true;
    setMode("signin");
    $("welcomeEmail").value =
      sync.connection.parentEmail || $("welcomeEmail").value;
    setStage();
    $("welcomeEmail").focus();
  }
  async function unlock(id, enroll = false, action = null) {
    if (enroll && !parentMode) return;
    if (!sync.connection.deviceToken) {
      showEmail();
      return;
    }
    if (!enroll) {
      const actor = id === "parent" ? "parent" : id;
      if (sync.outbox.some((op) => op.actor !== actor)) {
        if (!(await sync.sync())) {
          toast("Reconnect and sync the current account before switching.");
          return;
        }
      }
      // Signing into another account always hides the current account first.
      if (sync.connection.sessionToken) await sync.logout();
    }
    await refreshAccounts();
    pinTarget = id;
    pinEnroll = enroll;
    pendingAction = action;
    lastTried = null;
    pinEpoch++;
    clearTimeout(pinTimer);
    $("tabletPinForm").reset();
    $("tabletPin").type = "password";
    $("tabletPinRepeat").type = "password";
    $("tabletPinRepeat").required = enroll;
    $("tabletPin").pattern = id === "parent" ? "[0-9]{6,32}" : "[0-9]{4,32}";
    $("tabletPinTitle").textContent = enroll
      ? "Set PIN for " + accountName(id)
      : accountName(id);
    $("tabletPinHelp").textContent = enroll
      ? id === "parent"
        ? "Choose at least 6 digits."
        : "Choose at least 4 digits. Only a parent can change this PIN."
      : "Enter your private PIN to sign in.";
    $("tabletPinRepeatWrap").hidden = !enroll;
    $("tabletPinError").textContent = "";
    $("tabletEmailInstead").hidden = enroll || id !== "parent";
    $("tabletPinHelpDetails").hidden = enroll;
    $("tabletPinSubmit").textContent = enroll ? "Save PIN" : "Continue";
    $("tabletPinDialog").showModal();
    $("tabletPin").focus();
    refreshStatus();
  }
  $("welcomeSignInTab").onclick = () => setMode("signin");
  $("welcomeCreateTab").onclick = () => setMode("create");
  window.showParentJoin=()=>setMode("join");
  $("welcomeShowPassword").onchange = () => {
    $("welcomePassword").type = $("welcomeShowPassword").checked
      ? "text"
      : "password";
  };
  $('welcomeForm').onsubmit=async event=>{
    event.preventDefault();if(formBusy)return;formBusy=true;$('welcomeSubmit').disabled=true;$('welcomeError').textContent='';$('welcomeError').style.color='';
    try{
      let result;
      if(mode==='setup')result=await sync.finishFamilySetup($('initialParentPin').value,$('initialChildPin').value);
      else if(mode==='join')result=await sync.joinFamily($('welcomeEmail').value,$('welcomePassword').value,$('joinCode').value);
      else if(mode==='create')result=await sync.emailRegister($('welcomeEmail').value,$('welcomePassword').value);
      else result=await sync.emailLogin($('welcomeEmail').value,$('welcomePassword').value);
      $('welcomePassword').value='';
      if(result?.confirmationRequired){setMode('signin');$('welcomeError').style.color='#216d54';$('welcomeError').textContent='Check your email to confirm your account, then sign in here. You will choose family PINs after confirming.';return;}
      if(result?.needsFamilySetup){setMode('setup');emailScreen=true;setStage();return;}
      emailScreen=false;for(const id of ['welcomePassword','initialParentPin','initialChildPin'])$(id).value='';
      $('welcomeShowPassword').checked=false;$('welcomePassword').type='password';await refreshAccounts();refreshStatus();window.scrollTo(0,0);
    }catch(error){showError('welcomeError',error);$('welcomePassword').value='';}
    finally{formBusy=false;$('welcomeSubmit').disabled=false;}
  };
  $("welcomeBack").onclick = () => {
    if(mode==="setup"){sync.cancelSetup();setMode("signin");}
    emailScreen = false;
    $("welcomePassword").value = "";
    refreshStatus();
  };
  $("tabletShowPin").onchange = () => {
    for (const id of ["tabletPin", "tabletPinRepeat"])
      $(id).type = $("tabletShowPin").checked ? "text" : "password";
  };
  $("tabletPinCancel").onclick = () => $("tabletPinDialog").close();
  $("tabletPinDialog").addEventListener("close", () => {
    pinEpoch++;
    clearTimeout(pinTimer);
    for (const id of ["tabletPin", "tabletPinRepeat"]) {
      $(id).value = "";
      $(id).type = "password";
    }
    $("tabletShowPin").checked = false;
  });
  $("tabletEmailInstead").onclick = () => {
    $("tabletPinDialog").close();
    showEmail();
  };
  $("tabletPin").oninput = () => {
    clearTimeout(pinTimer);
    if (pinEnroll || pinBusy) return;
    const value = $("tabletPin").value,
      length = accounts.pinLengths[pinTarget];
    if (
      !length ||
      value.length !== length ||
      !/^\d+$/.test(value) ||
      value === lastTried
    )
      return;
    const epoch = pinEpoch;
    pinTimer = setTimeout(() => {
      if (
        epoch === pinEpoch &&
        $("tabletPinDialog").open &&
        $("tabletPin").value === value
      )
        $("tabletPinForm").requestSubmit();
    }, 450);
  };
  $("tabletPinForm").onsubmit = async (event) => {
    event.preventDefault();
    clearTimeout(pinTimer);
    if (pinBusy) return;
    pinBusy = true;
    $("tabletPinSubmit").disabled = true;
    const value = $("tabletPin").value,
      epoch = pinEpoch,
      target = pinTarget,
      enroll = pinEnroll;
    lastTried = value;
    try {
      if (enroll) {
        if (value !== $("tabletPinRepeat").value)
          throw Error("The PINs do not match.");
        await sync.api("account/pin", { principal: target, pin: value });
        accounts.pinLengths[target] = value.length;
        localStorage.setItem(
          "preview-pin-lengths",
          JSON.stringify(accounts.pinLengths),
        );
        toast("PIN saved for " + accountName(target) + ".");
      } else {
        await sync.login(target, value);
        if (epoch !== pinEpoch || !$("tabletPinDialog").open) {
          await sync.logout();
          return;
        }
      }
      $("tabletPinDialog").close();
      emailScreen = false;
      refreshStatus();
      window.scrollTo(0, 0);
      const action = pendingAction;
      pendingAction = null;
      if (action && !enroll) action();
    } catch (error) {
      showError("tabletPinError", error);
    } finally {
      pinBusy = false;
      $("tabletPinSubmit").disabled = false;
    }
  };
  async function signOut() {
    $("tabletPinDialog").close();
    $("tabletSyncDialog").close();
    await sync.logout();
    emailScreen = false;
    refreshStatus();
    window.scrollTo(0, 0);
  }
  $("signOut").onclick = signOut;
  $("switchAccount").onclick = signOut;
  chooseChild = (id) => unlock(id);
  chooseParent = () => unlock("parent");
  login = (action) => unlock("parent", false, action);
  openKidPin = (id, enroll) => unlock(id, enroll);
  hasPin = () => !!sync.connection.deviceToken;
  hasChildPin = (id) => !!accounts.pinLengths[id];
  $("previewSync").onclick = async () => {
    if (!sync.connection.sessionToken) {
      if (sync.connection.deviceToken) toast("Choose your account to sign in.");
      else showEmail();
      return;
    }
    await sync.sync();
    refreshStatus();
    if (sync.conflicts.length) toast(sync.conflicts.at(-1).message);
  };
  $("previewFamily").onclick = () => {
    if (parentMode) {
      refreshStatus();
      $("tabletSyncDialog").showModal();
    }
  };
  $("familyDialogClose").onclick = () => $("tabletSyncDialog").close();
  $("familySyncNow").onclick = async () => {
    await sync.sync();
    refreshStatus();
  };
  $("familySetParentPin").onclick = () => {
    $("tabletSyncDialog").close();
    unlock("parent", true);
  };
  const logo = document.querySelector(".brand-logo");
  if (logo) $("welcomeLogo").src = logo.src;
  new MutationObserver(refreshStatus).observe($("protoStatus"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("online", refreshStatus);
  window.addEventListener("offline", refreshStatus);
  window.tabletPreview = {
    lock: signOut,
    background: () => {
      $("tabletPinDialog").close();
      if (parentMode) signOut();
    },
    refresh: refreshStatus,
  };
  refreshAccounts().then(() => {
    render();
    refreshStatus();
  });
  refreshStatus();
})();
