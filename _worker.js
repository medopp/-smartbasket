import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const digest=s=>createHash('sha256').update(s).digest('hex');
const cleanCode=v=>{const s=String(v??'').trim().toUpperCase();if(!/^[A-Z0-9-]{2,64}$/.test(s))fail(400,'الكود أو رقم التتبع غير صالح.');return s};
const text=(v,max=100)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'أكمل البيانات المطلوبة.');return v.trim()};
const countries=['الصين','الإمارات','السعودية'];
const modes=['جوي','بحري'];
const states=['وصلت إلى مخزن المنشأ','غادرت المخزن','وصلت إلى ليبيا','جاهزة للاستلام','تم التسليم'];
const publicUser=u=>({code:u.code,name:u.name,role:u.role,active:u.active,phone:u.phone});
const publicTrip=t=>({code:t.trip_code,country:t.country,mode:t.mode,date:t.arrival_date||'لم يُحدد',step:Number(t.step||0),status:states[Number(t.step||0)]||states[0]});
const passwordHash=p=>{if(typeof p!=='string'||p.length<8||p.length>128)fail(400,'كلمة المرور من 8 إلى 128 حرفًا.');const salt=randomBytes(16).toString('hex');return {salt,password_hash:scryptSync(p,salt,64).toString('hex')}};
const cookie=(token,seconds=28800)=>`salla_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`;
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const filter=(table,values)=>table+'?'+Object.entries(values).map(([key,value])=>key+'=eq.'+encodeURIComponent(value)).join('&');
const validDate=(value,required=false)=>{if(value===undefined||value===null||value===''){if(required)fail(400,'أدخل تاريخ الوصول.');return null}if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||Number.isNaN(Date.parse(value)))fail(400,'التاريخ غير صالح.');return value};

async function body(req){
 const reader=req.body?.getReader();let size=0,chunks=[];
 if(!reader)return {};
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>7100000){await reader.cancel();fail(413,'الملف كبير جدًا.')}chunks.push(value)}
 try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail(400,'بيانات غير صالحة.')}
}

export function database(env){return async(path,method='GET',data)=>{
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)fail(503,'الخدمة قيد التجهيز.');
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:data===undefined?undefined:JSON.stringify(data)});
 if(!r.ok){if(r.status===409)fail(409,'هذا الكود أو رقم التتبع مستخدم بالفعل.');throw Error('Database operation failed: '+r.status)}
 const value=await r.text();return value?JSON.parse(value):null;
 }}

async function getTrip(db,trip,country,mode){const [row]=await db(filter('sb_trips',{trip_code:trip,country,mode}));return row}

function shipmentValues(db,b,old){
 return (async()=>{
  const id=b.id===undefined?(old?.id||''):cleanCode(b.id);
  const customer=b.customer===undefined?(old?.customer_code||''):cleanCode(b.customer);
  const country=b.country===undefined?(old?.country||''):b.country;
  const mode=b.mode===undefined?(old?.mode||''):b.mode;
  const weight=Number(b.weight===undefined?old?.weight:b.weight);
  const unit=b.unit===undefined?(old?.unit||''):b.unit;
  const tripValue=b.trip===undefined?(old?.trip||'لم تُحدد'):b.trip;
  const trip=tripValue==='لم تُحدد'?'لم تُحدد':cleanCode(tripValue);
  const step=b.step===undefined?old?.step:b.step;
  if(!countries.includes(country)||!modes.includes(mode))fail(400,'الدولة أو نوع الشحن غير صالح.');
   if(!Number.isFinite(weight)||weight<=0||!['كجم','متر مكعب'].includes(unit))fail(400,'الوزن أو الحجم غير صالح.');
  if(step!==undefined&&(!Number.isInteger(step)||step<0||step>4))fail(400,'حالة غير صالحة.');
  const [customerRow]=await db('sb_accounts?code=eq.'+encodeURIComponent(customer)+'&role=eq.customer');
  if(!customerRow)fail(400,'اختر زبونًا صحيحًا.');
  let shipDate=b.date===undefined?(old?.ship_date||null):validDate(b.date);
  if(trip!=='لم تُحدد'){
   const tripRow=await getTrip(db,trip,country,mode);
   if(!tripRow)fail(400,'اختر رحلة محفوظة من قائمة الرحلات.');
   if(Number(tripRow.step)>0&&(!old||old.trip!==trip))fail(400,'لا يمكن إضافة شحنة إلى رحلة غادرت المخزن.');
   shipDate=tripRow.arrival_date||null;
  }
  return {id,customer_code:customer,country,mode,weight,unit,trip,ship_date:shipDate,...(step===undefined?{}:{step})};
 })();
}

