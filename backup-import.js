/* The .lwb password and decrypted native preferences stay in browser memory.
   Only reviewed family data and PIN verifiers go to the authenticated family. */
(()=>{
 const sync=window.prototypeSync,$=id=>document.getElementById(id);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
 const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const text=(v,max,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0);
 const fail=message=>{throw Error(message);};
 const day=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
 const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 function primitives(value){
  if(!object(value))fail('A backup record is invalid.');
  for(const [key,v] of Object.entries(value)){
   if(['__proto__','constructor','prototype'].includes(key)||v!==null&&(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isSafeInteger(v)||typeof v==='string'&&v.length>(key==='icon'?18000:500)))fail('An unsupported backup record was found. Nothing has been replaced.');
  }
  return clone(value);
 }
 function decode(value){if(typeof value!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('Invalid encrypted backup encoding.');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
 async function unlock(file,password){
  if(!file||file.size>16000000)fail('Choose an original Little Wins .lwb backup smaller than 16 MB.');
  const box=JSON.parse(await file.text());
  if(box.format!=='little-wins-encrypted-backup'||box.version!==1||box.algorithm!=='PBKDF2-SHA256/AES-256-GCM'||box.iterations!==150000)fail('This is not a supported Little Wins encrypted backup.');
  const salt=decode(box.salt),iv=decode(box.nonce),encrypted=decode(box.ciphertext);
  if(salt.length!==16||iv.length!==12||encrypted.length<16)fail('The encrypted backup is incomplete.');
  let plain;const secret=new TextEncoder().encode(password);
  try{
   const material=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveKey']);
   const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
   try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,tagLength:128},key,encrypted));}catch{fail('Unable to unlock the backup. Check its export password; a damaged or modified file also cannot be opened.');}
   return normalize(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));
  }finally{secret.fill(0);plain?.fill(0);}
 }
 function normalize(payload){
  if(!object(payload)||payload.format!=='little-wins-full-backup'||payload.version!==1||!integer(payload.createdAt,1,9007199254740991)||!object(payload.storage)||typeof payload.storage['little-wins-v1']!=='string'||!object(payload.pinSettings))fail('The unlocked file is not a complete tablet backup.');
  const source=JSON.parse(payload.storage['little-wins-v1']),s={},warnings=[];
  if(!object(source))fail('Missing family data.');
  for(const k of ['members','chores','rewards','completions','redemptionLog','rewardRequests','pointAdjustments','timers','archivedMembers']){
   const value=source[k]??(['pointAdjustments','archivedMembers','timers','redemptionLog','rewardRequests'].includes(k)?[]:null);
   if(!Array.isArray(value)||value.length>10000)fail('Invalid or oversized '+k+' collection.');s[k]=clone(value);
  }
  if(s.members.length<1||s.members.length>20||s.chores.length>1000||s.rewards.length>1000)fail('This preview supports up to 20 children and 1,000 chores/rewards.');
  const ids=new Set();
  for(const k of ['members','archivedMembers'])s[k]=s[k].map(m=>{
   m=primitives(m);if(!id(m.id)||ids.has(m.id)||!text(m.name,100)||!integer(m.points,-1000000000,1000000000)||!integer(m.redemptions??0,0,1000000))fail('Invalid or duplicate child profile.');ids.add(m.id);m.redemptions??=0;
   for(const f of ['icon','theme','timerSound'])if(m[f]!=null&&!(f==='icon'&&typeof m[f]==='string'&&m[f].length<=18000&&/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(m[f]))&&!text(m[f],100,true))fail('Invalid child profile setting.');return m;
  });
  const activeIds=new Set(s.members.map(m=>m.id));s.active=activeIds.has(source.active)?source.active:s.members[0].id;
  for(const k of ['chores','rewards']){
   const seen=new Set();s[k]=s[k].map(item=>{
    item=primitives(item);if(!id(item.id)||seen.has(item.id)||!activeIds.has(item.member)||!text(item.name,100)||!integer(item.points,1,10000))fail('Invalid, shared, or duplicate chore/reward. Open an older backup in the latest tablet app and export it again.');seen.add(item.id);
    for(const f of ['dailyLimit','weeklyLimit']){if(item[f]==null)item[f]=f==='dailyLimit'&&k==='chores'&&!Object.hasOwn(item,f)?1:null;else if(!integer(item[f],0,1000))fail('Invalid daily or weekly limit.');}
    if(!text(item.icon??'',100,true)||!text(item.detail??'',500,true))fail('Invalid chore/reward text.');
    if(k==='chores'){
     item.timerRequired=item.timerRequired??Number(item.minutes)>0;item.minutes=item.minutes??0;
     if(typeof item.timerRequired!=='boolean'||!integer(item.minutes,0,120)||item.timerRequired&&item.minutes<1)fail('A chore timer is outside the supported 1–120 minute range. Nothing has been replaced.');
     item.deadline??=null;if(item.deadline!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.deadline))fail('Invalid chore deadline.');
    }
    item.syncVersion=1;return item;
   });
  }
  for(const k of ['completions','redemptionLog','rewardRequests','pointAdjustments','timers']){
   const seen=new Set();s[k]=s[k].map((entry,i)=>{
    entry=primitives(entry);if(!id(entry.member))fail('Invalid history account.');
    if(k!=='redemptionLog'){entry.id??='import-'+k+'-'+i;if(!id(entry.id)||seen.has(entry.id))fail('Duplicate history identifier.');seen.add(entry.id);}
    if(k==='pointAdjustments'){if(!integer(entry.delta,-10000,10000)||!entry.delta||!text(entry.reason,300))fail('Invalid point adjustment.');}
    else if(!integer(entry.points,1,10000))fail('Invalid historical points.');
    if(k==='rewardRequests'||k==='redemptionLog'){
     const at=k==='rewardRequests'?entry.requestedAt:entry.at;if(!integer(at,1,9007199254740991))fail('Invalid reward history timestamp.');entry.day??=day(at);
    }
    if(!validDay(entry.day))fail('Invalid historical date.');
    if(k==='rewardRequests'&&!['pending','approved','declined'].includes(entry.status))fail('Invalid reward request.');
    if(k==='timers'){
     if(!activeIds.has(entry.member)||!s.chores.some(c=>c.id===entry.chore&&c.member===entry.member)||!integer(entry.minutes,1,120)||!integer(entry.ends,1,9007199254740991))fail('Invalid saved timer.');
     const remaining=entry.pausedRemainingMs??Math.max(0,entry.ends-payload.createdAt);
     if(!integer(remaining,0,7200000))fail('Invalid remaining timer duration.');
     entry.version=1;entry.ends=payload.createdAt+remaining;entry.rang=false;delete entry.serverEnds;
     if(remaining>0)entry.pausedRemainingMs=remaining;else delete entry.pausedRemainingMs;
    }
    return entry;
   });
  }
  if(s.timers.some(t=>!t.completed))warnings.push('Unfinished timers will transfer paused with the time remaining at backup creation. Timers already finished remain ready to check off.');
  if(source.parentTheme!=null){if(!text(source.parentTheme,100))fail('Invalid parent theme.');s.parentTheme=source.parentTheme;}
  const pins={};
  for(const principal of ['parent',...s.members.map(m=>m.id)]){
   const prefix=principal==='parent'?'parent':'child-'+principal,p=payload.pinSettings;
   if(!p[prefix+'hash']&&!p[prefix+'salt']&&principal!=='parent'){pins[principal]={scheme:'needs-pin'};warnings.push(s.members.find(m=>m.id===principal).name+' has no tablet PIN saved. Set a child PIN in the parent dashboard after importing.');continue;}
   const hash=p[prefix+'hash'],salt=p[prefix+'salt'],length=p[prefix+'length']??0;
   if(typeof hash!=='string'||decode(hash).length!==32||!text(salt,200)||!integer(length,0,32))fail('Invalid original PIN settings.');
   pins[principal]={scheme:'legacy-sha256',hash,salt,length};
  }
  if(new TextEncoder().encode(JSON.stringify({state:s,pins})).length>1800000)fail('This backup is larger than this preview’s import limit. Nothing has been replaced.');
  return {state:s,pins,warnings,createdAt:payload.createdAt};
 }
 window.tabletBackupImport={unlock,normalize};if(!window.document)return;
 const modal=document.createElement('dialog');modal.id='backupImportDialog';modal.className='preview-dialog';modal.style.width='min(760px,94vw)';
 modal.innerHTML='<h2>Import tablet backup</h2><p>Your backup password is used on this device only. Review the contents before replacing your synced family data. Your tablet app and original backup file stay unchanged.</p><form id="backupUnlockForm"><label>Backup file<input id="tabletBackupFile" type="file" accept=".lwb,application/octet-stream,application/json" required></label><label>Backup password<input id="tabletBackupPassword" type="password" autocomplete="off" required></label><label class="show-pin"><input id="tabletBackupShow" type="checkbox">Show password</label><button id="backupReviewButton" class="primary" type="submit">Unlock and review</button></form><section id="backupImportReview" hidden><h3>Review before replacing synced data</h3><p id="backupFileDate"></p><div id="backupCompare"></div><ul id="backupWarnings"></ul><p>Your parent emails and Mommy/Totty display names stay linked. Tablet PINs replace the current app PINs. Other devices will need to sign in again. New changes made elsewhere will stop this import until you review again.</p><label class="show-pin"><input id="backupReplaceConsent" type="checkbox">I understand this replaces the synced family’s current settings and progress.</label><button id="backupApplyButton" type="button" class="primary">Replace synced data</button></section><p id="backupImportMessage" role="status"></p><div class="actions"><button id="backupUndoButton" type="button" class="text-btn" hidden>Undo last import</button><button id="backupImportClose" type="button" class="text-btn">Close</button></div>';
 document.body.append(modal);
 const launch=document.createElement('button');launch.id='importTabletBackup';launch.type='button';launch.className='text-btn';launch.textContent='Import tablet backup';$('familySetParentPin').after(launch);
 let pending=null,busy=false,session=null,lastStatus=null;
 const message=(value)=>$('backupImportMessage').textContent=value;
 function lock(value){busy=value;for(const b of modal.querySelectorAll('button'))b.disabled=value;}
 function clear(){pending=null;$('tabletBackupPassword').value='';$('tabletBackupFile').value='';$('backupReplaceConsent').checked=false;$('backupImportReview').hidden=true;}
 function check(){if(!parentMode||!session||sync.connection.sessionToken!==session)fail('Sign in as Parent again before importing.');if(sync.outbox.length)fail('Sync queued changes before importing.');}
 async function status(){lastStatus=await sync.api('backup/status');$('backupUndoButton').hidden=!lastStatus.canUndo;return lastStatus;}
 async function open(){
  if(!parentMode||sync.connection.role!=='parent')return;
  clear();session=sync.connection.sessionToken;message('');$('tabletBackupPassword').type='password';$('tabletBackupShow').checked=false;modal.showModal();
  try{await status();}catch{message('The backup-import database update must be installed in Supabase before transferring any data.');}
 }
 launch.onclick=open;
 $('openBackupMenu').onclick=open;
 $('tabletBackupShow').onchange=()=>{$('tabletBackupPassword').type=$('tabletBackupShow').checked?'text':'password';};
 $('tabletBackupFile').onchange=()=>{pending=null;$('backupImportReview').hidden=true;$('backupReplaceConsent').checked=false;};
 function review(value,current){
  const content=$('backupCompare');content.replaceChildren();
  for(const m of value.state.members){
   const existing=current.members.find(p=>p.id===m.id),detail=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
   summary.textContent=m.name+': tablet balance '+m.points+' points · synced balance '+(existing?existing.points:'new profile');
   for(const [collection,label] of [['chores','Chore'],['rewards','Reward']])for(const item of value.state[collection].filter(i=>i.member===m.id)){
    const li=document.createElement('li');li.textContent=label+': '+item.name+' — '+item.points+' points'+(collection==='chores'?(item.timerRequired?' · '+item.minutes+' minute timer':' · no timer'):'')+' · daily max '+(item.dailyLimit??'unlimited')+' · weekly max '+(item.weeklyLimit??'unlimited')+(item.deadline?' · due '+item.deadline:'');list.append(li);
   }
   const history=document.createElement('p');history.textContent=value.state.completions.filter(c=>c.member===m.id).length+' chore records · '+value.state.redemptionLog.filter(c=>c.member===m.id).length+' rewards received · '+value.state.pointAdjustments.filter(c=>c.member===m.id).length+' point adjustments';detail.append(summary,history,list);content.append(detail);
  }
  $('backupFileDate').textContent='Backup created '+new Date(value.createdAt).toLocaleString()+'. '+value.state.rewardRequests.filter(q=>q.status==='pending').length+' pending reward requests will transfer.';
  $('backupWarnings').replaceChildren(...value.warnings.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));$('backupImportReview').hidden=false;
 }
 $('backupUnlockForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;lock(true);pending=null;$('backupReplaceConsent').checked=false;$('backupImportReview').hidden=true;message('Unlocking on this device…');
  try{
   check();const value=await unlock($('tabletBackupFile').files[0],$('tabletBackupPassword').value);check();
   if(!(await sync.sync()))fail('Reconnect and sync before reviewing an import.');check();
   const snapshot=await sync.api('snapshot'),ready=await status();
   pending={...value,expectedRevision:snapshot.revision,operationId:crypto.randomUUID()};review(value,snapshot.state);message('Review only: nothing has been replaced.');
  }catch(error){message(error.message);}finally{$('tabletBackupPassword').value='';lock(false);}
 };
 $('backupApplyButton').onclick=async()=>{
  if(busy)return;if(!pending)return message('Unlock and review a backup first.');if(!$('backupReplaceConsent').checked)return message('Check the confirmation box before replacing synced data.');
  lock(true);message('Importing the reviewed data…');
  try{
   check();const result=await sync.api('backup/restore',{state:pending.state,pins:pending.pins,expectedRevision:pending.expectedRevision,operationId:pending.operationId});
   if(!result.ok)fail(result.message);clear();await sync.sync();window.tabletPreview?.refresh();await status();message('Import completed. Review the balances and history. Other devices must refresh the app and sign in again. Undo is available here until new progress or settings changes are made.');
  }catch(error){message(error.message+' If the connection failed, reconnect and check current progress before retrying.');}finally{lock(false);}
 };
 $('backupUndoButton').onclick=async()=>{
  if(busy||!confirm('Undo the last import and restore the synced settings, progress and app PINs from just before it?'))return;
  lock(true);
  try{check();const ready=await status();const result=await sync.api('backup/undo',{checkpointId:ready.checkpointId,expectedRevision:ready.revision,operationId:crypto.randomUUID()});if(!result.ok)fail(result.message);clear();await sync.sync();await status();message('Import undone. The previous synced progress and PINs have been restored.');}catch(error){message(error.message);}finally{lock(false);}
 };
 $('backupImportClose').onclick=()=>{if(!busy)modal.close();};modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();});modal.addEventListener('close',clear);
 // Test hooks expose pure format/decryption functions only, never a loaded family or PIN verifier.
 window.tabletBackupImport={unlock,normalize};
})();
