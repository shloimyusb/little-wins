/* Synchronized server timers: changes require a connection; countdowns remain local. */
(()=>{
 const sync=window.prototypeSync;let pending=false;
 const heard=new Set(JSON.parse(sessionStorage.getItem('little-wins-timer-alarms')||'[]'));
 window.projectServerTimers=(timers,offset)=>timers.map(t=>({...t,serverEnds:t.ends,ends:t.ends-offset,rang:heard.has(t.id)}));
 for(const t of state.timers)t.rang=heard.has(t.id);window.serverTimerAlarmReady=true;
 window.refreshServerTimerClock=offset=>{for(const t of state.timers)if(Number.isFinite(t.serverEnds))t.ends=t.serverEnds-offset;};
 const oldPersist=persist;
 persist=function(){for(const t of state.timers)if(t.rang)heard.add(t.id);sessionStorage.setItem('little-wins-timer-alarms',JSON.stringify([...heard].slice(-500)));return oldPersist();};
 const oldOpenForm=openForm;
 openForm=function(type,id){oldOpenForm(type,id);if(type==='chore'&&window.timerSyncVersion===1){$('timerRequired').disabled=false;$('minutes').max=120;updateTimerField();}};
 async function act(button){
  if(pending)return;
  if(!navigator.onLine){toast('Connect to the internet to change or check off a synchronized timer.');return;}
  if(window.timerSyncVersion!==1){toast('The timer-sync database update is required.');return;}
  if(checkChildSession()||!sync.connection.sessionToken||(!parentMode&&childSession!==state.active)){toast('Sign in again before using this timer.');return;}
  pending=true;button.disabled=true;
  try{
   // Reconcile queued unrelated edits before constructing a version-checked timer command.
   if(!(await sync.sync()))throw Error('Reconnect and sync before changing the timer.');
   const d=button.dataset,member=state.active;let type,data;
   if(d.start){const c=state.chores.find(c=>c.id===d.start);if(!c)throw Error('Chore was removed.');type='startTimer';data={member,chore:c.id,choreVersion:c.syncVersion};
    try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();audioCtx.resume();}catch{}
   }else{
    const t=state.timers.find(t=>t.id===(d.cancelTimer||d.togglePause)||d.complete&&t.chore===d.complete&&t.member===member);
    if(!t)throw Error('Timer was completed or canceled on another device.');
    type=d.cancelTimer?'cancelTimer':d.togglePause?(timerPaused(t)?'resumeTimer':'pauseTimer'):'completeChore';
    if(type==='cancelTimer'&&!confirm('Cancel this chore timer? No points will be awarded.'))return;
    data={member,timerId:t.id,timerVersion:t.version};
    if(type==='completeChore'){const c=state.chores.find(c=>c.id===t.chore);data={...data,chore:t.chore,choreVersion:c.syncVersion,completionId:crypto.randomUUID(),day:today(),completedAt:Date.now()};}
   }
   await sync.command(type,data);
   if(type==='pauseTimer'||type==='cancelTimer')childSessionUntil=Date.now()+5*60000;
   if(type==='completeChore')childSessionUntil=Math.max(childSessionUntil,Date.now()+2*60000);
   extendChildSession();render();toast(type==='completeChore'?'Chore checked off.':type==='cancelTimer'?'Timer canceled.':type==='pauseTimer'?'Timer paused on all devices.':type==='resumeTimer'?'Timer resumed on all devices.':'Timer started.');
  }catch(error){await sync.sync();toast(error.message);}
  finally{pending=false;button.disabled=false;}
 }
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;const d=b.dataset;
  const timedComplete=d.complete&&(state.chores.some(c=>c.id===d.complete&&c.timerRequired!==false)||state.timers.some(t=>t.chore===d.complete&&t.member===state.active&&!t.completed));
  if(!d.start&&!d.cancelTimer&&!d.togglePause&&!timedComplete)return;
  event.preventDefault();event.stopImmediatePropagation();act(b);
 },true);
 // Polling resumes promptly after sleep/backgrounding. Server time corrects device clock drift.
 if(navigator.onLine&&sync.connection.sessionToken)sync.sync();
 window.addEventListener('focus',()=>{if(navigator.onLine&&sync.connection.sessionToken)sync.sync();});
})();
