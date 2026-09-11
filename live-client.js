const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states=['وصلت إلى مخزن المنشأ','غادرت المخزن','وصلت إلى ليبيا','جاهزة للاستلام','تم التسليم'];
let state=null,setup=false;

async function api(path,method='GET',data){
 const r=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await r.json();
 if(!r.ok){if(r.status===401&&path!=='/login'){state=null;$('workspace').hidden=true;$('auth').hidden=false;$('identity').textContent='مرحبًا بك';$('list').innerHTML='';if($('detail').open)$('detail').close()}throw Error(result.error||'تعذّر إكمال العملية.')}
 return result;
}

function notice(message){$('notice').textContent=message}
function tab(name){['ship','ware','manage'].forEach(id=>{$(id).hidden=id!==name;$(id+'-tab').classList.toggle('active',id===name)})}
function filterShipments(){const q=$('search').value.trim().toUpperCase(),country=$('filter-country').value,mode=$('filter-mode').value;return state.shipments.filter(s=>s.id.includes(q)&&(!country||s.country===country)&&(!mode||s.mode===mode))}
function photo(s){return s.hasPhoto?`<div class="shipment-photo"><img src="/api/shipments/${encodeURIComponent(s.id)}/photo?v=${Date.now()}" alt="صورة الشحنة ${esc(s.id)}" loading="lazy"></div>`:'<p class="muted">لم تُضف صورة بعد</p>'}

function renderShipments(){
 const rows=filterShipments();
 if(state.user.role==='customer'){
  const groups=[];
  rows.forEach(s=>{let g=groups.find(x=>x.trip===s.trip&&x.country===s.country&&x.mode===s.mode);if(!g){g={trip:s.trip,country:s.country,mode:s.mode,rows:[]};groups.push(g)}g.rows.push(s)});
  $('list').innerHTML='';
  groups.forEach(g=>{
   const card=document.createElement('article');
   card.innerHTML=`<div class="row"><span class="badge">${esc(g.mode)}</span><span>${esc(g.country)}</span></div><h3>رحلة ${esc(g.trip)}</h3><p class="muted">${g.rows.length} شحنة · اضغط لعرض الشحنات</p><button type="button" class="primary trip-open">عرض شحنات الرحلة</button>`;
   card.querySelector('.trip-open').onclick=()=>openCustomerTrip(g);$('list').appendChild(card);
  });
  if(!groups.length)$('list').innerHTML='<article>لا توجد رحلات أو شحنات تطابق الاختيار.</article>';
  return;
 }
 $('list').innerHTML='';
 rows.forEach(s=>{
  const card=document.createElement('article');
  card.innerHTML=`<div class="row"><span>${esc(s.country)} ← ليبيا · ${esc(s.mode)}</span><span class="badge">${esc(s.status)}</span></div><h3 dir="ltr" class="tracking-title">${esc(s.id)}</h3><p class="muted">الزبون: ${esc(s.customer)} · ${esc(s.weight)}</p>${photo(s)}<div class="progress"><span style="width:${s.step*25}%"></span></div><p>الرحلة: <b dir="ltr">${esc(s.trip)}</b> · الوصول المتوقع: ${esc(s.date)}</p><p><label>الحالة<select class="status">${states.map((x,i)=>`<option value="${i}" ${s.step===i?'selected':''}>${x}</option>`).join('')}</select></label></p><div class="shipment-actions"><button type="button" class="primary detail-button">تفاصيل الشحنة</button><button type="button" class="edit-button">تعديل</button><button type="button" class="danger delete-button">حذف الشحنة</button></div><label class="photo-upload">${s.hasPhoto?'تغيير الصورة':'إضافة صورة'}<input class="photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="صورة الشحنة"></label>`;
  card.querySelector('.detail-button').onclick=()=>details(s);
  card.querySelector('.edit-button').onclick=()=>openEditShipment(s);
  card.querySelector('.delete-button').onclick=()=>deleteShipment(s,card.querySelector('.delete-button'));
  card.querySelector('.status').onchange=async e=>{const old=s.step;e.target.disabled=true;try{await api('/shipments/'+encodeURIComponent(s.id),'PATCH',{step:Number(e.target.value)});await refresh();notice('تم تحديث حالة الشحنة.')}catch(error){e.target.value=String(old);notice(error.message)}finally{e.target.disabled=false}};
  card.querySelector('.photo-input').onchange=e=>upload(s,e.target);$('list').appendChild(card);
 });
 if(!rows.length)$('list').innerHTML='<article>لا توجد شحنات تطابق الاختيار.</article>';
}

