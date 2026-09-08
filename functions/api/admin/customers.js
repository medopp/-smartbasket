const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
const customerEmail=code=>"customer-"+code.toLowerCase().replace(/[^a-z0-9]/g,"")+"@accounts.smartbasket.local";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response(null,{headers:cors});
  if (context.request.method !== "POST") return reply({error:"الطلب غير مسموح"},405);
  const baseUrl=context.env.SUPABASE_URL;
  const serviceKey=context.env.SUPABASE_SERVICE_ROLE_KEY;
  const bearer=context.request.headers.get("Authorization");
  if (!baseUrl || !serviceKey) return reply({error:"إعدادات إدارة العملاء غير مكتملة"},500);
  if (!bearer?.startsWith("Bearer ")) return reply({error:"سجل دخول المدير أولاً"},401);
  try {
    const meResponse=await fetch(baseUrl+"/auth/v1/user",{headers:{apikey:serviceKey,Authorization:bearer}});
    const me=await meResponse.json();
    if (!meResponse.ok || me.app_metadata?.role!=="admin") return reply({error:"هذه الخدمة متاحة للمدير فقط"},403);
    const {customerCode,password,fullName="",phone=""}=await context.request.json();
    const code=String(customerCode||"").trim().toUpperCase();
    if (!/^[A-Z]{2,8}-\d{3,10}$/.test(code)) return reply({error:"اكتب كوداً مثل LN-1010"},400);
    if (String(password||"").length<8) return reply({error:"كلمة المرور يجب أن تكون 8 أحرف أو أرقام على الأقل"},400);
    const created=await fetch(baseUrl+"/auth/v1/admin/users",{method:"POST",headers:{"Content-Type":"application/json",apikey:serviceKey,Authorization:"Bearer "+serviceKey},body:JSON.stringify({email:customerEmail(code),password,email_confirm:true,app_metadata:{role:"customer",customer_code:code},user_metadata:{full_name:String(fullName).trim(),phone:String(phone).trim(),customer_code:code}})});
    const result=await created.json();
    if (!created.ok) return reply({error:result?.msg||result?.message||"تعذر إنشاء حساب العميل"},created.status);
    return reply({success:true,customerCode:code,customerId:result.id||result.user?.id});
  } catch (error) { return reply({error:"حدث خطأ أثناء إنشاء العميل",details:error?.message||String(error)},500); }
}
