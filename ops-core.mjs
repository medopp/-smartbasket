// Pure, shared import/search logic. Workbook contents are data, never instructions.
export const normalize=v=>String(v??'').normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).trim();
export const code=v=>normalize(v).toUpperCase();
export const validCode=v=>/^[A-Z0-9-]{2,64}$/.test(v)&&v!=='LN-';
export const tripKey=t=>JSON.stringify([t.code??t.trip,t.country,t.mode]);
export const decimal=v=>Number(normalize(v).replace(/٫/g,'.').replace(/٬/g,'').replace(/,/g,'.'));
export const fold=v=>normalize(v).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064b-\u065f]/g,'');
export function searchShipments(rows,users,{query='',country='',mode='',trip='',step=''}={}){
 const people=new Map(users.map(u=>[u.code,u])),q=fold(query),digits=q.replace(/\D/g,'');
 return rows.filter(s=>{const u=people.get(s.customer)||{};return (!country||s.country===country)&&(!mode||s.mode===mode)&&(!trip||tripKey(s)===trip)&&(step===''||s.step===Number(step))&&(!q||[s.id,s.customer,u.name,u.phone].some(x=>fold(x).includes(q))||(digits.length>=4&&/^[\d\s+()-]+$/.test(q)&&String(u.phone||'').replace(/\D/g,'').includes(digits)));});
}
export function tripSummary(rows){
 const totals={count:rows.length,customers:new Set(rows.map(s=>s.customer)).size,kg:0,m3:0,states:[0,0,0,0,0]};
 rows.forEach(s=>{if(s.unit==='كجم')totals.kg+=Number(s.weightValue)||0;else if(s.unit==='متر مكعب')totals.m3+=Number(s.weightValue)||0;totals.states[s.step]++;});return totals;
}
export function attentionReasons(s,today=new Date().toISOString().slice(0,10)){
 const out=[];if(!s.trip||s.trip==='لم تُحدد')out.push('بدون رحلة');if(!s.customer||s.customer==='LN-')out.push('بدون زبون');if(!(Number(s.weightValue)>0))out.push('وزن ناقص');
 if(s.step<2&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&s.date<today)out.push('تجاوز موعد الوصول');
 if(s.step<4&&s.updatedAt&&(Date.parse(today)-Date.parse(s.updatedAt)>7*864e5))out.push('لم تتغير منذ 7 أيام');return out;
}
const aliases={id:['رقم التتبع','التتبع','تتبع','tracking','tracking number','tracking no','trackingnumber','单号','快递单号'],customer:['كود الزبون','كود العميل','الكود','كود','customer','customer code','code','客户代码','唛头'],weight:['الوزن','وزن','الوزن كجم','الوزن kg','weight','kg','重量','重量kg'],category:['النوع','الصنف','التصنيف','تصنيف الشحنة','category','نوع البضاعه','نوع البضاعة']};
export function guessColumns(rows){
 let best={header:0,id:-1,customer:-1,weight:-1,category:-1},score=-1;
 rows.slice(0,30).forEach((r,header)=>{const next={header,id:-1,customer:-1,weight:-1,category:-1};Object.entries(aliases).forEach(([key,names])=>{next[key]=r.findIndex(v=>names.some(a=>fold(v).replace(/[:：()]/g,'').trim()===fold(a)));});const n=['id','customer','weight'].filter(k=>next[k]>=0).length;if(n>score){score=n;best=next;}});return best;
}
export function importRows(grid,columns){
 if(new Set([columns.id,columns.customer,columns.weight]).size!==3||[columns.id,columns.customer,columns.weight].some(c=>!Number.isInteger(c)||c<0))throw Error('اختر ثلاثة أعمدة مختلفة للتتبع والكود والوزن.');
 return grid.slice(columns.header+1).map((r,i)=>({row:i+columns.header+2,id:code(r[columns.id]),originalCustomer:code(r[columns.customer]),weight:decimal(r[columns.weight]),category:columns.category>=0?normalize(r[columns.category]):'عام'})).filter(r=>(r.id||r.originalCustomer||r.weight)&&!(!r.id&&/^(اجمالي|الاجمالي|المجموع|total|grand total)/i.test(fold(r.originalCustomer))));
}
export function reviewImport(rows,users,shipments,{mapping={},trip,actions={},excluded=new Set(),unit}={}){
 const customers=new Set(users.filter(u=>u.role==='customer'&&u.active).map(u=>u.code)),existing=new Map(shipments.map(s=>[s.id,s])),seen=new Set();
 return rows.map(r=>{const customer=code(mapping[r.originalCustomer]??r.originalCustomer),old=existing.get(r.id),errors=[];
  const skip=excluded.has(r.row)||r.originalCustomer==='LN-'||actions[r.row]==='skip';
  if(!validCode(r.id)||/^\d\.\d+E[+-]?\d+$/.test(r.id))errors.push('رقم تتبع غير صالح؛ خزّن الأرقام الطويلة كنص');
  if(!customers.has(customer))errors.push('الكود غير موجود أو موقوف');if(!Number.isFinite(r.weight)||r.weight<=0||r.weight>100000)errors.push('وزن غير صالح');
  if(seen.has(r.id)&&!skip)errors.push('مكرر داخل الملف');if(!skip)seen.add(r.id);
  if(!trip)errors.push('اختر رحلة');else{if(trip.step>0&&(!old||tripKey(old)!==tripKey(trip)))errors.push('الرحلة غادرت المخزن');if(unit&&unit!==(trip.mode==='جوي'?'كجم':'متر مكعب'))errors.push('الوحدة لا تطابق نوع الرحلة؛ الجوي كجم والبحري متر مكعب');}
  const action=old?(actions[r.row]==='update'?'update':'review'):'create';if(old&&action==='review')errors.push('موجود مسبقًا؛ اختر تجاهل أو تحديث ونقل');
  return {...r,customer,unit:unit||'كجم',old,action:skip?'skip':action,errors:skip?[]:errors,skip};
 });
}
export function csv(rows){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
