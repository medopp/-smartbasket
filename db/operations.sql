-- Additive upgrade for the existing Smartbasket database. No shipment backfill or deletion.
alter table public.sb_shipments add column if not exists updated_at timestamptz not null default now();
alter table public.sb_shipments add column if not exists category text not null default 'عام';
alter table public.sb_accounts add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.sb_accounts drop constraint if exists sb_accounts_role_check;
alter table public.sb_accounts add constraint sb_accounts_role_check check(role in ('admin','staff','warehouse','accountant','customer'));

create table if not exists public.sb_audit (
 id bigint generated always as identity primary key, actor text not null, entity text not null, entity_id text not null,
 action text not null, before_data jsonb, after_data jsonb, batch_id text, created_at timestamptz not null default now()
);
create index if not exists sb_audit_recent on public.sb_audit(created_at desc,id desc);
create index if not exists sb_audit_entity on public.sb_audit(entity_id,created_at desc);
create table if not exists public.sb_notifications (
 id uuid primary key default gen_random_uuid(), customer_code text not null references public.sb_accounts(code),
 trip text not null,country text not null,mode text not null,step smallint not null check(step between 1 and 4),
 shipment_count integer not null default 1, read_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), whatsapp_status text not null default 'not_connected',
 whatsapp_message_id text, whatsapp_attempts integer not null default 0, whatsapp_next_attempt timestamptz,
 whatsapp_error text, unique(customer_code,trip,country,mode,step)
);
create index if not exists sb_notifications_customer on public.sb_notifications(customer_code,updated_at desc);
create table if not exists public.sb_rates (
 country text not null,mode text not null,category text not null,unit text not null,currency text not null,
 rate numeric(14,4) not null check(rate>0 and rate<=1000000),updated_at timestamptz not null default now(),
 primary key(country,mode,category), check(country in ('الصين','الإمارات','السعودية')),check(mode in ('جوي','بحري')),
 check(unit in ('كجم','متر مكعب')),check(currency in ('USD','LYD','CNY','AED','SAR'))
);
create table if not exists public.sb_invoices (
 id uuid primary key default gen_random_uuid(),number bigint generated always as identity unique,
 customer_code text not null references public.sb_accounts(code),currency text not null,settlement_currency text not null,
 exchange_rate numeric(16,6) not null check(exchange_rate>0),total numeric(16,2) not null check(total>0),
 settlement_total numeric(16,2) not null check(settlement_total>0),lines jsonb not null,
 created_by text not null,created_at timestamptz not null default now(),request_id uuid not null unique
);
create index if not exists sb_invoices_customer on public.sb_invoices(customer_code,created_at desc);
create table if not exists public.sb_invoice_shipments (
 shipment_id text primary key,invoice_id uuid not null references public.sb_invoices(id)
);
create index if not exists sb_invoice_shipments_invoice on public.sb_invoice_shipments(invoice_id);
create table if not exists public.sb_payments (
 id uuid primary key,invoice_id uuid not null references public.sb_invoices(id),amount numeric(16,2) not null check(amount>0),
 note text not null default '',created_by text not null,created_at timestamptz not null default now()
);
create index if not exists sb_payments_invoice on public.sb_payments(invoice_id);
alter table public.sb_audit enable row level security;
alter table public.sb_notifications enable row level security;
alter table public.sb_rates enable row level security;
alter table public.sb_invoices enable row level security;
alter table public.sb_invoice_shipments enable row level security;
alter table public.sb_payments enable row level security;
revoke all on public.sb_audit,public.sb_notifications,public.sb_rates,public.sb_invoices,public.sb_invoice_shipments,public.sb_payments from public,anon,authenticated;
grant select,insert,update,delete on public.sb_audit,public.sb_notifications,public.sb_rates,public.sb_invoices,public.sb_invoice_shipments,public.sb_payments to service_role;
grant usage,select on sequence public.sb_audit_id_seq,public.sb_invoices_number_seq to service_role;

