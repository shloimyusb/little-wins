/* Full parent creation and late-completion approval, with authoritative commands. */
(()=>{
 const sync=window.prototypeSync;let busy=false;
 const pinField=document.createElement('label');pinField.textContent='Child PIN (at least 4 digits)';pinField.hidden=true;
 const pin=document.createElement('input');pin.id='newMemberPin';pin.type='password';pin.inputMode='numeric';pin.autocomplete='new-password';pin.pattern='[0-9]{4,32}';pin.minLength=4;pin.maxLength=32;pin.disabled=true;pinField.append(pin);$('formSave').parentElement.before(pinField);
 const oldOpen=openForm;openForm=function(type,id){oldOpen(type,id);pinField.hidden=type!=='member';pin.disabled=type!=='member';pin.required=type==='member';pin.value='';if(type==='chore'){$('timerRequired').disabled=false;$('minutes').max=120;updateTimerField();}};
 $('modal').addEventListener('close',()=>pin.value='');
 $('form').addEventListener('submit',async event=>{
  if(editing)return;event.preventDefault();event.stopImmediatePropagation();if(busy)return;
  if(!parentMode||sync.connection.role!=='parent'){toast('Sign in as Parent first.');return;}
  if(!navigator.onLine){toast('Connect to the internet to add this item.');return;}
  if(!$('form').reportValidity())return;
  const type=kind==='member'?'addMember':kind==='chore'?'addChore':'addReward',name=$('name').value.trim();let data={id:crypto.randomUUID(),name};
  if(kind==='member'){data.pin=pin.value;}
  else{
   const cap=id=>$(id).value.trim()===''?null:Number($(id).value);
   const patch={name,points:Number($('value').value),icon:chosenIcon,detail:kind==='chore'?'Home · A little helping hand':$('rewardDetail').value.trim()||'A well-earned little reward',dailyLimit:cap('dailyLimit'),weeklyLimit:cap('weeklyLimit')};
   if(kind==='chore')Object.assign(patch,{timerRequired:$('timerRequired').checked,minutes:$('timerRequired').checked?Number($('minutes').value):0,deadline:$('deadline').value||null});
   data={id:data.id,member:$(kind==='chore'?'choreMember':'rewardMember').value,patch};
  }
  busy=true;$('formSave').disabled=true;
  try{await sync.command(type,data);$('modal').close();window.tabletPreview?.refresh();toast(kind==='member'?'Child added. They can sign in with their new PIN.':'Saved and synced.');}
  catch(e){toast(e.message);}finally{busy=false;$('formSave').disabled=false;pin.value='';}
 },true);
 document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b?.dataset.override)return;event.preventDefault();event.stopImmediatePropagation();if(busy)return;
  if(!parentMode||sync.connection.role!=='parent'){toast('Sign in as Parent first.');return;}
  if(!navigator.onLine){toast('Connect to the internet to approve this completion.');return;}
  if(!confirm('Count this late chore on its original day and award its points?'))return;
  busy=true;b.disabled=true;
  try{await sync.command('overrideDeadline',{completionId:b.dataset.override});render();toast('Chore counted and points awarded.');}catch(e){await sync.sync();toast(e.message);}finally{busy=false;b.disabled=false;}
 },true);
})();
