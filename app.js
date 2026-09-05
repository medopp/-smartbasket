let rate=parseFloat(localStorage.getItem('smartbasket_rate') || '0.82');
document.getElementById('rateHero').textContent=rate.toFixed(2);
let cart=[];
let products=[
 {id:1,source:'1688',title:'مصباح BMW F10 LED أمامي يمين',yuan:680,icon:'💡'},
 {id:2,source:'Taobao',title:'مصابيح خلفية LED BMW F10',yuan:520,icon:'🚘'},
 {id:3,source:'Pinduoduo',title:'طقم أدوات صيانة للسيارات',yuan:188,icon:'🧰'},
 {id:4,source:'1688',title:'حقيبة نسائية جلدية فاخرة',yuan:96,icon:'👜'},
 {id:5,source:'Taobao',title:'سماعات بلوتوث لاسلكية',yuan:129,icon:'🎧'},
 {id:6,source:'Pinduoduo',title:'إضاءة LED داخلية للسيارة',yuan:72,icon:'✨'},
 {id:7,source:'1688',title:'شاحن سيارة سريع USB-C',yuan:45,icon:'🔌'},
 {id:8,source:'Taobao',title:'ساعة ذكية رياضية',yuan:158,icon:'⌚'}
];

function money(y){return (y*rate).toFixed(2)+' د.ل'}
function renderProducts(list=products){
 let sort=document.getElementById('sort').value;
 let arr=[...list];
 if(sort==='price')arr.sort((a,b)=>a.yuan-b.yuan);
 document.getElementById('productGrid').innerHTML=arr.map(p=>`
<article class="card" style="display:flex !important;flex-direction:column !important;position:relative !important;height:auto !important;overflow:hidden !important;padding:0 !important;">

  <div class="pic" style="display:block !important;position:relative !important;width:100% !important;height:280px !important;min-height:280px !important;flex:none !important;overflow:hidden !important;padding:0 !important;">
    ${p.icon}
  </div>

  <div class="card-body" style="display:block !important;position:static !important;width:100% !important;height:auto !important;padding:14px !important;margin:0 !important;background:#fff !important;">

    <span class="source" style="display:block !important;position:static !important;">
      ${p.source}
    </span>

    <h3 style="position:static !important;margin:6px 0 10px !important;">
      ${p.title}
    </h3>

    <div class="price" style="position:static !important;margin:0 !important;">
      ${money(p.yuan)}
    </div>

    <div class="yuan" style="position:static !important;margin-top:4px !important;">
      ¥${p.yuan} قبل التحويل
    </div>

    <button class="add" onclick="addCart(${p.id})" style="position:static !important;width:100% !important;margin-top:14px !important;">
      + أضف للسلة
    </button>

  </div>

</article>`).join('');
}

function updateRate(){
 const input=parseFloat(document.getElementById('adminRateInput').value);
 if(!input || input<=0)return alert('اكتب سعر صحيح لليوان.');
 rate=input;
 localStorage.setItem('smartbasket_rate',rate.toFixed(4));
 document.getElementById('rateHero').textContent=rate.toFixed(2);
 document.getElementById('rateUpdated').textContent='تم تحديث السعر: '+rate.toFixed(2)+' د.ل لكل ¥1';
 renderProducts();
 renderCart();
}

function searchProducts(){
 const q=document.getElementById('searchInput').value.trim().toLowerCase();
 const checked=[...document.querySelectorAll('.sources input:checked')].map(x=>x.value);
 let list=products.filter(p=>checked.includes(p.source) && (!q || p.title.toLowerCase().includes(q) || p.source.toLowerCase().includes(q) || q.includes('bmw')));
 document.getElementById('resultTitle').textContent=q?`نتائج البحث عن «${q}»`:'منتجات مقترحة';
 renderProducts(list.length?list:products.filter(p=>checked.includes(p.source)));
 document.getElementById('results').scrollIntoView({behavior:'smooth'});
}
function addCart(id){let p=products.find(x=>x.id===id);cart.push(p);document.getElementById('cartCount').textContent=cart.length;openCart()}
function openCart(){document.getElementById('overlay').classList.add('open');renderCart()}
function closeCart(e){if(!e||e.target.id==='overlay')document.getElementById('overlay').classList.remove('open')}
function renderCart(){
 let el=document.getElementById('cartItems');
 if(!cart.length){el.innerHTML='<p style="color:#667085;text-align:center;padding:40px">السلة فارغة حالياً.</p>';document.getElementById('cartTotal').textContent='0 د.ل';return}
 el.innerHTML=cart.map((p,i)=>`<div class="cart-row"><div class="thumb">${p.icon}</div><div class="grow"><b>${p.title}</b><br><small>${p.source} • ¥${p.yuan}</small><br><strong>${money(p.yuan)}</strong></div><button onclick="removeCart(${i})" style="border:0;background:none;cursor:pointer">حذف</button></div>`).join('');
 document.getElementById('cartTotal').textContent=money(cart.reduce((s,p)=>s+p.yuan,0));
}
function removeCart(i){cart.splice(i,1);document.getElementById('cartCount').textContent=cart.length;renderCart()}
function checkout(){if(!cart.length)return alert('السلة فارغة');alert('هذه نسخة التصميم التجريبية. في النسخة الحقيقية هنا يتم إنشاء طلب وإرساله إلى لوحة شركة السلة الذكية.')}
function trackOrder(){document.getElementById('trackResult').innerHTML='<div class="track-msg">🔎 مثال تجريبي: سيتم ربط هذه الصفحة لاحقاً بنظام تتبع الطلبات الخاص بالشركة.</div>'}
renderProducts();