create or replace function public.sb_request_actor() returns text language sql stable security invoker set search_path='' as $$
 select coalesce(nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sb-actor',''),'system');
$$;
create or replace function public.sb_touch_shipment() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=clock_timestamp();return new;end $$;
drop trigger if exists sb_shipment_touch on public.sb_shipments;
create trigger sb_shipment_touch before update on public.sb_shipments for each row execute function public.sb_touch_shipment();
create or replace function public.sb_audit_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare before_row jsonb;after_row jsonb;entity_key text;
begin
 if tg_op<>'INSERT' then before_row=to_jsonb(old)-'salt'-'password_hash'-'photo_key'-'photo_bytes';end if;
 if tg_op<>'DELETE' then after_row=to_jsonb(new)-'salt'-'password_hash'-'photo_key'-'photo_bytes';end if;
 entity_key=coalesce(after_row->>'id',before_row->>'id',after_row->>'code',before_row->>'code',after_row->>'trip_code',before_row->>'trip_code',after_row->>'category',before_row->>'category','');
 insert into public.sb_audit(actor,entity,entity_id,action,before_data,after_data,batch_id)
 values(public.sb_request_actor(),tg_table_name,entity_key,tg_op,before_row,after_row,coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sb-batch');
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists sb_shipment_audit on public.sb_shipments;
create trigger sb_shipment_audit after insert or update or delete on public.sb_shipments for each row execute function public.sb_audit_change();
drop trigger if exists sb_trip_audit on public.sb_trips;
create trigger sb_trip_audit after insert or update or delete on public.sb_trips for each row execute function public.sb_audit_change();
drop trigger if exists sb_account_audit on public.sb_accounts;
create trigger sb_account_audit after insert or update or delete on public.sb_accounts for each row execute function public.sb_audit_change();
drop trigger if exists sb_rate_audit on public.sb_rates;
create trigger sb_rate_audit after insert or update or delete on public.sb_rates for each row execute function public.sb_audit_change();
drop trigger if exists sb_invoice_audit on public.sb_invoices;
create trigger sb_invoice_audit after insert on public.sb_invoices for each row execute function public.sb_audit_change();
drop trigger if exists sb_payment_audit on public.sb_payments;
create trigger sb_payment_audit after insert on public.sb_payments for each row execute function public.sb_audit_change();

create or replace function public.sb_notify_shipment() returns trigger language plpgsql security invoker set search_path='' as $$
declare n integer;connected boolean;opted boolean;
begin
 if new.step=0 or (tg_op='UPDATE' and old.step=new.step and old.customer_code=new.customer_code and old.trip=new.trip and old.country=new.country and old.mode=new.mode) then return new;end if;
 select count(*) into n from public.sb_shipments where customer_code=new.customer_code and trip=new.trip and country=new.country and mode=new.mode and step=new.step;
 connected=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sb-whatsapp'='enabled';
 select whatsapp_opt_in into opted from public.sb_accounts where code=new.customer_code;
 insert into public.sb_notifications(customer_code,trip,country,mode,step,shipment_count,whatsapp_status,whatsapp_next_attempt)
 values(new.customer_code,new.trip,new.country,new.mode,new.step,n,case when connected and opted then 'pending' else 'not_connected' end,now()+interval '2 minutes')
 on conflict(customer_code,trip,country,mode,step) do update set shipment_count=excluded.shipment_count,updated_at=now(),read_at=null,
 whatsapp_next_attempt=case when sb_notifications.whatsapp_status='pending' then now()+interval '2 minutes' else sb_notifications.whatsapp_next_attempt end;
 return new;
end $$;
drop trigger if exists sb_shipment_notification on public.sb_shipments;
create trigger sb_shipment_notification after insert or update on public.sb_shipments for each row execute function public.sb_notify_shipment();

create or replace function public.sb_operations_batch(p_kind text,p_rows jsonb,p_trip text default null,p_country text default null,p_mode text default null,p_step integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;s public.sb_shipments;t public.sb_trips;a public.sb_accounts;created integer=0;updated integer=0;identifier text;customer text;qty numeric;unit_value text;
begin
 select * into a from public.sb_accounts where code=public.sb_request_actor() and active for share;
 if a.role is null or a.role not in ('admin','staff','warehouse') then raise exception 'SB:لا تملك صلاحية تعديل الشحنات.';end if;
 if p_kind is null or p_kind not in ('import','transfer','status') or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'SB:دفعة غير صالحة.';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'SB:أرقام مكررة داخل الدفعة.';end if;
 if p_kind in ('import','transfer') then
  select * into t from public.sb_trips where trip_code=p_trip and country=p_country and mode=p_mode for update;
  if not found then raise exception 'SB:الرحلة غير موجودة.';end if;
 end if;
 if p_kind='status' and (p_step is null or p_step not between 0 and 4) then raise exception 'SB:حالة غير صالحة.';end if;
 -- Stable lock order; the reviewed version must still match at commit time.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  identifier=r->>'id';if identifier is null or identifier!~'^[A-Z0-9-]{2,64}$' or identifier='LN-' then raise exception 'SB:رقم تتبع غير صالح.';end if;
  select * into s from public.sb_shipments where id=identifier for update;
  if p_kind<>'import' or r->>'action'='update' then
   if s.id is null or r->>'updatedAt' is null or s.updated_at<>(r->>'updatedAt')::timestamptz then raise exception 'SB:تغيرت بيانات إحدى الشحنات بعد المراجعة. حدّث الصفحة وأعد مراجعة الدفعة.';end if;
  elsif coalesce(r->>'action','')<>'create' or s.id is not null then raise exception 'SB:شحنة موجودة أو قرار غير صالح. أعد المراجعة.';end if;
  if p_kind='status' then update public.sb_shipments set step=p_step where id=identifier;updated=updated+1;continue;end if;
  if t.step>0 and (s.id is null or s.trip<>t.trip_code or s.country<>t.country or s.mode<>t.mode) then raise exception 'SB:لا يمكن النقل إلى رحلة غادرت المخزن.';end if;
  if p_kind='transfer' then
   if s.unit<>(case when t.mode='جوي' then 'كجم' else 'متر مكعب' end) then raise exception 'SB:وحدة الشحنة لا تطابق نوع الرحلة. عدّل القياس أولًا؛ لا نحول الوزن إلى حجم تلقائيًا.';end if;
   update public.sb_shipments set trip=t.trip_code,country=t.country,mode=t.mode,ship_date=t.arrival_date where id=identifier;updated=updated+1;continue;
  end if;
  customer=r->>'customer';qty=(r->>'weight')::numeric;unit_value=r->>'unit';
  if customer is null or customer='LN-' or not exists(select 1 from public.sb_accounts where code=customer and role='customer' and active) then raise exception 'SB:كود الزبون غير موجود أو موقوف.';end if;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>100000 or unit_value is null or unit_value<>(case when t.mode='جوي' then 'كجم' else 'متر مكعب' end) then raise exception 'SB:وزن أو وحدة غير صالحة للرحلة.';end if;
  if length(coalesce(r->>'category','عام')) not between 1 and 80 then raise exception 'SB:التصنيف غير صالح.';end if;
  if s.id is null then
   insert into public.sb_shipments(id,customer_code,country,mode,weight,unit,trip,ship_date,category) values(identifier,customer,t.country,t.mode,qty,unit_value,t.trip_code,t.arrival_date,coalesce(r->>'category','عام'));created=created+1;
  else
   update public.sb_shipments set customer_code=customer,country=t.country,mode=t.mode,weight=qty,unit=unit_value,trip=t.trip_code,ship_date=t.arrival_date,category=coalesce(r->>'category','عام') where id=identifier;updated=updated+1;
  end if;
 end loop;
 return jsonb_build_object('created',created,'updated',updated,'batchId',coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sb-batch');
end $$;

create or replace function public.sb_trip_update(p_trip text,p_country text,p_mode text,p_step integer,p_date date default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare total integer;
begin
 if not exists(select 1 from public.sb_accounts where code=public.sb_request_actor() and active and role in ('admin','staff','warehouse')) then raise exception 'SB:ليست لديك صلاحية.';end if;
 if p_step is null or p_step not between 0 and 4 then raise exception 'SB:حالة غير صالحة.';end if;
 perform 1 from public.sb_trips where trip_code=p_trip and country=p_country and mode=p_mode for update;
 if not found then raise exception 'SB:الرحلة غير موجودة.';end if;
 update public.sb_trips set step=p_step,arrival_date=coalesce(p_date,arrival_date) where trip_code=p_trip and country=p_country and mode=p_mode;
 update public.sb_shipments set step=p_step,ship_date=coalesce(p_date,ship_date) where trip=p_trip and country=p_country and mode=p_mode;
 get diagnostics total=row_count;return total;
end $$;

create or replace function public.sb_issue_invoice(p_customer text,p_ids jsonb,p_currency text,p_settlement_currency text,p_exchange_rate numeric,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.sb_accounts;s public.sb_shipments;r public.sb_rates;i public.sb_invoices;lines jsonb='[]';total numeric=0;line_total numeric;counted integer=0;
begin
 select * into a from public.sb_accounts where code=public.sb_request_actor() and active;
 if a.role is null or a.role not in ('admin','accountant') then raise exception 'SB:هذه العملية للمحاسب أو الإدارة.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into i from public.sb_invoices where request_id=p_request;if found then return to_jsonb(i);end if;
 if p_ids is null or jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids) not between 1 and 1000 or p_currency is null or p_settlement_currency is null or p_currency not in ('USD','LYD','CNY','AED','SAR') or p_settlement_currency not in ('USD','LYD','CNY','AED','SAR') or p_exchange_rate is null or p_exchange_rate<=0 or p_exchange_rate>1000000 or (p_currency=p_settlement_currency and p_exchange_rate<>1) then raise exception 'SB:بيانات الفاتورة غير صالحة.';end if;
 for s in select * from public.sb_shipments where id in(select value->>'id' from jsonb_array_elements(p_ids)) order by id for update loop
  if s.customer_code<>p_customer or exists(select 1 from public.sb_invoice_shipments where shipment_id=s.id) then raise exception 'SB:شحنة تخص زبونًا آخر أو سبق إصدار فاتورة لها.';end if;
  select * into r from public.sb_rates where country=s.country and mode=s.mode and category=s.category for share;
  if r.rate is null or r.unit<>s.unit or r.currency<>p_currency then raise exception 'SB:أضف سعرًا معتمدًا بنفس العملة والوحدة لكل تصنيف قبل إصدار الفاتورة.';end if;
  if not exists(select 1 from jsonb_array_elements(p_ids) item where item->>'id'=s.id and (item->>'updatedAt')::timestamptz=s.updated_at and (item->>'rateUpdatedAt')::timestamptz=r.updated_at) then raise exception 'SB:تغيرت الشحنة أو السعر بعد مراجعة الفاتورة. حدّث البيانات وأعد المراجعة.';end if;
  line_total=round(s.weight*r.rate,2);total=total+line_total;counted=counted+1;
  lines=lines||jsonb_build_array(jsonb_build_object('id',s.id,'trip',s.trip,'country',s.country,'mode',s.mode,'category',s.category,'quantity',s.weight,'unit',s.unit,'rate',r.rate,'amount',line_total));
 end loop;
 if counted<>jsonb_array_length(p_ids) or total<=0 then raise exception 'SB:قائمة الشحنات غير صالحة.';end if;
 insert into public.sb_invoices(customer_code,currency,settlement_currency,exchange_rate,total,settlement_total,lines,created_by,request_id) values(p_customer,p_currency,p_settlement_currency,p_exchange_rate,total,round(total*p_exchange_rate,2),lines,a.code,p_request) returning * into i;
 insert into public.sb_invoice_shipments(shipment_id,invoice_id) select value->>'id',i.id from jsonb_array_elements(p_ids);
 return to_jsonb(i);
end $$;
create or replace function public.sb_record_payment(p_id uuid,p_invoice uuid,p_amount numeric,p_note text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.sb_invoices;p public.sb_payments;paid numeric;
begin
 if not exists(select 1 from public.sb_accounts where code=public.sb_request_actor() and active and role in ('admin','accountant')) then raise exception 'SB:هذه العملية للمحاسب أو الإدارة.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into p from public.sb_payments where id=p_id;if found then return to_jsonb(p);end if;
 select * into i from public.sb_invoices where id=p_invoice for update;if not found then raise exception 'SB:الفاتورة غير موجودة.';end if;
 select coalesce(sum(amount),0) into paid from public.sb_payments where invoice_id=p_invoice;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>i.settlement_total-paid or length(p_note)>250 then raise exception 'SB:المبلغ غير صالح أو أكبر من الرصيد المتبقي.';end if;
 insert into public.sb_payments(id,invoice_id,amount,note,created_by) values(p_id,p_invoice,p_amount,p_note,public.sb_request_actor()) returning * into p;return to_jsonb(p);
end $$;

revoke execute on function public.sb_request_actor(),public.sb_touch_shipment(),public.sb_audit_change(),public.sb_notify_shipment(),public.sb_operations_batch(text,jsonb,text,text,text,integer),public.sb_trip_update(text,text,text,integer,date),public.sb_issue_invoice(text,jsonb,text,text,numeric,uuid),public.sb_record_payment(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.sb_request_actor(),public.sb_touch_shipment(),public.sb_audit_change(),public.sb_notify_shipment(),public.sb_operations_batch(text,jsonb,text,text,text,integer),public.sb_trip_update(text,text,text,integer,date),public.sb_issue_invoice(text,jsonb,text,text,numeric,uuid),public.sb_record_payment(uuid,uuid,numeric,text) to service_role;

create table if not exists public.sb_reconciliations (
 id uuid primary key default gen_random_uuid(),trip text not null,country text not null,mode text not null,
 expected_ids jsonb not null,scanned_ids jsonb not null,created_by text not null,created_at timestamptz not null default now()
);
create index if not exists sb_reconciliations_trip on public.sb_reconciliations(trip,country,mode,created_at desc);
alter table public.sb_reconciliations enable row level security;
revoke all on public.sb_reconciliations from public,anon,authenticated;
grant select,insert on public.sb_reconciliations to service_role;
create or replace function public.sb_save_reconciliation(p_trip text,p_country text,p_mode text,p_scanned jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.sb_reconciliations;expected jsonb;
begin
 if not exists(select 1 from public.sb_accounts where code=public.sb_request_actor() and active and role in ('admin','staff','warehouse')) then raise exception 'SB:لا تملك صلاحية حفظ تقارير المخزن.';end if;
 if p_scanned is null or jsonb_typeof(p_scanned)<>'array' or jsonb_array_length(p_scanned) not between 1 and 2000 then raise exception 'SB:قائمة المسح غير صالحة.';end if;
 perform 1 from public.sb_trips where trip_code=p_trip and country=p_country and mode=p_mode for share;
 if not found then raise exception 'SB:الرحلة غير موجودة.';end if;
 select coalesce(jsonb_agg(id order by id),'[]') into expected from public.sb_shipments where trip=p_trip and country=p_country and mode=p_mode;
 insert into public.sb_reconciliations(trip,country,mode,expected_ids,scanned_ids,created_by) values(p_trip,p_country,p_mode,expected,p_scanned,public.sb_request_actor()) returning * into result;return to_jsonb(result);
end $$;
revoke execute on function public.sb_save_reconciliation(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_reconciliation(text,text,text,jsonb) to service_role;

create or replace function public.sb_claim_whatsapp() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 -- Never retry an uncertain send automatically: that could message a customer twice.
 update public.sb_notifications set whatsapp_status='unknown',whatsapp_error='راجع نتيجة الإرسال لدى Meta قبل إعادة المحاولة.' where whatsapp_status='sending' and whatsapp_next_attempt<now()-interval '15 minutes';
 update public.sb_notifications n set whatsapp_status='not_connected' where n.whatsapp_status='pending' and not exists(select 1 from public.sb_accounts a where a.code=n.customer_code and a.active and a.whatsapp_opt_in);
 with picked as(select n.id from public.sb_notifications n join public.sb_accounts a on a.code=n.customer_code where n.whatsapp_status='pending' and n.whatsapp_next_attempt<=now() and n.whatsapp_attempts<3 and a.active and a.whatsapp_opt_in order by n.whatsapp_next_attempt for update of n skip locked limit 10),
 claimed as(update public.sb_notifications n set whatsapp_status='sending',whatsapp_attempts=whatsapp_attempts+1,whatsapp_next_attempt=now() from picked where n.id=picked.id returning n.*)
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('phone',a.phone,'name',a.name)),'[]') into result from claimed c join public.sb_accounts a on a.code=c.customer_code;
 return result;
end $$;
revoke execute on function public.sb_claim_whatsapp() from public,anon,authenticated;
grant execute on function public.sb_claim_whatsapp() to service_role;
