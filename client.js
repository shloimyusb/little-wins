/* Supabase transport. Only publishable configuration is bundled; parent Auth JWTs
   are used transiently for linking and never persisted beside child sessions. */
const CLOUD=window.LITTLE_WINS_CONFIG;
let pendingParentAuth=null,recoveryAuth=null;
function cloudError(body,status){const error=Error(body.message||body.msg||body.error_description||body.error||'Unable to connect.');error.code=body.code||body.error_code||body.error;error.status=status||body.status||409;return error;}
async function cloudRequest(path,data,{jwt=null,method='POST',allowFailure=false}={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(CLOUD.supabaseUrl+path,{method,signal:controller.signal,headers:{apikey:CLOUD.publishableKey,'Content-Type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const json=await response.json();
  if(!response.ok){if(json.code==='PGRST202'||json.code==='42883')throw Error('The database setup is not installed yet. Run setup.sql in Supabase SQL Editor.');throw cloudError(json,response.status);}
  if(json?.ok===false&&(!allowFailure||json.status===401||json.status===429))throw cloudError(json,json.status);return json;
 }finally{clearTimeout(timeout)}
}
async function cloudRPC(name,data,jwt=null){return cloudRequest('/rest/v1/rpc/'+name,data,{jwt,allowFailure:name==='lw_api'&&data.p_action==='command'})}
function cloudRedirect(){return new URL('./',location.href).href}
function captureAuthCallback(){
 const hash=new URLSearchParams(location.hash.slice(1));
 if(!hash.has('access_token')&&!hash.has('error_description'))return;
 if(hash.get('type')==='recovery'&&hash.get('access_token'))recoveryAuth=hash.get('access_token');
 window.cloudAuthNotice=hash.get('error_description')||(recoveryAuth?'recovery':'Email confirmed. Sign in to finish connecting your family.');
 history.replaceState(null,'',location.pathname+location.search);
}
captureAuthCallback();
async function cloudParentConnect(jwt,options={}){
 const result=await cloudRPC('lw_parent_connect',{p_device_token:options.deviceToken||null,...(options.seed?{p_seed:options.seed,p_parent_pin:options.parentPin,p_child_pin:options.childPin}:{})},jwt);
 if(result.needsFamilySetup){pendingParentAuth={jwt,expires:Date.now()+10*60000};return {needsFamilySetup:true};}
 pendingParentAuth=null;return result;
}
async function cloudSignIn(email,password,deviceToken){
 const auth=await cloudRequest('/auth/v1/token?grant_type=password',{email:email.trim(),password});
 return cloudParentConnect(auth.access_token,{deviceToken});
}
async function cloudSignUp(email,password){
 const response=await cloudRequest('/auth/v1/signup?redirect_to='+encodeURIComponent(cloudRedirect()),{email:email.trim(),password});
 if(response.access_token)return cloudParentConnect(response.access_token);
 return {confirmationRequired:true,email:email.trim()};
}
async function cloudFinishSetup(seed,parentPin,childPin){
 if(!pendingParentAuth||pendingParentAuth.expires<Date.now()){pendingParentAuth=null;throw Error('Please sign in again before finishing family setup.');}
 return cloudParentConnect(pendingParentAuth.jwt,{seed,parentPin,childPin});
}
async function cloudResetEmail(email){await cloudRequest('/auth/v1/recover?redirect_to='+encodeURIComponent(cloudRedirect()),{email:email.trim()});}
async function cloudResetPassword(password){
 if(!recoveryAuth)throw Error('Open a new password-reset link from your email first.');
 await cloudRequest('/auth/v1/user',{password},{jwt:recoveryAuth,method:'PUT'});
 await cloudRPC('lw_parent_revoke_sessions',{},recoveryAuth);recoveryAuth=null;
}
// Joining never initializes a second family. Only the verified invited email can accept.
async function cloudJoinFamily(email,password,code,deviceToken){
 const auth=await cloudRequest('/auth/v1/token?grant_type=password',{email:email.trim(),password});
 await cloudRPC('lw_parent_accept_invite',{p_code:code.trim().toLowerCase()},auth.access_token);
 return cloudParentConnect(auth.access_token,{deviceToken});
}

/* Isolated test adapter. The released app and its storage are never edited. */
(() => {
  const manual = new URLSearchParams(location.search).has("manual");
  const K = "little-wins-cloud-connection",
    Q = "little-wins-cloud-outbox",
    C = "little-wins-cloud-conflicts";
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  let connection = read(K, {}),
    outbox = read(Q, []),
    conflicts = read(C, []),
    baseline = structuredClone(state),
    applying = false,
    busy = null;
  const $p = (id) => document.getElementById(id),
    oldPersist = persist,
    oldSignOut = signOut;
  // Emulator host HTTP is not a secure browser origin. getRandomValues is still
  // available there, while randomUUID may be absent. Keep cryptographic IDs.
  function operationId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(
      "",
    );
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }
  const settingsFields = [
    "name",
    "points",
    "icon",
    "detail",
    "dailyLimit",
    "weeklyLimit",
    "deadline",
  ];
  function status(message) {
    $p("protoStatus").textContent =
      message ||
      `${navigator.onLine ? "Online" : "Offline"} · ${outbox.length} queued change(s) · ${connection.role || "signed out"} · revision ${connection.revision || 0}${outbox.length ? " · Offline points are provisional until accepted." : ""}`;
    $p("protoConflicts").textContent = conflicts
      .slice(-4)
      .map((c) => c.message)
      .join(" ");
  }
  function remember() {
    localStorage.setItem(K, JSON.stringify(connection));
    localStorage.setItem(Q, JSON.stringify(outbox));
    localStorage.setItem(C, JSON.stringify(conflicts));
    status();
  }
  async function api(path,data,token=connection.sessionToken){
    const device=path==='login'||path==='device/accounts';
    return cloudRPC('lw_api',{p_action:path,p_data:data||{},p_device_token:device?token:null,p_session_token:device?null:token});
  }
  function enqueue(type, data) {
    if (!connection.sessionToken) return;
    outbox.push({
      id: operationId(),
      type,
      data,
      actor: connection.role === "parent" ? "parent" : connection.member,
    });
  }
  function capture() {
    if (applying || !connection.sessionToken) return;
    const oldCompletions = new Map(baseline.completions.map((x) => [x.id, x]));
    for (const c of state.completions) {
      const before = oldCompletions.get(c.id);
      if (!before) {
        const chore = baseline.chores.find((x) => x.id === c.chore);
        enqueue(c.manualCredit ? "creditChore" : "completeChore", {
          member: c.member,
          chore: c.chore,
          completionId: c.id,
          completedAt: c.completedAt,
          day: c.day,
          choreVersion: chore?.syncVersion,
          overrideLimit: !!document.getElementById("creditOverrideLimit")
            ?.checked,
        });
      } else if (c.undoneAt && !before.undoneAt)
        enqueue("undoChore", { completionId: c.id });
    }
    const adjustments = new Map(
      baseline.pointAdjustments.map((a) => [a.id, a]),
    );
    for (const a of state.pointAdjustments) {
      const before = adjustments.get(a.id);
      if (!before) {
        if (a.reversalOf)
          enqueue("undoAdjustment", { adjustmentId: a.reversalOf });
        else
          enqueue("adjustPoints", {
            adjustmentId: a.id,
            member: a.member,
            delta: a.delta,
            reason: a.reason,
          });
      } else if (a.seenAt && !before.seenAt)
        enqueue("acknowledgeDeductions", { member: a.member, ids: [a.id] });
    }
    const requests = new Map(baseline.rewardRequests.map((q) => [q.id, q]));
    for (const q of state.rewardRequests) {
      const before = requests.get(q.id);
      if (!before)
        enqueue("requestReward", {
          member: q.member,
          reward: q.reward,
          requestId: q.id,
        });
      else if (q.status !== before.status && q.status === "declined")
        enqueue("declineReward", { requestId: q.id });
    }
    for (const [collection, type] of [
      ["chores", "setChoreSettings"],
      ["rewards", "setRewardSettings"],
    ])
      for (const item of state[collection]) {
        const old = baseline[collection].find((x) => x.id === item.id);
        if (!old) continue;
        const patch = {};
        for (const key of settingsFields)
          if (JSON.stringify(item[key]) !== JSON.stringify(old[key]))
            patch[key] = item[key] ?? null;
        if (Object.keys(patch).length)
          enqueue(type, { id: item.id, version: old.syncVersion, patch });
      }
    for (const m of state.members) {
      const old = baseline.members.find((x) => x.id === m.id);
      if (!old) continue;
      const patch = {};
      for (const key of ["theme", "icon", "timerSound"])
        if (m[key] !== old[key]) patch[key] = m[key];
      if (Object.keys(patch).length)
        enqueue("updateProfile", { member: m.id, patch });
    }
    baseline = structuredClone(state);
    remember();
  }
  persist = function () {
    capture();
    return oldPersist();
  };
  function accept(snapshot) {
    applying = true;
    try {
      const active = state.active;
      const timers = state.timers;
      state = snapshot.state;
      if(connection.role==="parent")connection.parentLabel=snapshot.parentLabel||"Parent";
      if (
        connection.role === "parent" &&
        state.members.some((m) => m.id === active)
      )
        state.active = active;
      // Timer handoff is deliberately excluded; retain local timers rather than pretending to share them.
      state.timers = timers.filter(
        (t) => connection.role === "parent" || t.member === connection.member,
      );
      connection.revision = snapshot.revision;
      baseline = structuredClone(state);
      oldPersist();
      render();
      remember();
    } finally {
      applying = false;
    }
  }
  async function sync() {
    if (busy) return busy;
    if (!connection.sessionToken) {
      status("Pair and sign in first.");
      return false;
    }
    busy = (async () => {
      document.body.classList.add("proto-busy");
      try {
        const hadQueued = outbox.length > 0;
        while (outbox.length) {
          const op = outbox[0],
            actor = connection.role === "parent" ? "parent" : connection.member;
          if (op.actor !== actor)
            throw Error(
              "Sign in to the account that has queued changes first.",
            );
          const { actor: ignored, ...command } = op;
          const result = await api("command", command);
          if (!result.ok) conflicts.push({ id: op.id, ...result });
          outbox.shift();
          remember();
        }
        const snapshot = await api("snapshot",hadQueued?{}:{knownRevision:connection.revision});
        if (hadQueued || snapshot.revision !== connection.revision)
          accept(snapshot);
        else status();
        return true;
      } catch (e) {
        if (e.status === 401) {
          oldSignOut();
          delete connection.sessionToken;
          remember();
        }
        status(
          `${navigator.onLine ? "Sync unavailable" : "Offline"} · ${outbox.length} saved change(s) waiting. ${e.status === 401 ? "Sign in again." : e.message}`,
        );
        return false;
      } finally {
        document.body.classList.remove("proto-busy");
        busy = null;
      }
    })();
    return busy;
  }
  async function login(principal, pin) {
    const actor = principal === "parent" ? "parent" : principal;
    if (outbox.some((op) => op.actor !== actor))
      throw Error(
        "Sync queued changes with their original account before switching.",
      );
    const auth = await api("login", { principal, pin }, connection.deviceToken);
    connection = { ...connection, ...auth };
    $p("protoRole").value = principal;
    $p("protoPin").value = "";
    oldSignOut();
    applying = true;
    try {
      const snap = await api("snapshot");
      state = snap.state;
      if (auth.role === "parent") {
        parentMode = true;
        parentChild = null;
        endChildSession();
      } else {
        parentMode = false;
        state.active = auth.member;
        beginChildSession(auth.member);
      }
      baseline = structuredClone(state);
      oldPersist();
      render();
    } finally {
      applying = false;
    }
    remember();
    await sync();
  }
  function syntheticSeed() {
    const seed = structuredClone(state);
    seed.completions = [];
    seed.rewardRequests = [];
    seed.redemptionLog = [];
    seed.pointAdjustments = [];
    seed.timers = [];
    for (const m of seed.members) {
      m.points = 0;
      m.redemptions = 0;
    }
    for (const c of seed.chores) {
      c.timerRequired = false;
      c.minutes = 0;
      c.deadline = null;
      c.dailyLimit = 1;
      c.weeklyLimit = 4;
    }
    return seed;
  }
  async function adoptEmailAccount(result) {
    oldSignOut();
    connection = { ...result };
    parentMode = true;
    parentChild = null;
    endChildSession();
    accept(await api("snapshot"));
    $p("protoRole").value = "parent";
    $p("protoPassword").value = "";
    $p("protoPin").value = "";
    remember();
    status(
      "Signed in as " +
        connection.parentEmail +
        " · This tablet is linked to your test family.",
    );
    return structuredClone(connection);
  }
  async function emailRegister(email,password){
    if(busy||outbox.length)throw Error('Sync saved changes before switching accounts.');
    const result=await cloudSignUp(email,password);if(result.needsFamilySetup||result.confirmationRequired)return result;
    return adoptEmailAccount(result);
  }
  async function emailLogin(email,password){
    if(busy||outbox.length)throw Error('Sync saved changes with their original account first.');
    const result=await cloudSignIn(email,password,connection.deviceToken);if(result.needsFamilySetup)return result;
    return adoptEmailAccount(result);
  }
  async function joinFamily(email,password,code){
    if(busy||outbox.length)throw Error("Sync saved changes before joining a family.");
    return adoptEmailAccount(await cloudJoinFamily(email,password,code,connection.deviceToken));
  }
  async function finishFamilySetup(parentPin,childPin){
    const result=await cloudFinishSetup(syntheticSeed(),parentPin,childPin);return adoptEmailAccount(result);
  }
  async function logout() {
    const token = connection.sessionToken;
    oldSignOut();
    delete connection.sessionToken;
    remember();
    if (token)
      try {
        await api("logout", {}, token);
      } catch {}
    status(
      "Signed out. This tablet remains linked; a parent email/password or account PIN is needed to sign in again.",
    );
  }
  async function create() {
    if (connection.deviceToken)
      throw Error("This test browser is already paired.");
    const seed = structuredClone(state);
    seed.completions = [];
    seed.rewardRequests = [];
    seed.redemptionLog = [];
    seed.pointAdjustments = [];
    seed.timers = [];
    for (const m of seed.members) {
      m.points = 0;
      m.redemptions = 0;
    }
    for (const c of seed.chores) {
      c.timerRequired = false;
      c.minutes = 0;
      c.deadline = null;
      c.dailyLimit = 1;
      c.weeklyLimit = 4;
    }
    const result = await api(
      "families",
      {
        state: seed,
        parentPin: "123456",
        childPins: Object.fromEntries(seed.members.map((m) => [m.id, "1234"])),
      },
      null,
    );
    connection = { ...result };
    $p("protoCode").textContent = result.pairCode;
    remember();
    await login("parent", "123456");
    return result;
  }
  async function pair(code, pin = "123456") {
    if (connection.deviceToken) throw Error("This browser is already paired.");
    connection = await api("pair", { code, parentPin: pin }, null);
    remember();
    return connection;
  }
  async function command(type, data) {
    if (outbox.length && !(await sync()))
      throw Error("Reconnect and sync pending changes first.");
    const result = await api("command", {
      id: operationId(),
      type,
      data,
    });
    if (!result.ok) {
      conflicts.push(result);
      remember();
      throw Error(result.message);
    }
    accept(await api("snapshot"));
    return result;
  }
  // Reward approval is authoritative and online-only. Offline children can still queue requests.
  approveReward = function (id) {
    command("approveReward", { requestId: id }).catch((e) => {
      status("Approval not completed: " + e.message);
    });
  };
  chooseChild = function (id) {
    $p("protoRole").value = id;
    $p("protoPin").value = "";
    $p("protoPin").focus();
    status("Enter the test account PIN above to sign in.");
  };
  chooseParent = function () {
    $p("protoRole").value = "parent";
    $p("protoPin").value = "";
    $p("protoPin").focus();
    status("Enter the test Parent PIN above.");
  };
  const realOpenForm = openForm;
  openForm = function (type, id) {
    if (type === "member" || !id) {
      toast(
        "Adding accounts, chores and rewards is outside this test prototype.",
      );
      return;
    }
    realOpenForm(type, id);
    if (type === "chore") {
      $("timerRequired").disabled = true;
      $("minutes").disabled = true;
    }
  };
  document.addEventListener(
    "click",
    (e) => {
      const button = e.target.closest("button");
      if (!button) return;
      const d = button.dataset;
      if (
        d.delete ||
        d.removeReward ||
        d.override ||
        button.id === "openBackupMenu"
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toast("This action is outside the local sync prototype.");
      }
    },
    true,
  );
  function action(fn) {
    return () =>
      Promise.resolve()
        .then(fn)
        .catch((e) => {
          status(e.message);
          $p("protoPassword").value = "";
        });
  }
  $p("protoEmailRegister").onclick = action(() =>
    emailRegister($p("protoEmail").value, $p("protoPassword").value),
  );
  $p("protoEmailLogin").onclick = action(() =>
    emailLogin($p("protoEmail").value, $p("protoPassword").value),
  );
  $p("protoEmailLogout").onclick = action(logout);
  $("signOut").onclick = action(logout);
  $("switchAccount").onclick = action(logout);
  $p("protoCreate").onclick = action(create);
  $p("protoPair").onclick = action(() =>
    pair($p("protoPairCode").value.trim()),
  );
  $p("protoLogin").onclick = action(() =>
    login($p("protoRole").value, $p("protoPin").value),
  );
  $p("protoSync").onclick = action(sync);
  $p("protoNewCode").onclick = action(async () => {
    const result = await api("pairing-code", {});
    $p("protoCode").textContent = result.pairCode;
    return result;
  });
  window.addEventListener("online", () => {
    if (!manual) sync();
  });
  window.addEventListener("offline", () => status());
  if (connection.role === "parent") {
    delete connection.sessionToken;
    parentMode = false;
    endChildSession();
    remember();
    render();
  }
  setInterval(() => {
    if (
      !manual &&
      navigator.onLine &&
      !document.hidden &&
      connection.sessionToken &&
      !document.querySelector("dialog[open]")
    )
      sync();
  }, 5000);
  window.prototypeSync = {
    create,
    pair,
    login,
    sync,
    command,
    api,
    emailRegister,
    emailLogin,
    joinFamily,
    finishFamilySetup,
    cancelSetup:()=>{pendingParentAuth=null},
    requestPasswordReset:cloudResetEmail,
    completePasswordReset:cloudResetPassword,
    logout,
    get connection() {
      return structuredClone(connection);
    },
    get outbox() {
      return structuredClone(outbox);
    },
    get conflicts() {
      return structuredClone(conflicts);
    },
  };
  $p("protoRole").value = connection.member || "parent";
  if (connection.parentEmail) $p("protoEmail").value = connection.parentEmail;
  status();
})();