function openCustomerTrip(group){
 const d=$('detail');
 d.innerHTML=`<div class="row"><h2>رحلة ${esc(group.trip)}</h2><button type="button" id="close-detail">إغلاق</button></div><p class="muted">${esc(group.country)} · ${esc(group.mode)} · ${group.rows.length} شحنة</p>${group.rows.map(s=>`<article class="shipment-summary"><div class="row"><h3 dir="ltr">${esc(s.id)}</h3><span class="badge">${esc(s.status)}</span></div><p>${esc(s.weight)} · الوصول المتوقع: ${esc(s.date)}</p>${photo(s)}<div class="progress"><span style="width:${s.step*25}%"></span></div></article>`).join('')}`;
 d.querySelector('#close-detail').onclick=()=>d.close();d.showModal();
}

function details(s){
 const d=$('detail');
 d.innerHTML=`<div class="row"><h2 dir="ltr">${esc(s.id)}</h2><button type="button" id="close-detail">إغلاق</button></div>${photo(s)}<p>${esc(s.weight)} · ${esc(s.mode)} · ${esc(s.country)}</p><p>الرحلة: ${esc(s.trip)} · الوصول المتوقع: ${esc(s.date)}</p><ol>${states.map((x,i)=>`<li>${i<=s.step?'✓ ':''}${x}</li>`).join('')}</ol>`;
 d.querySelector('#close-detail').onclick=()=>d.close();d.showModal();
}

async function deleteShipment(s,button){
 if(!window.confirm(`هل تريد حذف الشحنة ${s.id} نهائيًا؟`))return;
 button.disabled=true;
 try{await api('/shipments/'+encodeURIComponent(s.id),'DELETE');await refresh();notice(`تم حذف الشحنة ${s.id}.`)}catch(error){notice(error.message);button.disabled=false}
}

async function upload(s,input){
 const file=input.files[0];if(!file)return;
 if(file.size>5*1024*1024){notice('اختر صورة أقل من 5 ميجابايت.');input.value='';return}
 input.disabled=true;
 try{const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});await api('/shipments/'+encodeURIComponent(s.id)+'/photo','POST',{photo:image});await refresh();notice('تم حفظ الصورة.')}catch(error){notice(error.message||'تعذّر رفع الصورة.')}finally{input.disabled=false;input.value=''}
}

function renderForms(){
 if(state.user.role==='customer'){$('forms').innerHTML='';$('users').innerHTML='';return}
 const customers=state.users.filter(c=>c.role==='customer');
 const trips=state.trips||[];
 $('forms').innerHTML=`${state.user.role==='admin'?`<form id="user-form"><h3>إضافة حساب</h3><label>نوع الحساب<select name="role"><option value="customer">زبون</option><option value="staff">موظف</option></select></label><label>الاسم<input name="name" required maxlength="100" placeholder="اكتب اسم الزبون أو الموظف"></label><label>رقم الهاتف<input name="phone" type="tel" dir="ltr" required maxlength="25" placeholder="مثال: +218912345678" autocomplete="tel"></label><label>الكود<input name="code" placeholder="LN-1000" required pattern="[A-Za-z0-9-]{2,64}" dir="ltr" maxlength="64"></label><label>كلمة المرور<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button class="primary">حفظ الحساب</button><p role="status"></p></form>`:''}<form id="trip-form"><h3>إضافة رحلة</h3><p class="form-note">أنشئ الرحلة أولًا، وبعدها اربط بها شحنات الزبائن.</p><label>رقم الرحلة<input name="trip" required pattern="[A-Za-z0-9-]{2,64}" maxlength="64" dir="ltr" placeholder="مثال: 109"></label><label>الدولة<select name="country"><option>الصين</option><option>الإمارات</option><option>السعودية</option></select></label><label>نوع الشحن<select name="mode"><option>جوي</option><option>بحري</option></select></label><label>تاريخ الوصول المتوقع<input name="date" type="date" required></label><button class="primary">حفظ الرحلة</button><p role="status"></p></form><form id="shipment-form"><h3>إضافة شحنة عميل</h3><p class="form-note">اختَر رحلة محفوظة؛ تاريخ الوصول ينتقل منها تلقائيًا إلى الشحنة.</p><label>الزبون<select name="customer" required>${customers.map(c=>`<option value="${esc(c.code)}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label><label>رقم التتبع<input name="id" placeholder="اكتب رقم تتبع الشحنة" required pattern="[A-Za-z0-9-]{2,64}" dir="ltr" maxlength="64"></label><label>الدولة<select name="country"><option>الصين</option><option>الإمارات</option><option>السعودية</option></select></label><label>نوع الشحن<select name="mode"><option>جوي</option><option>بحري</option></select></label><label>الوزن / الحجم<input type="number" name="weight" required min="0.01" max="100000" step="0.01"></label><label>الوحدة<select name="unit"><option>كجم</option><option>متر مكعب</option></select></label><label>الرحلة<select name="trip" required>${trips.length?trips.map(t=>`<option value="${esc(t.code)}">${esc(t.code)} · ${esc(t.country)} · ${esc(t.mode)} · ${esc(t.date)}</option>`).join(''):'<option value="">أضف رحلة أولًا</option>'}</select></label><label>صورة الشحنة (اختياري)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG أو PNG أو WebP، بحد أقصى 5 ميجابايت.</small></label><button class="primary" ${customers.length&&trips.length?'':'disabled'}>حفظ الشحنة</button><p role="status"></p></form>`;
 if($('user-form'))$('user-form').onsubmit=e=>submitJsonForm(e,'/users','تم إنشاء الحساب.');
 $('trip-form').onsubmit=submitTrip;
 $('shipment-form').onsubmit=submitShipment;
 renderTripControls();
 renderUsers();
}

