// Optional WhatsApp Cloud API dispatcher. Disabled until Meta onboarding, template
// approval, secrets, opt-in and the scheduled trigger have all been configured.
const states=['','غادرت المخزن','وصلت إلى ليبيا','جاهزة للاستلام','تم التسليم'];
export function phoneNumber(value){let n=String(value||'').replace(/[^\d+]/g,'');if(/^0[9][1245]\d{7}$/.test(n))n='218'+n.slice(1);else n=n.replace(/^\+|^00/,'');return /^[1-9]\d{7,14}$/.test(n)?n:null;}
async function database(env,path,method='GET',body){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Database request failed');return r.status===204?null:r.json();}
export async function dispatch(env){
 if(env.WHATSAPP_ENABLED!=='true')return {disabled:true};
 if(!env.WHATSAPP_TOKEN||!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID||'')||!/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION||'')||!env.WHATSAPP_TEMPLATE||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('WhatsApp configuration incomplete');
 const jobs=await database(env,'rpc/sb_claim_whatsapp','POST',{});let accepted=0;
 for(const job of jobs){const path='sb_notifications?id=eq.'+encodeURIComponent(job.id),to=phoneNumber(job.phone);let patch;
  // Recheck consent immediately before sending, not merely when queueing.
  const [account]=await database(env,'sb_accounts?select=active,whatsapp_opt_in,phone&code=eq.'+encodeURIComponent(job.customer_code));
  if(!account?.active||!account.whatsapp_opt_in||account.phone!==job.phone){await database(env,path,'PATCH',{whatsapp_status:'not_connected',whatsapp_error:'الموافقة أو الهاتف تغيرا قبل الإرسال.'});continue;}
  if(!to){await database(env,path,'PATCH',{whatsapp_status:'failed',whatsapp_error:'رقم الزبون يحتاج تصحيحًا بصيغة دولية.'});continue;}
  try{
   const r=await fetch(`https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'template',template:{name:env.WHATSAPP_TEMPLATE,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||'ar'},components:[{type:'body',parameters:[job.name,job.trip,String(job.shipment_count),states[job.step],'https://smartbasket.com.ly/'].map(text=>({type:'text',text}))}]}}),signal:AbortSignal.timeout(20000)});
   const data=await r.json().catch(()=>({}));if(r.ok&&data.messages?.[0]?.id){patch={whatsapp_status:'sent',whatsapp_message_id:data.messages[0].id,whatsapp_error:null};accepted++;}
   else if(r.status===429&&job.whatsapp_attempts<3){patch={whatsapp_status:'pending',whatsapp_next_attempt:new Date(Date.now()+job.whatsapp_attempts*300000).toISOString(),whatsapp_error:'تجاوز حد الإرسال؛ إعادة محاولة مؤجلة.'};}
   else patch={whatsapp_status:r.status>=500||r.ok?'unknown':'failed',whatsapp_error:`Meta HTTP ${r.status}${data.error?.code?' / code '+data.error.code:''}`};
  }catch{patch={whatsapp_status:'unknown',whatsapp_error:'نتيجة طلب Meta غير مؤكدة. لا إعادة إرسال تلقائيًا لتجنب التكرار.'};}
  await database(env,path,'PATCH',patch);
 }
 return {claimed:jobs.length,accepted};
}
async function verifySignature(raw,header,secret){if(!secret||!/^sha256=[a-f0-9]{64}$/.test(header||''))return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);const sig=Uint8Array.from(header.slice(7).match(/../g),h=>parseInt(h,16));return crypto.subtle.verify('HMAC',key,sig,raw);}
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(dispatch(env));},
 async fetch(req,env){const url=new URL(req.url);if(url.pathname!=='/webhook')return new Response('Not found',{status:404});
  if(req.method==='GET'){if(!env.WHATSAPP_VERIFY_TOKEN||url.searchParams.get('hub.verify_token')!==env.WHATSAPP_VERIFY_TOKEN||url.searchParams.get('hub.mode')!=='subscribe')return new Response('Forbidden',{status:403});return new Response(url.searchParams.get('hub.challenge')||'');}
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});const reader=req.body?.getReader();if(!reader)return new Response('Bad request',{status:400});const chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1048576){await reader.cancel();return new Response('Too large',{status:413})}chunks.push(r.value)}const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}
  if(!await verifySignature(raw,req.headers.get('x-hub-signature-256'),env.WHATSAPP_APP_SECRET))return new Response('Forbidden',{status:403});
  try{const payload=JSON.parse(new TextDecoder().decode(raw));for(const entry of payload.entry||[])for(const change of entry.changes||[])for(const status of change.value?.statuses||[]){if(!['delivered','read','failed'].includes(status.status)||typeof status.id!=='string'||status.id.length>250)continue;const path='sb_notifications?whatsapp_message_id=eq.'+encodeURIComponent(status.id);const conditions=status.status==='delivered'?'&whatsapp_status=in.(sent,unknown)':status.status==='read'?'&whatsapp_status=in.(sent,delivered,unknown)':'&whatsapp_status=in.(sent,unknown)';await database(env,path+conditions,'PATCH',{whatsapp_status:status.status,...status.status==='failed'?{whatsapp_error:'Meta delivery failed'}:{}})}return new Response('OK');}catch{return new Response('Processing failed',{status:500});}
 }
};
