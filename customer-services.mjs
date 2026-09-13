let app,actor='',sequence={unknown:0,delivery:0};
const pages={unknown:{offset:0,status:'unresolved'},delivery:{offset:0,status:''}};
const $=id=>document.getElementById(id),state=()=>app.getState(),e=v=>app.esc(v??'');
const statuses={pending:'طلب جديد',accepted:'قيد التنسيق',closed:'مغلق',cancelled:'ملغي'};
const date=v=>new Date(v).toLocaleString('ar-LY');
const option=(v,t)=>`<option value="${e(v)}">${e(t)}</option>`;
export function init(context){app=context;const css=document.createElement('link');css.rel='stylesheet';css.href='/customer-services.css';document.head.append(css)}
export function allowed(name,role){return name==='unknown'?['admin','staff','warehouse'].includes(role):name==='delivery'?['admin','staff','customer'].includes(role):null}
export function sync(){
 const code=state()?.user.code||'';
 if(actor!==code){actor=code;for(const id of ['unknown','delivery']){$(id).replaceChildren();sequence[id]++;pages[id].offset=0}pages.delivery.status=state()?.user.role==='customer'?'':'pending'}
 for(const id of ['unknown','delivery'])if(!$(id).hidden)opened(id);
}
export function opened(id){if(['unknown','delivery'].includes(id)&&allowed(id,state()?.user.role))load(id)}
async function load(id){
 const root=$(id),ticket=++sequence[id],code=state().user.code,customer=state().user.role==='customer',p=pages[id];
 const title=id==='unknown'?'الشحنات مجهولة المالك':'طلبات التوصيل';
 root.innerHTML=`<div class="ops-heading"><div><h2>${title}</h2><p class="muted">${id==='unknown'?'قائمة داخلية؛ لا تظهر للزبائن قبل التحقق من الملكية والربط.':customer?'اطلب توصيل شحناتك للبيت وتابع رد الشركة هنا.':'طلبات الزبائن للتوصيل إلى البيت، في قائمة مستقلة.'}</p></div><div class="ops-actions">${id==='unknown'||customer?`<button class="primary" data-new>${id==='unknown'?'تسجيل شحنة مجهولة':'طلب توصيل للبيت'}</button>`:''}<button data-refresh>تحديث</button></div></div><div class="service-toolbar"><label>الحالة <select data-filter>${option('','كل الحالات')}${id==='unknown'?option('unresolved','بانتظار معرفة المالك')+option('linked','تم الربط'):Object.entries(statuses).map(([k,v])=>option(k,v)).join('')}</select></label><span data-page></span></div><div data-results role="status">جاري التحميل…</div><div class="ops-actions" data-pages></div>`;
 root.querySelector('[data-refresh]').onclick=()=>load(id);
 const select=root.querySelector('[data-filter]');select.value=p.status;select.onchange=()=>{p.status=select.value;p.offset=0;load(id)};
 if(root.querySelector('[data-new]'))root.querySelector('[data-new]').onclick=id==='unknown'?newUnknown:()=>requestDelivery();
 try{
  const data=await app.api(`/${id==='unknown'?'unknown-shipments':'delivery-requests'}?offset=${p.offset}&status=${encodeURIComponent(p.status)}`);
  if(sequence[id]!==ticket||state()?.user.code!==code)return;
  root.querySelector('[data-results]').removeAttribute('role');
  root.querySelector('[data-results]').innerHTML=data.rows.length?data.rows.map(id==='unknown'?unknownCard:r=>deliveryCard(r,customer)).join(''):`<article class="service-empty"><h3>${id==='unknown'?'لا توجد شحنات في هذه القائمة':'لا توجد طلبات في هذه القائمة'}</h3><p>${id==='unknown'?'سجّل الشحنة كما وصلت، حتى لو ما عندهاش رقم تتبع واضح.':customer?'اختَر شحناتك وأضف رقم الهاتف ومكان التوصيل.':'تظهر الطلبات هنا بمجرد أن يرسلها الزبون من حسابه.'}</p></article>`;
  root.querySelector('[data-page]').textContent=data.rows.length?`عرض ${p.offset+1}–${p.offset+data.rows.length}`:'';
  root.querySelector('[data-pages]').innerHTML=`<button data-prev ${p.offset===0?'disabled':''}>السابق</button><button data-next ${data.hasMore?'':'disabled'}>التالي</button>`;
  root.querySelector('[data-prev]').onclick=()=>{p.offset=Math.max(0,p.offset-50);load(id)};root.querySelector('[data-next]').onclick=()=>{p.offset+=50;load(id)};
  root.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>linkUnknown(data.rows.find(r=>r.id===b.dataset.link)));
  root.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>photoUnknown(data.rows.find(r=>r.id===b.dataset.photo)));
  root.querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>updateDelivery(data.rows.find(r=>r.id===b.dataset.request),b.dataset.status));
 }catch(err){if(sequence[id]===ticket&&state()?.user.code===code)root.querySelector('[data-results]').innerHTML=`<p class="ops-error">${e(err.message)}</p><p>اضغط تحديث لإعادة المحاولة.</p>`}
}
function unknownCard(r){return `<article class="service-card"><div class="service-card-head"><h3>${r.tracking?`<bdi>${e(r.tracking)}</bdi>`:'بدون رقم تتبع واضح'}</h3><span class="service-badge">${r.status==='linked'?'تم الربط':'بانتظار معرفة المالك'}</span></div><div class="service-parcel">${r.hasPhoto?`<img class="service-photo" loading="lazy" src="/api/unknown-shipments/${e(r.id)}/photo" alt="صورة الشحنة ${e(r.tracking||'مجهولة المالك')}">`:'<div class="service-no-photo">بدون صورة</div>'}<div><p class="service-text">${e(r.description)}</p><p class="muted">${r.intake_data?.source?'سُجلت':'استُلمت'} ${e(r.received_on)}</p>${r.intake_data?.source?`<p class="ops-note">بيانات التسجيل: ${e(r.intake_data.weight)} ${e(r.intake_data.unit)} · رحلة ${e(r.intake_data.trip)} · ${e(r.intake_data.country)} · ${e(r.intake_data.mode)} · ${e(r.intake_data.category)}</p>`:''}${r.status==='linked'?`<p>تم التحقق والربط بالزبون <bdi>${e(r.customer_code)}</bdi> · التتبع <bdi>${e(r.linked_shipment_id)}</bdi></p>`:'<p class="muted">لا يوجد حساب زبون مرتبط بهذه الشحنة.</p>'}</div></div><div class="ops-actions">${r.status==='unresolved'?`<button class="primary" data-link="${e(r.id)}">تحقق وربط بزبون</button><button data-photo="${e(r.id)}">${r.hasPhoto?'عرض / تغيير الصورة':'إضافة صورة'}</button>`:r.hasPhoto?`<button data-photo="${e(r.id)}">عرض الصورة</button>`:''}</div></article>`}
function deliveryCard(r,customer){
 const name=state().users.find(u=>u.code===r.customer_code)?.name||r.customer_code;
 return `<article class="service-card"><div class="service-card-head"><h3>${customer?'طلب توصيل':e(name)} <small class="muted" dir="ltr">#${e(r.id.slice(0,8))}</small></h3><span class="service-badge service-${e(r.status)}">${e(statuses[r.status])}</span></div>${customer?'':`<p>كود الزبون: <bdi>${e(r.customer_code)}</bdi></p>`}<dl class="service-address"><dt>الهاتف</dt><dd><bdi>${e(r.phone)}</bdi></dd><dt>مكان التوصيل</dt><dd class="service-text">${e(r.address)}</dd>${r.note?`<dt>ملاحظة الزبون</dt><dd class="service-text">${e(r.note)}</dd>`:''}</dl><details><summary>${r.shipments.length} شحنة — عرض أرقام التتبع</summary><ul class="service-tracks">${r.shipments.map(s=>`<li><bdi>${e(s.id)}</bdi> · رحلة ${e(s.trip)} · ${e(s.country)} · ${e(s.mode)}</li>`).join('')}</ul></details>${r.response_note?`<div class="ops-note service-text">رد الشركة: ${e(r.response_note)}</div>`:''}<p class="muted">أُرسل ${e(date(r.created_at))} · آخر تحديث ${e(date(r.updated_at))}</p><div class="ops-actions">${customer?(r.status==='pending'?requestButton(r,'cancelled','إلغاء الطلب'):r.status==='accepted'?'<span class="muted">بدأ التنسيق؛ تواصل مع الشركة لأي تعديل.</span>':''):['pending','accepted'].includes(r.status)?`${requestButton(r,'accepted',r.status==='pending'?'بدء التنسيق':'تحديث رد الشركة')}${r.status==='accepted'?requestButton(r,'closed','إغلاق الطلب'):''}${requestButton(r,'cancelled','إلغاء الطلب')}`:''}</div></article>`;
}
const requestButton=(r,status,label)=>`<button data-request="${e(r.id)}" data-status="${status}">${label}</button>`;
function dialog(title,content){
 const d=$('detail');if(d.open)d.close();
 d.innerHTML=`<form class="live-form service-form"><div class="row"><h2>${title}</h2><button type="button" data-close>إغلاق</button></div>${content}<p class="service-message" role="status" aria-live="polite"></p><button type="submit" class="primary" data-submit>حفظ</button></form>`;
 const f=d.querySelector('form');f.querySelector('[data-close]').onclick=()=>d.close();d.showModal();return {d,f};
}
async function submit(f,fn){
 if(f.dataset.busy)return;f.dataset.busy='true';const controls=[...f.elements],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
 const d=f.closest('dialog'),cancel=ev=>ev.preventDefault();d.addEventListener('cancel',cancel);f.querySelector('[role=status]').textContent='جاري الحفظ…';
 try{await fn()}catch(err){f.querySelector('[role=status]').textContent=err.message}finally{delete f.dataset.busy;controls.forEach((c,i)=>c.disabled=disabled[i]);d.removeEventListener('cancel',cancel)}
}
async function photoData(file){
 if(!file)return null;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880||file.size<12)throw Error('اختر صورة JPG أو PNG أو WebP لا تتجاوز 5 ميجابايت.');
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('تعذّر قراءة الصورة.'));r.readAsDataURL(file)});
}
function newUnknown(){
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Tripoli'}),requestId=crypto.randomUUID();let saved=null,payload=null;
 const {d,f}=dialog('تسجيل شحنة مجهولة المالك',`<p class="ops-note">قائمة داخلية فقط. لا تُدخل كود زبون قبل التأكد من المالك.</p><label>رقم التتبع إن وُجد<input name="tracking" maxlength="64" dir="ltr" placeholder="اتركه فارغًا إذا لم يكن واضحًا"></label><label>وصف الشحنة والعلامات المميزة<textarea name="description" required minlength="3" maxlength="600" rows="3"></textarea></label><label>تاريخ الاستلام<input name="receivedOn" type="date" value="${today}" max="${today}" required></label><label>صورة الشحنة (حتى 5 ميجابايت)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>`);
 f.querySelector('[data-submit]').textContent='تسجيل في القائمة الداخلية';
 f.onsubmit=ev=>{ev.preventDefault();const input=Object.fromEntries(new FormData(f)),file=f.elements.photo.files[0];submit(f,async()=>{
  const photo=await photoData(file);
  payload ||= {requestId,tracking:input.tracking,description:input.description,receivedOn:input.receivedOn};
  if(!saved)saved=await app.api('/unknown-shipments','POST',payload);
  if(photo)try{await app.api(`/unknown-shipments/${saved.id}/photo`,'POST',{photo,updatedAt:saved.updated_at})}catch(err){throw Error('تم تسجيل الشحنة، لكن تعذّر حفظ الصورة. يمكنك إغلاق النافذة وإعادة رفعها من القائمة. '+err.message)}
  d.close();pages.unknown.offset=0;pages.unknown.status='unresolved';await load('unknown');app.notice('تم تسجيل الشحنة في القائمة الداخلية.');
 }).then(()=>{if(payload&&d.open){for(const n of ['tracking','description','receivedOn'])f.elements[n].disabled=true;f.querySelector('[data-submit]').textContent=saved?'إعادة محاولة حفظ الصورة':'إعادة إرسال نفس البيانات';if(saved)load('unknown')}})};
}
function photoUnknown(r){
 const {d,f}=dialog('صورة الشحنة',`${r.hasPhoto?`<img class="service-photo-large" src="/api/unknown-shipments/${e(r.id)}/photo" alt="صورة الشحنة">`:''}${r.status==='unresolved'?'<label>الصورة الجديدة<input type="file" name="photo" required accept="image/jpeg,image/png,image/webp"></label><p class="muted">JPG أو PNG أو WebP، حتى 5 ميجابايت. تبقى داخلية إلى حين الربط.</p>':'<p>تم ربط الشحنة. تُدار الصورة من الشحنات العادية.</p>'}`);
 if(r.status==='linked'){f.querySelector('[data-submit]').hidden=true;f.onsubmit=ev=>ev.preventDefault();return}
 f.querySelector('[data-submit]').textContent='حفظ الصورة';
 f.onsubmit=ev=>{ev.preventDefault();const file=f.elements.photo.files[0];submit(f,async()=>{await app.api(`/unknown-shipments/${r.id}/photo`,'POST',{photo:await photoData(file),updatedAt:r.updated_at});d.close();await load('unknown');app.notice('تم حفظ الصورة.');})};
}
function linkUnknown(r){
 const customers=state().users.filter(u=>u.role==='customer'&&u.active),trips=state().trips.filter(t=>t.step===0);
 const {d,f}=dialog('التحقق من الملكية وربط الشحنة',`<p class="ops-warning">بعد التأكيد ستظهر الشحنة وصورتها للزبون المحدد. لا يمكن تغيير المالك من هذا القسم بعد الربط.</p><p class="service-text">${e(r.description)}</p><label>رقم التتبع الحقيقي<input name="tracking" required maxlength="64" dir="ltr" value="${e(r.tracking||'')}" ${r.tracking?'readonly':''}></label><label>الزبون الموجود<select name="customer" required>${option('','اختر الزبون')}${customers.map(c=>option(c.code,`${c.code} · ${c.name}`)).join('')}</select></label><label>الرحلة المحفوظة<select name="tripIndex" required>${option('','اختر رحلة لم تغادر المخزن')}${trips.map((t,i)=>option(String(i),`${t.code} · ${t.country} · ${t.mode}`)).join('')}</select></label><div class="ops-grid"><label>الوزن / الحجم<input name="weight" type="number" required min="0.000001" max="100000" step="any"></label><label>الوحدة<input name="unit" readonly value="اختر الرحلة"></label><label>الحالة الفعلية<select name="step" required>${option('','اختر الحالة')}${['وصلت إلى مخزن المنشأ','غادرت المخزن','وصلت إلى ليبيا','جاهزة للاستلام'].map((s,i)=>option(String(i),s)).join('')}</select></label></div><label>كيف تأكدت من الملكية؟<textarea name="confirmation" required minlength="5" maxlength="600" rows="3" placeholder="مثال: طابقت رقم التتبع مع فاتورة شراء الزبون"></textarea></label><label class="ops-check"><input name="confirmed" type="checkbox" required>تأكدت من ملكية الزبون لهذه الشحنة</label>${!customers.length||!trips.length?'<p class="ops-error">يلزم وجود حساب زبون مفعّل ورحلة لم تغادر. أضف الناقص من الإدارة أولًا.</p>':''}`);
 f.querySelector('[data-submit]').textContent='تأكيد الربط وإظهار الشحنة للزبون';f.querySelector('[data-submit]').disabled=!customers.length||!trips.length;
 f.elements.tripIndex.onchange=()=>{f.elements.unit.value=trips[f.elements.tripIndex.value]?.mode==='جوي'?'كجم':'متر مكعب'};
 if(r.intake_data?.source){const index=trips.findIndex(t=>t.code===r.intake_data.trip&&t.country===r.intake_data.country&&t.mode===r.intake_data.mode);f.elements.weight.value=r.intake_data.weight;if(index>=0){f.elements.tripIndex.value=String(index);f.elements.tripIndex.onchange()}}
 f.onsubmit=ev=>{ev.preventDefault();const values=Object.fromEntries(new FormData(f)),t=trips[values.tripIndex];submit(f,async()=>{await app.api(`/unknown-shipments/${r.id}/link`,'POST',{tracking:values.tracking,customer:values.customer,trip:t.code,country:t.country,mode:t.mode,weight:Number(values.weight),unit:values.unit,step:Number(values.step),confirmation:values.confirmation,confirmed:values.confirmed==='on',updatedAt:r.updated_at});d.close();await app.refresh();app.notice('تم التحقق والربط؛ الشحنة وصورتها متاحتان للزبون المحدد فقط.');})};
}
export function requestDelivery(preselected=[]){
 if(state()?.user.role!=='customer')return;
 const available=state().shipments.filter(s=>s.customer===state().user.code&&s.step!==4),requestId=crypto.randomUUID();let payload=null;
 const {d,f}=dialog('طلب توصيل للبيت',`<p class="ops-note">يمكنك الطلب مسبقًا. التوصيل يكون بعد جاهزية الشحنات والتنسيق معك؛ إرسال الطلب لا يثبت موعدًا أو رسومًا.</p><fieldset class="service-select"><legend>اختَر الشحنات المطلوب توصيلها</legend>${available.map(s=>`<label class="ops-check"><input type="checkbox" name="shipment" value="${e(s.id)}" ${preselected.includes(s.id)?'checked':''}><span><bdi>${e(s.id)}</bdi><small>رحلة ${e(s.trip)} · ${e(s.status)}</small></span></label>`).join('')||'<p>لا توجد شحنات متاحة للتوصيل. الشحنات المسلّمة لا تظهر هنا.</p>'}</fieldset><label>رقم الهاتف للتنسيق<input name="phone" type="tel" inputmode="tel" dir="ltr" required maxlength="25" autocomplete="tel" value="${e(state().user.phone||'')}" placeholder="0920000000"></label><label>مكان التوصيل<textarea name="address" required minlength="8" maxlength="600" rows="3" autocomplete="street-address" placeholder="المدينة، المنطقة، الشارع، رقم البيت أو أقرب علامة واضحة"></textarea></label><label>ملاحظة إضافية (اختياري)<textarea name="note" maxlength="300" rows="2" placeholder="تعليمات للوصول أو وقت مناسب للاتصال"></textarea></label><p class="muted">رقمك وعنوانك يظهران للشركة فقط. ما تقدرش تضيف نفس الشحنة لطلبين مفتوحين.</p>`);
 f.querySelector('[data-submit]').textContent='إرسال طلب التوصيل';f.querySelector('[data-submit]').disabled=!available.length;
 f.onsubmit=ev=>{ev.preventDefault();const data=new FormData(f),ids=data.getAll('shipment');submit(f,async()=>{
  if(!payload&&(!ids.length||ids.length>100))throw Error('اختر من 1 إلى 100 شحنة.');
  payload ||= {requestId,ids,phone:data.get('phone'),address:data.get('address'),note:data.get('note')};
  await app.api('/delivery-requests','POST',payload);d.close();pages.delivery.offset=0;pages.delivery.status='';app.tab('delivery');app.notice('تم إرسال طلب التوصيل للشركة. تابع الرد من طلبات التوصيل.');
 }).then(()=>{if(payload&&d.open){f.querySelector('[role=status]').textContent+=' للمحاولة مجددًا سنرسل نفس البيانات بدون تكرار؛ لتعديلها أغلق النافذة وحدّث الطلبات أولًا.';for(const el of f.elements)if(el.name)el.disabled=true}})};
}
function updateDelivery(r,status){
 const customer=state().user.role==='customer',title=status==='cancelled'?'إلغاء طلب التوصيل':status==='closed'?'إغلاق طلب التوصيل':'التنسيق مع الزبون';
 const {d,f}=dialog(title,`<p>الطلب <bdi>#${e(r.id.slice(0,8))}</bdi> · ${r.shipments.length} شحنة</p>${status==='closed'?'<p class="ops-warning">إغلاق الطلب لا يغيّر حالة الشحنات إلى «تم التسليم». حدّثها من قسم الشحنات بعد التسليم الفعلي.</p>':''}${customer?'<p>تأكيد إلغاء هذا الطلب؟ تبقى شحناتك محفوظة ويمكنك طلب التوصيل لاحقًا.</p>':`<label>رد الشركة للزبون<textarea name="note" maxlength="600" rows="3" placeholder="تفاصيل التنسيق أو سبب الإلغاء">${e(r.response_note)}</textarea></label><p class="muted">هذا الرد سيظهر للزبون داخل طلبه.</p>`}`);
 f.querySelector('[data-submit]').textContent='تأكيد';
 f.onsubmit=ev=>{ev.preventDefault();const note=f.elements.note?.value||'';submit(f,async()=>{await app.api(`/delivery-requests/${r.id}`,'PATCH',{status,note,updatedAt:r.updated_at});d.close();await load('delivery');app.notice('تم تحديث الطلب.');})};
}