function renderTripControls(){
 const trips=(state.trips||[]).filter(t=>t.shipmentCount>0);
 if(!trips.length)return;
 const box=document.createElement('form');box.id='trip-status-form';
 box.innerHTML=`<h3>تحديث رحلة كاملة</h3><p class="form-note">غيّر حالة كل شحنات الرحلة لنفس الدولة ونوع الشحن دفعة واحدة.</p><label>الرحلة<select name="group">${trips.map((t,i)=>`<option value="${i}">${esc(t.code)} · ${esc(t.country)} · ${esc(t.mode)} · ${t.shipmentCount} شحنة</option>`).join('')}</select></label><label>الحالة الجديدة<select name="step">${states.map((x,i)=>`<option value="${i}">${x}</option>`).join('')}</select></label><label>تاريخ الوصول المتوقع<input name="date" type="date"></label><p class="form-note" id="trip-count"></p><button class="primary">تحديث الشحنات</button><p role="status"></p>`;
 $('forms').prepend(box);
 const group=box.querySelector('[name=group]'),step=box.querySelector('[name=step]'),date=box.querySelector('[name=date]'),count=box.querySelector('#trip-count');
 const update=()=>{const t=trips[Number(group.value)];count.textContent=`سيتم تحديث ${t.shipmentCount} شحنة.`;step.value=String(t.step||0);date.value=/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')?t.date:''};
 group.onchange=update;update();
 box.onsubmit=async e=>{e.preventDefault();const t=trips[Number(group.value)],button=box.querySelector('button'),feedback=box.querySelector('[role=status]');button.disabled=true;try{const data={trip:t.code,country:t.country,mode:t.mode,step:Number(step.value)};if(date.value)data.date=date.value;const result=await api('/trips/status','PATCH',data);await refresh();notice(`تم تحديث ${result.updatedCount} شحنة في الرحلة ${t.code}.`)}catch(error){feedback.textContent=error.message}finally{button.disabled=false}};
}

async function submitTrip(e){
 e.preventDefault();const form=e.target,button=form.querySelector('button'),feedback=form.querySelector('[role=status]');button.disabled=true;feedback.textContent='';
 try{const data=Object.fromEntries(new FormData(form));await api('/trips','POST',data);form.reset();await refresh();tab('manage');notice('تم حفظ الرحلة. تقدر الآن تختارها عند إضافة الشحنات.')}catch(error){feedback.textContent=error.message}finally{button.disabled=false}
}

async function submitShipment(e){
 e.preventDefault();const form=e.target,button=form.querySelector('button'),feedback=form.querySelector('[role=status]');button.disabled=true;feedback.textContent='';let created=false;
 try{const data=Object.fromEntries(new FormData(form)),file=data.photo;delete data.photo;let image=null;if(file&&file.size){if(file.size>5*1024*1024)throw Error('اختر صورة أقل من 5 ميجابايت.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('اختر صورة JPG أو PNG أو WebP.');image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('تعذّر قراءة الصورة.'));reader.readAsDataURL(file)})}await api('/shipments','POST',data);created=true;if(image){try{await api('/shipments/'+encodeURIComponent(data.id.trim().toUpperCase())+'/photo','POST',{photo:image})}catch(error){form.reset();await refresh();tab('ship');notice('تم حفظ الشحنة، لكن الصورة لم تُحفظ: '+error.message);return}}form.reset();await refresh();tab('ship');notice(image?'تم حفظ الشحنة وصورتها.':'تمت إضافة الشحنة.')}catch(error){if(created)notice('تم الحفظ، لكن تعذّر تحديث العرض. حدّث الصفحة.');else feedback.textContent=error.message}finally{button.disabled=false}
}

function openEditShipment(s){
 const d=$('detail'),customers=state.users.filter(c=>c.role==='customer'),trips=state.trips||[];
 d.innerHTML=`<form class="live-form" id="edit-shipment-form"><div class="row"><h2>تعديل الشحنة</h2><button type="button" id="cancel-edit">إغلاق</button></div><p class="muted" dir="ltr">${esc(s.id)}</p><label>الزبون<select name="customer">${customers.map(c=>`<option value="${esc(c.code)}" ${c.code===s.customer?'selected':''}>${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label><label>رقم التتبع<input name="id" value="${esc(s.id)}" required pattern="[A-Za-z0-9-]{2,64}" maxlength="64" dir="ltr"></label><label>الدولة<select name="country"><option ${s.country==='الصين'?'selected':''}>الصين</option><option ${s.country==='الإمارات'?'selected':''}>الإمارات</option><option ${s.country==='السعودية'?'selected':''}>السعودية</option></select></label><label>نوع الشحن<select name="mode"><option ${s.mode==='جوي'?'selected':''}>جوي</option><option ${s.mode==='بحري'?'selected':''}>بحري</option></select></label><label>الوزن / الحجم<input name="weight" type="number" value="${esc(s.weightValue)}" required min="0.01" max="100000" step="0.01"></label><label>الوحدة<select name="unit"><option ${s.unit==='كجم'?'selected':''}>كجم</option><option ${s.unit==='متر مكعب'?'selected':''}>متر مكعب</option></select></label><label>الرحلة<select name="trip"><option value="لم تُحدد" ${s.trip==='لم تُحدد'?'selected':''}>بدون رحلة</option>${trips.map(t=>`<option value="${esc(t.code)}" ${t.code===s.trip&&t.country===s.country&&t.mode===s.mode?'selected':''}>${esc(t.code)} · ${esc(t.country)} · ${esc(t.mode)} · ${esc(t.date)}</option>`).join('')}</select></label><p class="form-note">تاريخ الوصول يتبع الرحلة المختارة تلقائيًا.</p><p role="status"></p><button class="primary">حفظ التعديل</button></form>`;
 d.querySelector('#cancel-edit').onclick=()=>d.close();
 d.querySelector('#edit-shipment-form').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button[type=submit]')||form.querySelector('.primary'),feedback=form.querySelector('[role=status]');button.disabled=true;try{const data=Object.fromEntries(new FormData(form));await api('/shipments/'+encodeURIComponent(s.id),'PATCH',data);d.close();await refresh();notice('تم تعديل الشحنة.')}catch(error){feedback.textContent=error.message;button.disabled=false}};
 d.showModal();
}

function renderUsers(){
 $('users').innerHTML='';$('users-title').hidden=state.user.role!=='admin';
 if(state.user.role!=='admin')return;
 state.users.filter(c=>c.role!=='admin').forEach(c=>{const card=document.createElement('article');card.innerHTML=`<div class="row"><span>${esc(c.name)} · <b dir="ltr">${esc(c.code)}</b><br><small>${c.role==='staff'?'موظف':'زبون'} · ${c.active?'نشط':'موقوف'}</small><br><span dir="ltr">${esc(c.phone||'')}</span></span><div><button type="button" class="toggle">${c.active?'إيقاف':'تفعيل'}</button> <button type="button" class="reset">تغيير كلمة المرور</button></div></div>`;card.querySelector('.toggle').onclick=async()=>{try{await api('/users/'+encodeURIComponent(c.code),'PATCH',{active:!c.active});await refresh();notice('تم تحديث الحساب.')}catch(error){notice(error.message)}};card.querySelector('.reset').onclick=()=>resetPassword(c);$('users').appendChild(card)});
}

function resetPassword(c){
 const d=$('detail');d.innerHTML=`<form class="live-form" id="password-form"><h2>تغيير كلمة المرور</h2><p dir="ltr">${esc(c.code)}</p><label>كلمة المرور الجديدة<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><p role="status"></p><button class="primary">حفظ</button><button type="button" id="cancel-password">إلغاء</button></form>`;d.querySelector('#cancel-password').onclick=()=>d.close();d.querySelector('#password-form').onsubmit=async e=>{e.preventDefault();const form=e.target;try{await api('/users/'+encodeURIComponent(c.code),'PATCH',Object.fromEntries(new FormData(form)));form.reset();d.close();notice('تم تغيير كلمة المرور وإنهاء جلسات الحساب السابقة.')}catch(error){form.querySelector('[role=status]').textContent=error.message}};d.showModal();
}

async function submitJsonForm(e,path,success){e.preventDefault();const form=e.target,button=form.querySelector('button'),feedback=form.querySelector('[role=status]');button.disabled=true;feedback.textContent='';try{await api(path,'POST',Object.fromEntries(new FormData(form)));form.reset();await refresh();tab('manage');notice(success)}catch(error){feedback.textContent=error.message}finally{button.disabled=false}}

function renderAddresses(){if(state.user.role==='customer')$('address-customer').innerHTML='';else{$('address-customer').innerHTML=`<label>عرض العنوان بكود الزبون <select id="address-code">${state.users.filter(c=>c.role==='customer'&&c.active).map(c=>`<option value="${esc(c.code)}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label>`;if($('address-code'))$('address-code').onchange=e=>{currentCustomer.code=e.target.value;renderWarehouses()}}if(currentCustomer.code)renderWarehouses();else $('warehouses').innerHTML='<article>أضف زبونًا لعرض العنوان بكوده.</article>'}
 async function refresh(){state=await api('/state');$('auth').hidden=true;$('workspace').hidden=false;$('identity').textContent=state.user.name+' · '+state.user.code;$('greeting').textContent=state.user.role==='customer'?'شحناتك، خطوة بخطوة':state.user.role==='staff'?'مساحة الموظف':'لوحة الإدارة';$('manage-tab').hidden=state.user.role==='customer';currentCustomer.code=state.user.role==='customer'?state.user.code:state.users.find(c=>c.role==='customer'&&c.active)?.code||'';renderShipments();renderForms();renderAddresses()}

if($('auth-form'))$('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;try{const data=Object.fromEntries(new FormData(e.target));if(setup){await api('/setup','POST',data);setup=false;$('setup-key').hidden=true;$('setup-name').hidden=true;$('setup-name').querySelector('input').required=false;$('auth-title').textContent='تسجيل الدخول';$('auth-submit').textContent='دخول'}await api('/login','POST',data);e.target.reset();$('auth-message').textContent='';await refresh();tab('ship')}catch(error){$('auth-message').textContent=error.message}finally{$('auth-submit').disabled=false}};
 if($('logout'))$('logout').onclick=async()=>{try{await api('/logout','POST',{});location.reload()}catch(error){notice(error.message)}};
 ['ship','ware','manage'].forEach(name=>$(name+'-tab').onclick=()=>tab(name));
 ['search','filter-country','filter-mode'].forEach(id=>$(id).oninput=renderShipments);
 (async()=>{try{const b=await api('/bootstrap');setup=b.needsSetup;$('setup-key').hidden=!(setup&&b.requiresSetupKey);if(setup){$('auth-title').textContent='إنشاء حساب الإدارة لأول مرة';$('setup-name').hidden=false;$('setup-name').querySelector('input').required=true;$('auth-submit').textContent='إنشاء حساب الإدارة';return}try{await refresh()}catch{$('auth-message').textContent='أدخل كودك وكلمة المرور.'}}catch(error){$('auth-message').textContent=error.message}})();
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 let installPrompt=null;window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install-app').hidden=false});
 $('install-app').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install-app').hidden=true};
 window.addEventListener('appinstalled',()=>{$('install-app').hidden=true;installPrompt=null});
