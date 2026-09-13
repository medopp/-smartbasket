import {Buffer} from 'node:buffer';

// Called only AFTER session verification and db.setActor in the Worker.
export async function customerServices({req,env,db,u,url,body,json,fail,cleanCode,validUuid,text}) {
 const route=url.pathname,method=req.method;
 if(!route.startsWith('/api/unknown-shipments')&&!route.startsWith('/api/delivery-requests'))return null;
 const internal=()=>{if(!['admin','staff','warehouse'].includes(u.role))fail(403,'الشحنات مجهولة المالك قائمة داخلية للموظفين فقط.')};
 const delivery=()=>{if(!['admin','staff','customer'].includes(u.role))fail(403,'طلبات التوصيل للإدارة والموظف المسؤول والزبون المعني فقط.')};
 const uuid=v=>{if(!validUuid(v))fail(400,'رقم العملية غير صالح.');return v.toLowerCase()};
 const expected=v=>{if(typeof v!=='string'||Number.isNaN(Date.parse(v)))fail(400,'حدّث القائمة قبل المتابعة.');return v};
 const optional=(v,max)=>v==null||v===''?'':text(v,max);
 const realTracking=v=>{const id=cleanCode(v);if(id==='LN-')fail(400,'أدخل رقم التتبع الحقيقي، وليس كودًا ناقصًا.');return id};
 // PostgREST may serialize a composite RPC result as a one-row array.
 const one=value=>{const r=Array.isArray(value)?value[0]:value;if(!r||typeof r!=='object')fail(503,'تعذّر تأكيد نتيجة الحفظ؛ حدّث القائمة قبل المحاولة.');return r};
 const unknownPublic=value=>{const {photo_key,photo_bytes,...rest}=one(value);return {...rest,hasPhoto:!!photo_key}};
 // Stable bounded pagination; client cannot supply arbitrary PostgREST filters.
 const page=(table,statuses)=>{
  const status=url.searchParams.get('status')||'',offset=Number(url.searchParams.get('offset')||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||status&&!statuses.includes(status))fail(400,'فلتر القائمة غير صالح.');
  return table+'?order=created_at.desc,id&limit=51&offset='+offset+(status?'&status=eq.'+status:'');
 };
 const result=rows=>({rows:rows.slice(0,50),hasMore:rows.length>50});
 if(route==='/api/unknown-shipments'){
  internal();
  if(method==='GET'){const rows=await db(page('sb_unknown_shipments',['unresolved','linked']));return json({...result(rows),rows:rows.slice(0,50).map(unknownPublic)})}
  if(method==='POST'){
   const b=await body(req),description=text(b.description,600);
   if(description.length<3||typeof b.receivedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.receivedOn)||Number.isNaN(Date.parse(b.receivedOn))||new Date(b.receivedOn).toISOString().slice(0,10)!==b.receivedOn)fail(400,'أدخل وصفًا وتاريخ استلام صحيحين.');
   const row=await db('rpc/sb_unknown_create','POST',{p_id:uuid(b.requestId),p_tracking:b.tracking?realTracking(b.tracking):null,p_description:description,p_received:b.receivedOn});
   return json(unknownPublic(row),201);
  }
 }
 const unknown=route.match(/^\/api\/unknown-shipments\/([0-9a-f-]+)\/(photo|link)$/i);
 if(unknown){
  internal();const id=uuid(unknown[1]);
  if(unknown[2]==='link'&&method==='POST'){
   const b=await body(req),weight=Number(b.weight),confirmation=text(b.confirmation,600);
   if(b.confirmed!==true||confirmation.length<5||!Number.isFinite(weight)||weight<=0||weight>100000||!['كجم','متر مكعب'].includes(b.unit)||!['الصين','الإمارات','السعودية'].includes(b.country)||!['جوي','بحري'].includes(b.mode)||!Number.isInteger(b.step)||b.step<0||b.step>3)fail(400,'راجع بيانات الشحنة وأكد ملكية الزبون.');
   return json(await db('rpc/sb_unknown_link','POST',{p_id:id,p_expected:expected(b.updatedAt),p_data:{tracking:realTracking(b.tracking),customer:cleanCode(b.customer),trip:cleanCode(b.trip),country:b.country,mode:b.mode,weight,unit:b.unit,step:b.step,confirmed:true,confirmation}}));
  }
  if(unknown[2]==='photo'){
   const [row]=await db('sb_unknown_shipments?id=eq.'+id);
   if(!row)fail(404,'الشحنة غير موجودة.');
   if(method==='GET'){
    if(!row.photo_key||!env.SHIPMENT_PHOTOS)fail(404,'لا توجد صورة.');
    const object=await env.SHIPMENT_PHOTOS.get(row.photo_key);if(!object)fail(404,'لا توجد صورة.');
    return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'no-store'}});
   }
   if(method==='POST'){
    if(row.status!=='unresolved')fail(409,'تم ربط الشحنة؛ تُدار صورتها من الشحنات العادية.');
    if(!env.SHIPMENT_PHOTOS)fail(503,'تخزين الصور غير متاح الآن.');
    const b=await body(req),stamp=expected(b.updatedAt),m=typeof b.photo==='string'&&b.photo.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(stamp!==row.updated_at)fail(409,'تغيرت الشحنة؛ حدّث القائمة قبل رفع الصورة.');
    if(!m)fail(400,'اختر صورة JPG أو PNG أو WebP.');
    const bytes=Buffer.from(m[2],'base64');
    if(bytes.length<12||bytes.length>5242880)fail(400,'الصورة غير صالحة أو أكبر من 5 ميجابايت.');
    const valid=m[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)fail(400,'محتوى الصورة لا يطابق نوعها.');
    const key='unknown/'+id+'/'+crypto.randomUUID();
    if(!await db('rpc/sb_reserve_photo','POST',{p_key:key,p_bytes:bytes.length}))fail(409,'وصل التخزين إلى الحد المتاح.');
    await env.SHIPMENT_PHOTOS.put(key,bytes,{httpMetadata:{contentType:m[1]}});
    // Never delete an object on an uncertain DB response: it may already be referenced.
    return json(unknownPublic(await db('rpc/sb_unknown_photo','POST',{p_id:id,p_key:key,p_bytes:bytes.length,p_expected:stamp})));
   }
  }
 }
 if(route==='/api/delivery-requests'){
  delivery();
  if(method==='GET'){
   const path=page('sb_delivery_requests',['pending','accepted','closed','cancelled']);
   return json(result(await db(path+(u.role==='customer'?'&customer_code=eq.'+encodeURIComponent(u.code):''))));
  }
  if(method==='POST'){
   if(u.role!=='customer')fail(403,'يُرسل طلب التوصيل من حساب الزبون نفسه.');
   const b=await body(req),phone=normalizePhone(b.phone),address=text(b.address,600),note=optional(b.note,300);
   if(!/^\+?[0-9]{8,15}$/.test(phone)||address.length<8)fail(400,'أدخل رقم هاتف صحيحًا وعنوانًا واضحًا يشمل المدينة والمنطقة.');
   if(!Array.isArray(b.ids)||b.ids.length<1||b.ids.length>100)fail(400,'اختر من 1 إلى 100 شحنة.');
   const ids=b.ids.map(realTracking);if(new Set(ids).size!==ids.length)fail(400,'قائمة الشحنات مكررة.');
   // Customer identity deliberately comes only from the authenticated DB actor.
   return json(one(await db('rpc/sb_delivery_create','POST',{p_id:uuid(b.requestId),p_ids:ids,p_phone:phone,p_address:address,p_note:note})),201);
  }
 }
 const request=route.match(/^\/api\/delivery-requests\/([0-9a-f-]+)$/i);
 if(request&&method==='PATCH'){
  delivery();const b=await body(req);
  if(!['accepted','closed','cancelled'].includes(b.status))fail(400,'حالة الطلب غير صالحة.');
  if(u.role==='customer'&&b.status!=='cancelled')fail(403,'يمكنك إلغاء طلبك قبل بدء التنسيق فقط.');
  return json(one(await db('rpc/sb_delivery_update','POST',{p_id:uuid(request[1]),p_status:b.status,p_note:u.role==='customer'?'':optional(b.note,600),p_expected:expected(b.updatedAt)})));
 }
 fail(404,'المسار غير موجود.');
}

export function normalizePhone(v){return typeof v==='string'?v.trim().replace(/[٠-٩۰-۹]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[ ()-]/g,''):''}
