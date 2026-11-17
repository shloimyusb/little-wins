/* Second-parent invitations. No email password, JWT, or invitation is persisted. */
(()=>{
 const $=id=>document.getElementById(id),sync=window.prototypeSync;
 const join=document.createElement('div');
 join.innerHTML='<button type="button" id="welcomeJoin" class="text-btn">Join an existing family</button><p id="welcomeJoinHelp" hidden>First create and confirm your own parent account using Create account above. Then return here with the invitation code. Do not set up a new family.</p>';
 $('welcomeForm').append(join);
 const wrap=document.createElement('div');wrap.id='joinCodeWrap';wrap.hidden=true;
 wrap.innerHTML='<label for="joinCode">Invitation code</label><input id="joinCode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" disabled>';
 $('welcomeSubmit').before(wrap);
 $('welcomeJoin').onclick=()=>window.showParentJoin();
 const section=document.createElement('section');section.id='parentAccess';
 section.innerHTML='<h3>Parent email access</h3><p>Two parent emails can share this family and its parent PIN. Each uses their own email password.</p><div id="parentEmails"></div><form id="parentInviteForm"><label for="otherParentEmail">Other parent’s email</label><input id="otherParentEmail" type="email" autocomplete="email" required maxlength="254"><button type="submit" class="primary">Create invitation</button></form><p id="parentAccessMessage" role="status"></p><div id="parentInviteCodeWrap" hidden><label for="parentInviteCode">Invitation code — share privately with the other parent</label><textarea id="parentInviteCode" rows="3" readonly></textarea><p>Expires in 24 hours. The other parent creates and confirms their own email account, then chooses Join an existing family and enters this code. No invitation email is sent automatically.</p></div><button type="button" id="parentInviteCancel" class="text-btn" hidden>Cancel invitation</button><button type="button" id="parentRemove" class="text-btn" hidden>Remove second parent</button>';
 $('familySetParentPin').after(section);
 let busy=false;
 async function refresh(){
  $('parentInviteCode').value='';$('parentInviteCodeWrap').hidden=true;$('parentAccessMessage').textContent='';
  try{
   const r=await sync.api('parents/list');
   if(!r.ok)throw Error('Parent email access needs the second-parent database update.');
   $('parentEmails').replaceChildren(...r.parents.map(p=>{
    const row=document.createElement('form'),label=document.createElement('label'),select=document.createElement('select'),button=document.createElement('button');
    label.textContent=p.email+' — display name';select.setAttribute('aria-label','Display name for '+p.email);
    for(const name of ['Parent','Mommy','Totty']){const option=document.createElement('option');option.value=name;option.textContent=name;option.disabled=name==='Parent';select.append(option);}
    select.value=p.label||'Parent';button.type='submit';button.className='text-btn';button.textContent='Save name';
    label.append(select);row.append(label,button);row.onsubmit=e=>{e.preventDefault();run('parents/label',{parentId:p.parentId,label:select.value});};return row;
   }));
   $('parentInviteForm').hidden=r.parents.length>=2;$('parentRemove').hidden=r.parents.length<2;
   $('parentInviteCancel').hidden=!r.invitation;
   if(r.invitation)$('parentAccessMessage').textContent='An invitation is waiting for '+r.invitation.email+'. Create a new invitation if you need a new code.';
  }catch(e){$('parentAccessMessage').textContent=e.message;}
 }
 async function run(action,data){
  if(busy)return;busy=true;
  for(const b of section.querySelectorAll('button'))b.disabled=true;
  try{
   const r=await sync.api(action,data);if(!r.ok)throw Error(r.message);
   await refresh();
   if(r.code){$('parentInviteCode').value=r.code;$('parentInviteCodeWrap').hidden=false;$('parentAccessMessage').textContent='Invitation created for '+r.email+'.';}
   else if(action==='parents/label'){await sync.sync();window.tabletPreview?.refresh();$('parentAccessMessage').textContent='Parent name saved. New point adjustments will show this name to the kids.';}
   else $('parentAccessMessage').textContent=action==='parents/remove'?'Second parent removed. Their linked devices can no longer access this family.':'Invitation canceled.';
  }catch(e){$('parentAccessMessage').textContent=e.message;}
  finally{busy=false;for(const b of section.querySelectorAll('button'))b.disabled=false;}
 }
 $('parentInviteForm').onsubmit=e=>{e.preventDefault();run('parents/invite',{email:$('otherParentEmail').value});};
 $('parentInviteCancel').onclick=()=>run('parents/cancel',{});
 $('parentRemove').onclick=()=>{if(confirm('Remove the second parent and revoke their linked devices? The original parent and family progress will remain.'))run('parents/remove',{});};
 $('previewFamily').addEventListener('click',()=>{if(parentMode)refresh();});
 $('tabletSyncDialog').addEventListener('close',()=>{$('parentInviteCode').value='';$('parentInviteCodeWrap').hidden=true;});
})();
