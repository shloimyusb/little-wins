/* Parent removals are authoritative, version checked and online only. */
(()=>{let pending=false;document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;const d=button.dataset;
 if(!d.delete&&!d.removeReward)return;event.preventDefault();event.stopImmediatePropagation();if(pending)return;
 const sync=window.prototypeSync;if(!parentMode||sync.connection.role!=='parent'){toast('Sign in as Parent to remove items.');return;}
 if(!navigator.onLine){toast('Connect to the internet to remove this item.');return;}
 const isChore=!!d.delete,id=d.delete||d.removeReward,collection=isChore?'chores':'rewards';
 const item=state[collection].find(x=>x.id===id);if(!item)return;
 const question=isChore?'Remove “'+item.name+'”? Its active timer will be canceled. History and earned points will stay.':'Remove “'+item.name+'”? Pending requests will be declined without spending points. Reward history will stay.';
 if(!confirm(question))return;pending=true;button.disabled=true;
 try{await sync.command(isChore?'removeChore':'removeReward',{id,version:item.syncVersion});render();toast(isChore?'Chore removed. History and points kept.':'Reward removed. History and points kept.');}
 catch(e){await sync.sync();toast(e.message);}finally{pending=false;button.disabled=false;}
 },true);})();
