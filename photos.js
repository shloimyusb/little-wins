/* Photos are cropped/re-encoded locally; only the small JPEG icon is synced. */
(()=>{
 const valid=value=>typeof value==='string'&&value.length<=18000&&/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value);
 const oldMarkup=iconMarkup;iconMarkup=function(value){return valid(value)?'<img class="child-photo" src="'+value+'" alt="Profile photo">':oldMarkup(value);};
 const style=document.createElement('style');style.textContent='.child-photo{width:1.65em;height:1.65em;border-radius:50%;object-fit:cover;vertical-align:middle;display:inline-block}.account-avatar .child-photo,.manage-icon .child-photo{width:100%;height:100%}.photo-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.photo-actions button{min-height:44px}#photoCameraDialog{width:min(480px,94vw)}#photoCameraDialog video{width:100%;max-height:50vh;object-fit:cover;border-radius:14px;background:#222}#photoCameraDialog p{line-height:1.5}';document.head.append(style);
 const actions=document.createElement('div');actions.className='photo-actions';
 const camera=document.createElement('button'),choose=document.createElement('button'),input=document.createElement('input'),note=document.createElement('p');
 camera.type=choose.type='button';camera.textContent='Take a photo';choose.textContent='Choose a photo';camera.id='takeProfilePhoto';choose.id='chooseProfilePhoto';
 input.type='file';input.accept='image/*';input.hidden=true;note.setAttribute('role','status');note.id='profilePhotoStatus';
 actions.append(camera,choose,input);$('profileIconChoices').before(actions,note);
 const dialog=document.createElement('dialog');dialog.id='photoCameraDialog';dialog.innerHTML='<h2>Your profile photo</h2><p>Center your face. The photo will be cropped to a square.</p><video autoplay muted playsinline></video><p role="status" id="photoCameraStatus"></p><div class="photo-actions"><button type="button" id="captureProfilePhoto" class="primary" disabled>Use this photo</button><button type="button" id="closeProfileCamera">Cancel</button></div>';
 document.body.append(dialog);const video=dialog.querySelector('video');let stream=null,owner=null,sequence=0,busy=false;
 function authorized(){return owner&&childSession===owner&&profileIconMember===owner&&state.active===owner&&!parentMode&&Date.now()<childSessionUntil&&$('profileIconDialog').open;}
 function stop(){sequence++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;$('captureProfilePhoto').disabled=true;}
 function error(e){note.textContent=e?.name==='NotAllowedError'?'Camera permission was denied. Allow it in device settings, or choose a photo.':e?.message||'Unable to open this photo. Try another one.';}
 async function prepare(source,w,h){
  if(!authorized())throw Error('Sign in again before changing the photo.');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d'),side=Math.min(w,h);if(!side)throw Error('The photo is not ready yet.');
  ctx.drawImage(source,(w-side)/2,(h-side)/2,side,side,0,0,128,128);
  let photo;for(const quality of [.8,.65,.5,.35]){photo=canvas.toDataURL('image/jpeg',quality);if(valid(photo))break;}
  if(!valid(photo))throw Error('This photo could not be made small enough. Try another photo.');
  if(!authorized())return;profileIconChoice=photo;renderProfileIcons();note.textContent='Photo ready. Tap Save to use it. Choose an icon below to replace it.';
 }
 choose.onclick=()=>{owner=childSession;input.value='';input.click();};
 input.onchange=async()=>{const file=input.files[0];if(!file)return;if(file.size>20000000){error(Error('Choose a photo smaller than 20 MB.'));return;}let image;try{image=await createImageBitmap(file,{imageOrientation:'from-image'});await prepare(image,image.width,image.height);}catch(e){error(e);}finally{image?.close();input.value='';}};

 camera.onclick=async()=>{
  owner=childSession;note.textContent='';if(!authorized())return;
  if(!navigator.mediaDevices?.getUserMedia){input.setAttribute('capture','user');input.value='';input.click();return;}
  stop();const request=sequence;dialog.showModal();$('photoCameraStatus').textContent='Opening camera…';
  try{const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:640}},audio:false});
   if(request!==sequence||!dialog.open||!authorized()){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;video.srcObject=stream;await video.play();$('captureProfilePhoto').disabled=false;$('photoCameraStatus').textContent='';
  }catch(e){if(request===sequence){dialog.close();error(e);}}
 };
 choose.addEventListener('click',()=>input.removeAttribute('capture'));
 $('captureProfilePhoto').onclick=async()=>{try{await prepare(video,video.videoWidth,video.videoHeight);stop();dialog.close();}catch(e){$('photoCameraStatus').textContent=e.message;}};
 $('closeProfileCamera').onclick=()=>{stop();dialog.close();};dialog.addEventListener('close',stop);
 $('profileIconDialog').addEventListener('close',()=>{stop();if(dialog.open)dialog.close();note.textContent='';owner=null;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();if(dialog.open)dialog.close();}});
 window.addEventListener('pagehide',stop);
 const oldSave=$('saveProfileIcon').onclick;
 $('saveProfileIcon').onclick=async()=>{
  if(!valid(profileIconChoice))return oldSave();if(busy)return;
  owner=profileIconMember;if(!authorized()||checkChildSession()){$('profileIconDialog').close();render();toast('Sign in again before changing the photo.');return;}
  if(!navigator.onLine){note.textContent='Connect to the internet to save and sync your photo.';return;}
  const member=owner,photo=profileIconChoice;busy=true;$('saveProfileIcon').disabled=true;
  try{await window.prototypeSync.command('updateProfile',{member,patch:{icon:photo}});$('profileIconDialog').close();toast('Your profile photo is saved!');}
  catch(e){note.textContent=e.message;}
  finally{busy=false;$('saveProfileIcon').disabled=false;}
 };
 render();window.profilePhotos={valid};
})();