export async function handle(req,env){
 const url=new URL(req.url),route=url.pathname,method=req.method,db=database(env);
 if(!['GET','HEAD'].includes(method)){
  if(req.headers.get('Origin')!==url.origin)fail(403,'مصدر الطلب غير مسموح.');
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'صيغة الطلب غير صالحة.');
 }
 if(route==='/api/bootstrap'&&method==='GET')return json({needsSetup:false,requiresSetupKey:true});
 if(route==='/api/setup')fail(403,'إنشاء الحسابات متاح من الإدارة فقط.');
 if(route==='/api/login'&&method==='POST'){
  const b=await body(req),code=cleanCode(b.code);
  for(const key of ['ip:'+digest(req.headers.get('CF-Connecting-IP')||'unknown'),'account:'+code])if(!await db('rpc/sb_login_attempt','POST',{p_key:key}))fail(429,'محاولات كثيرة. انتظر دقيقة وأعد المحاولة.');
  if(typeof b.password!=='string'||b.password.length>128)fail(401,'الكود أو كلمة المرور غير صحيحة.');
  const [u]=await db('sb_accounts?code=eq.'+encodeURIComponent(code));
  const candidate=scryptSync(b.password,u?.salt||'invalid-account',64);
  if(!u||!u.active||!timingSafeEqual(candidate,Buffer.from(u.password_hash,'hex')))fail(401,'الكود أو كلمة المرور غير صحيحة.');
  const token=randomBytes(32).toString('hex');
  await db('sb_sessions?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),'DELETE');
  await db('sb_sessions','POST',{token_hash:digest(token),account_code:code,account_salt:u.salt,expires_at:new Date(Date.now()+28800000).toISOString()});
  return json(publicUser(u),200,{'Set-Cookie':cookie(token)});
 }
 if(route.startsWith('/api/')){
  const token=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('salla_session='))?.slice(14)||'';
  if(!/^[a-f0-9]{64}$/.test(token))fail(401,'سجّل الدخول للمتابعة.');
  const [session]=await db('sb_sessions?token_hash=eq.'+digest(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
  const [u]=session?await db('sb_accounts?code=eq.'+encodeURIComponent(session.account_code)):[];
  if(!u?.active||u.salt!==session.account_salt)fail(401,'سجّل الدخول للمتابعة.');
  const admin=()=>{if(u.role!=='admin')fail(403,'هذه العملية للإدارة فقط.')};
  const manager=()=>{if(!['admin','staff'].includes(u.role))fail(403,'هذه العملية للإدارة والموظفين فقط.')};
  if(route==='/api/logout'&&method==='POST'){await db('sb_sessions?token_hash=eq.'+digest(token),'DELETE');return json({ok:true},200,{'Set-Cookie':cookie('',0)})}
  if(route==='/api/state'&&method==='GET'){
   const users=u.role==='customer'?[publicUser(u)]:await db('sb_accounts?select=code,name,role,active,phone'+(u.role==='staff'?'&role=eq.customer':''));
   const rows=await db('sb_shipments?order=created_at.desc'+(u.role==='customer'?'&customer_code=eq.'+encodeURIComponent(u.code):''));
   const trips=u.role==='customer'?[]:await db('sb_trips?order=created_at.desc');
   const counts=new Map();rows.forEach(s=>{const key=[s.trip,s.country,s.mode].join('|');counts.set(key,(counts.get(key)||0)+1)});
   return json({user:publicUser(u),users,trips:trips.map(t=>({...publicTrip(t),shipmentCount:counts.get([t.trip_code,t.country,t.mode].join('|'))||0})),shipments:rows.map(s=>({id:s.id,customer:s.customer_code,country:s.country,mode:s.mode,weight:s.weight+' '+s.unit,weightValue:Number(s.weight),unit:s.unit,trip:s.trip,date:s.ship_date||'لم يُحدد',step:Number(s.step),status:states[Number(s.step)]||states[0],hasPhoto:!!s.photo_key}))});
  }
  if(route==='/api/users'&&method==='POST'){
   admin();const b=await body(req),code=cleanCode(b.code),name=text(b.name),phone=String(b.phone||'').trim();
   if(!['customer','staff'].includes(b.role))fail(400,'نوع الحساب غير صالح.');
   if((b.role==='customer'&&!phone)||(phone&&!/^\+?[0-9 ()-]{6,25}$/.test(phone)))fail(400,'أدخل رقم هاتف صحيح.');
   await db('sb_accounts','POST',{code,name,role:b.role,phone,...passwordHash(b.password)});return json({ok:true},201);
  }
  if(route.startsWith('/api/users/')&&method==='PATCH'){
   admin();const code=cleanCode(decodeURIComponent(route.slice(11))),b=await body(req),[target]=await db('sb_accounts?code=eq.'+encodeURIComponent(code));
   if(!target)fail(404,'الحساب غير موجود.');if(target.role==='admin')fail(400,'لا يمكن تعديل حساب الإدارة من هذه الشاشة.');
   let changes;if(b.password!==undefined)changes=passwordHash(b.password);else if(typeof b.active==='boolean')changes={active:b.active};else fail(400,'التعديل غير صالح.');
   await db('sb_accounts?code=eq.'+encodeURIComponent(code),'PATCH',changes);await db('sb_sessions?account_code=eq.'+encodeURIComponent(code),'DELETE');return json({ok:true});
  }
  if(route==='/api/trips'&&method==='POST'){
   manager();const b=await body(req),trip=cleanCode(b.trip||b.code),country=b.country,mode=b.mode,date=validDate(b.date,true);
   if(!countries.includes(country)||!modes.includes(mode))fail(400,'الدولة أو نوع الشحن غير صالح.');
   await db('sb_trips','POST',{trip_code:trip,country,mode,arrival_date:date,step:0});return json({ok:true},201);
  }
  if(route==='/api/shipments'&&method==='POST'){
   manager();const b=await body(req),values=await shipmentValues(db,b);
   if(values.trip==='لم تُحدد')fail(400,'اختر رحلة محفوظة قبل إضافة الشحنة.');
   await db('sb_shipments','POST',values);return json({ok:true},201);
  }
  if(route==='/api/trips/status'&&method==='PATCH'){
   manager();const b=await body(req),trip=cleanCode(b.trip),country=b.country,mode=b.mode;
   if(!countries.includes(country)||!modes.includes(mode))fail(400,'اختر رحلة ودولة ونوع شحن صالحين.');
   if(!Number.isInteger(b.step)||b.step<0||b.step>4)fail(400,'حالة غير صالحة.');
   const date=b.date===undefined?null:validDate(b.date);
   const tripRow=await getTrip(db,trip,country,mode);if(!tripRow)fail(404,'الرحلة غير موجودة.');
   const tripFilter=filter('sb_trips',{trip_code:trip,country,mode});
   await db(tripFilter,'PATCH',{step:b.step,...(date?{arrival_date:date}: {})});
   const shipmentFilter=filter('sb_shipments',{trip,country,mode});
   const updated=await db(shipmentFilter,'PATCH',{step:b.step,...(date?{ship_date:date}: {})});
   if(!updated.length)fail(404,'لا توجد شحنات في هذه الرحلة.');
   return json({ok:true,updatedCount:updated.length});
  }
  const match=route.match(/^\/api\/shipments\/([A-Za-z0-9-]+)(\/photo)?$/);
  if(match){
   const oldId=cleanCode(decodeURIComponent(match[1])),[s]=await db('sb_shipments?id=eq.'+encodeURIComponent(oldId));
   if(!s||(u.role==='customer'&&s.customer_code!==u.code))fail(404,'الشحنة غير موجودة.');
   if(match[2]&&method==='GET'){
    if(!s.photo_key)fail(404,'لا توجد صورة.');const object=await env.SHIPMENT_PHOTOS.get(s.photo_key);if(!object)fail(404,'لا توجد صورة.');
    return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'no-store'}});
   }
   manager();
   if(!match[2]&&method==='PATCH'){
    const b=await body(req),values=await shipmentValues(db,b,s);await db('sb_shipments?id=eq.'+encodeURIComponent(oldId),'PATCH',values);return json({ok:true});
   }
   if(!match[2]&&method==='DELETE'){
    await db('sb_shipments?id=eq.'+encodeURIComponent(oldId),'DELETE');return json({ok:true});
   }
   if(match[2]&&method==='POST'){
    if(!env.SHIPMENT_PHOTOS)fail(503,'تخزين الصور قيد التجهيز.');
    const b=await body(req),m=typeof b.photo==='string'&&b.photo.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!m)fail(400,'اختر صورة JPG أو PNG أو WebP.');const bytes=Buffer.from(m[2],'base64');
    if(bytes.length<12||bytes.length>5242880)fail(400,'الصورة غير صالحة أو أكبر من 5 ميجابايت.');
    const valid=m[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)fail(400,'محتوى الصورة لا يطابق نوعها.');
    const key='shipments/'+s.id+'/'+randomBytes(24).toString('hex');
    if(!await db('rpc/sb_reserve_photo','POST',{p_key:key,p_bytes:bytes.length}))fail(409,'وصل التخزين إلى الحد المتاح. تواصل مع الإدارة.');
    await env.SHIPMENT_PHOTOS.put(key,bytes,{httpMetadata:{contentType:m[1]}});
    await db('sb_shipments?id=eq.'+encodeURIComponent(s.id),'PATCH',{photo_key:key,photo_bytes:bytes.length});
    return json({ok:true});
   }
  }
  fail(404,'المسار غير موجود.');
 }
 const allowed=['/','/index.html','/live-client.js','/manifest.webmanifest','/sw.js','/offline.html','/icon-192.svg','/icon-512.svg','/salla-logo-final.png'];
 if(!allowed.includes(route)||!['GET','HEAD'].includes(method))fail(404,'الصفحة غير موجودة.');
 return env.ASSETS.fetch(req);
}

export default {async fetch(req,env){let response;try{response=await handle(req,env)}catch(e){response=json({error:e.status?e.message:'تعذّر إكمال العملية.'},e.status||500)}
 const r=new Response(response.body,response);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('X-Frame-Options','DENY');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('Cache-Control','no-store');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return r;
 }};