let authMode='phone';
function openAuth(){document.getElementById('authOverlay').classList.add('open')}
function closeAuth(e){if(!e||e.target.id==='authOverlay')document.getElementById('authOverlay').classList.remove('open')}
function setAuthMode(mode){
 authMode=mode;
 document.getElementById('phoneField').style.display=mode==='phone'?'block':'none';
 document.getElementById('emailField').style.display=mode==='email'?'block':'none';
 document.getElementById('phoneTab').classList.toggle('active',mode==='phone');
 document.getElementById('emailTab').classList.toggle('active',mode==='email');
}
function sendCode(){
 const value=authMode==='phone'?document.getElementById('phoneInput').value.trim():document.getElementById('emailInput').value.trim();
 if(!value)return alert('اكتب رقم الهاتف أو البريد الإلكتروني أولاً.');
 document.getElementById('otpArea').style.display='block';
 alert('في النسخة التجريبية تم فتح خانة رمز التحقق. عند الربط الحقيقي سيتم إرسال OTP عبر SMS أو البريد.');
}
function verifyCode(){
 const otp=document.getElementById('otpInput').value.trim();
 if(otp.length!==6)return alert('اكتب رمز التحقق المكوّن من 6 أرقام.');
 localStorage.setItem('smartbasket_user','verified');
 closeAuth();
 document.querySelector('.account-btn').textContent='👤 حسابي';
 alert('تم تسجيل الدخول في النسخة التجريبية.');
}

function loadAdminSettings(){
 const saved=JSON.parse(localStorage.getItem('smartbasket_settings')||'{}');
 if(saved.rate){rate=saved.rate;document.getElementById('panelRate').value=saved.rate;document.getElementById('rateHero').textContent=saved.rate.toFixed(2);}
 if(saved.commission!==undefined)document.getElementById('commission').value=saved.commission;
 if(saved.normal)document.getElementById('shipNormal').value=saved.normal;
 if(saved.copy)document.getElementById('shipCopy').value=saved.copy;
 if(saved.electric)document.getElementById('shipElectric').value=saved.electric;
 if(saved.cosmetics)document.getElementById('shipCosmetics').value=saved.cosmetics;
 updateAdminSummary(saved);
}
function saveAdminSettings(){
 const settings={
  rate:parseFloat(document.getElementById('panelRate').value)||0.82,
  commission:parseFloat(document.getElementById('commission').value)||0,
  normal:parseFloat(document.getElementById('shipNormal').value)||0,
  copy:parseFloat(document.getElementById('shipCopy').value)||0,
  electric:parseFloat(document.getElementById('shipElectric').value)||0,
  cosmetics:parseFloat(document.getElementById('shipCosmetics').value)||0
 };
 rate=settings.rate;
 localStorage.setItem('smartbasket_rate',String(rate));
 localStorage.setItem('smartbasket_settings',JSON.stringify(settings));
 document.getElementById('rateHero').textContent=rate.toFixed(2);
 document.getElementById('rateUpdated').textContent='تم تحديث السعر: '+rate.toFixed(2)+' د.ل لكل ¥1';
 updateAdminSummary(settings);
 renderProducts();renderCart();
 alert('تم حفظ إعدادات الأسعار بنجاح.');
}
function updateAdminSummary(s){
 if(!s)return;
 document.getElementById('summaryRate').textContent=(s.rate||rate).toFixed(2)+' د.ل';
 document.getElementById('summaryCommission').textContent=(s.commission||0)+'%';
 document.getElementById('summaryShipping').textContent=(s.normal||0).toFixed(2)+' $/KG';
 document.getElementById('summaryDate').textContent=new Date().toLocaleDateString('ar-LY');
}
loadAdminSettings();
