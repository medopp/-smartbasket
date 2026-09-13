-- Service-only API: authentication is verified by the Cloudflare Worker.
-- No customer-facing Supabase grants or policies; all RPCs are SECURITY INVOKER.
create table public.sb_unknown_shipments (
 id uuid primary key,
 tracking text unique check (tracking is null or (tracking ~ '^[A-Z0-9-]{2,64}$' and tracking <> 'LN-')),
 description text not null check (length(description) between 3 and 600),
 received_on date not null,
 photo_key text, photo_bytes bigint not null default 0,
 status text not null default 'unresolved' check (status in ('unresolved','linked')),
 customer_code text references public.sb_accounts(code),
 linked_shipment_id text references public.sb_shipments(id) on update cascade on delete restrict,
 confirmation_note text,
 created_by text not null, confirmed_by text, confirmed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check ((status='unresolved' and customer_code is null and linked_shipment_id is null and confirmed_at is null)
     or (status='linked' and customer_code is not null and linked_shipment_id is not null and confirmed_at is not null))
);
create index sb_unknown_status_created on public.sb_unknown_shipments(status,created_at desc,id);
create index sb_unknown_customer on public.sb_unknown_shipments(customer_code);
create index sb_unknown_linked_shipment on public.sb_unknown_shipments(linked_shipment_id);

create table public.sb_delivery_requests (
 id uuid primary key,
 customer_code text not null references public.sb_accounts(code),
 phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
 address text not null check (length(address) between 8 and 600),
 note text not null default '' check (length(note)<=300),
 shipments jsonb not null check (jsonb_typeof(shipments)='array' and jsonb_array_length(shipments) between 1 and 100),
 status text not null default 'pending' check (status in ('pending','accepted','closed','cancelled')),
 response_note text not null default '' check (length(response_note)<=600),
 updated_by text not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index sb_delivery_customer_created on public.sb_delivery_requests(customer_code,created_at desc,id);
create index sb_delivery_status_created on public.sb_delivery_requests(status,created_at desc,id);
create table public.sb_delivery_items (
 request_id uuid not null references public.sb_delivery_requests(id) on delete restrict,
 shipment_id text not null references public.sb_shipments(id) on update restrict on delete restrict,
 active boolean not null default true,
 primary key(request_id,shipment_id)
);
create unique index sb_delivery_one_active on public.sb_delivery_items(shipment_id) where active;
create index sb_delivery_shipment on public.sb_delivery_items(shipment_id);

alter table public.sb_unknown_shipments enable row level security;
alter table public.sb_delivery_requests enable row level security;
alter table public.sb_delivery_items enable row level security;
revoke all on public.sb_unknown_shipments,public.sb_delivery_requests,public.sb_delivery_items from public,anon,authenticated;
grant select,insert,update on public.sb_unknown_shipments,public.sb_delivery_requests,public.sb_delivery_items to service_role;

create function public.sb_service_role(p_roles text[]) returns text language plpgsql set search_path='' as $$
declare actor text:=public.sb_request_actor();
begin
 if not exists(select 1 from public.sb_accounts where code=actor and active and role=any(p_roles)) then
  raise exception 'SB:ليست لديك صلاحية لهذه العملية.';
 end if;
 return actor;
end $$;

create function public.sb_unknown_create(p_id uuid,p_tracking text,p_description text,p_received date)
returns public.sb_unknown_shipments language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['admin','staff','warehouse']); r public.sb_unknown_shipments;
begin
 -- Serialize retries of the same request, without a table-wide lock.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into r from public.sb_unknown_shipments where id=p_id;
 if found then
  if r.created_by<>actor or r.tracking is distinct from p_tracking or r.description<>p_description or r.received_on<>p_received then
   raise exception 'SB:رقم العملية مستخدم لبيانات مختلفة. حدّث القائمة قبل المحاولة.';
  end if;
  return r;
 end if;
 if p_received is null or p_received>current_date+1 or p_received<date '2000-01-01' then raise exception 'SB:تاريخ الاستلام غير صالح.';end if;
 if exists(select 1 from public.sb_shipments where id=p_tracking) then raise exception 'SB:رقم التتبع مسجل أصلًا كشحنة مرتبطة بزبون.';end if;
 insert into public.sb_unknown_shipments(id,tracking,description,received_on,created_by)
 values(p_id,p_tracking,p_description,p_received,actor) returning * into r;
 return r;
end $$;

create function public.sb_unknown_photo(p_id uuid,p_key text,p_bytes bigint,p_expected timestamptz)
returns public.sb_unknown_shipments language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['admin','staff','warehouse']); r public.sb_unknown_shipments;
begin
 select * into r from public.sb_unknown_shipments where id=p_id for update;
 if not found or r.status<>'unresolved' then raise exception 'SB:الشحنة غير موجودة أو تم ربطها؛ حدّث القائمة.';end if;
 if r.updated_at is distinct from p_expected then raise exception 'SB:تغيرت الشحنة؛ حدّث القائمة قبل رفع الصورة.';end if;
 if p_key not like 'unknown/'||p_id::text||'/%' or not exists(select 1 from public.sb_photo_objects where object_key=p_key and bytes=p_bytes) then
  raise exception 'SB:الصورة غير مسجلة في التخزين.';
 end if;
 update public.sb_unknown_shipments set photo_key=p_key,photo_bytes=p_bytes where id=p_id returning * into r;
 return r;
end $$;

create function public.sb_unknown_link(p_id uuid,p_data jsonb,p_expected timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['admin','staff','warehouse']); r public.sb_unknown_shipments;
 cust text:=p_data->>'customer'; tracking text:=p_data->>'tracking'; t public.sb_trips; s public.sb_shipments;
begin
 select * into r from public.sb_unknown_shipments where id=p_id for update;
 if not found then raise exception 'SB:الشحنة غير موجودة.';end if;
 if r.status='linked' then
  if r.linked_shipment_id=tracking and r.customer_code=cust then return jsonb_build_object('ok',true,'shipment',r.linked_shipment_id,'replayed',true);end if;
  raise exception 'SB:سبق ربط هذه الشحنة بزبون؛ لا يمكن استبدال المالك من هنا.';
 end if;
 if r.updated_at is distinct from p_expected then raise exception 'SB:تغيرت الشحنة؛ حدّث القائمة قبل الربط.';end if;
 if tracking is null or tracking !~ '^[A-Z0-9-]{2,64}$' or tracking='LN-' or (r.tracking is not null and r.tracking<>tracking) then raise exception 'SB:أدخل رقم التتبع الحقيقي المسجل على الشحنة.';end if;
 if coalesce(p_data->>'confirmed','false')<>'true' or length(btrim(coalesce(p_data->>'confirmation','')))<5 or length(p_data->>'confirmation')>600 then raise exception 'SB:أكد ملكية الزبون وسجّل دليل التحقق.';end if;
 perform 1 from public.sb_accounts where code=cust and role='customer' and active for share;
 if not found then raise exception 'SB:اختر حساب زبون موجودًا ومفعّلًا.';end if;
 select * into t from public.sb_trips where trip_code=p_data->>'trip' and country=p_data->>'country' and mode=p_data->>'mode' for share;
 if not found or t.step<>0 then raise exception 'SB:اختر رحلة محفوظة لم تغادر المخزن.';end if;
 if coalesce((p_data->>'weight')::numeric,0)<=0 or (p_data->>'weight')::numeric>100000 or
  (p_data->>'unit') is distinct from (case when t.mode='جوي' then 'كجم' else 'متر مكعب' end) or
  coalesce((p_data->>'step')::integer,-1) not between 0 and 3 then raise exception 'SB:راجع الوزن والوحدة وحالة الشحنة.';end if;
 if exists(select 1 from public.sb_unknown_shipments q where q.tracking=sb_unknown_link.tracking and q.id<>p_id) then raise exception 'SB:التتبع مستخدم في شحنة مجهولة أخرى.';end if;
 if exists(select 1 from public.sb_shipments where id=tracking) then raise exception 'SB:التتبع موجود أصلًا؛ لم يتم استبدال الشحنة الموجودة.';end if;
 insert into public.sb_shipments(id,customer_code,country,mode,weight,unit,trip,ship_date,step,photo_key,photo_bytes,category)
 values(tracking,cust,t.country,t.mode,(p_data->>'weight')::numeric,p_data->>'unit',t.trip_code,t.arrival_date,(p_data->>'step')::integer,r.photo_key,r.photo_bytes,'عام') returning * into s;
 update public.sb_unknown_shipments set status='linked',tracking=sb_unknown_link.tracking,customer_code=cust,
 linked_shipment_id=s.id,confirmation_note=btrim(p_data->>'confirmation'),confirmed_by=actor,confirmed_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('ok',true,'shipment',s.id);
end $$;

create function public.sb_delivery_create(p_id uuid,p_ids text[],p_phone text,p_address text,p_note text)
returns public.sb_delivery_requests language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['customer']); r public.sb_delivery_requests; s public.sb_shipments; snapshot jsonb:='[]'::jsonb; ids text[];
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 100 or array_position(p_ids,null) is not null then raise exception 'SB:اختر من 1 إلى 100 شحنة.';end if;
 select array_agg(distinct v order by v) into ids from unnest(p_ids) v;
 if cardinality(ids)<>cardinality(p_ids) then raise exception 'SB:قائمة الشحنات مكررة.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,2));
 select * into r from public.sb_delivery_requests where id=p_id;
 if found then
  if r.customer_code<>actor or r.phone<>p_phone or r.address<>p_address or r.note is distinct from p_note or
   (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(r.shipments) x) is distinct from ids then
   raise exception 'SB:رقم العملية مستخدم لبيانات مختلفة. حدّث طلباتك قبل المحاولة.';
  end if;
  return r;
 end if;
 -- Lock in stable order; ownership, stage and duplicate-active checks share the transaction.
 for s in select * from public.sb_shipments where id=any(ids) order by id for update loop
  if s.customer_code<>actor or s.step=4 then raise exception 'SB:اختر شحناتك التي لم يتم تسليمها فقط.';end if;
  if exists(select 1 from public.sb_delivery_items where shipment_id=s.id and active) then raise exception 'SB:إحدى الشحنات لديها طلب توصيل مفتوح بالفعل.';end if;
  snapshot=snapshot||jsonb_build_array(jsonb_build_object('id',s.id,'trip',s.trip,'country',s.country,'mode',s.mode,'weight',s.weight,'unit',s.unit));
 end loop;
 if jsonb_array_length(snapshot)<>cardinality(ids) then raise exception 'SB:إحدى الشحنات غير متاحة؛ حدّث القائمة.';end if;
 insert into public.sb_delivery_requests(id,customer_code,phone,address,note,shipments,updated_by)
 values(p_id,actor,p_phone,p_address,p_note,snapshot,actor) returning * into r;
 insert into public.sb_delivery_items(request_id,shipment_id) select p_id,unnest(ids);
 return r;
end $$;

create function public.sb_delivery_update(p_id uuid,p_status text,p_note text,p_expected timestamptz)
returns public.sb_delivery_requests language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['customer','admin','staff']); actor_role text; r public.sb_delivery_requests;
begin
 select role into actor_role from public.sb_accounts where code=actor;
 select * into r from public.sb_delivery_requests where id=p_id for update;
 if not found or (actor_role='customer' and r.customer_code<>actor) then raise exception 'SB:الطلب غير موجود.';end if;
 if r.updated_at is distinct from p_expected then raise exception 'SB:تغير الطلب؛ حدّث القائمة قبل المتابعة.';end if;
 if r.status not in ('pending','accepted') then raise exception 'SB:هذا الطلب مغلق أو ملغي.';end if;
 if actor_role='customer' then
  if r.status<>'pending' or p_status<>'cancelled' then raise exception 'SB:بدأ التنسيق؛ تواصل مع الشركة لتعديل الطلب.';end if;
  p_note=r.response_note;
 elsif p_status not in ('accepted','closed','cancelled') or (p_status='closed' and r.status<>'accepted') then raise exception 'SB:انتقال حالة الطلب غير صالح.';
 end if;
 update public.sb_delivery_requests set status=p_status,response_note=coalesce(p_note,''),updated_by=actor where id=p_id returning * into r;
 if p_status in ('closed','cancelled') then update public.sb_delivery_items set active=false where request_id=p_id;end if;
 return r;
end $$;

create function public.sb_delivery_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (tg_op='DELETE' or new.customer_code is distinct from old.customer_code or new.id is distinct from old.id) and
  exists(select 1 from public.sb_delivery_items where shipment_id=old.id and active) then
  raise exception 'SB:للشحنة طلب توصيل مفتوح؛ أغلقه أو ألغِه قبل تغيير المالك أو التتبع أو الحذف.';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger sb_delivery_shipment_guard before update or delete on public.sb_shipments for each row execute function public.sb_delivery_guard();
create trigger sb_unknown_touch before update on public.sb_unknown_shipments for each row execute function public.sb_touch_shipment();
create trigger sb_unknown_audit after insert or update on public.sb_unknown_shipments for each row execute function public.sb_audit_change();
create trigger sb_delivery_touch before update on public.sb_delivery_requests for each row execute function public.sb_touch_shipment();
create trigger sb_delivery_audit after insert or update on public.sb_delivery_requests for each row execute function public.sb_audit_change();

revoke all on function public.sb_service_role(text[]),public.sb_unknown_create(uuid,text,text,date),public.sb_unknown_photo(uuid,text,bigint,timestamptz),public.sb_unknown_link(uuid,jsonb,timestamptz),public.sb_delivery_create(uuid,text[],text,text,text),public.sb_delivery_update(uuid,text,text,timestamptz),public.sb_delivery_guard() from public,anon,authenticated;
grant execute on function public.sb_service_role(text[]),public.sb_unknown_create(uuid,text,text,date),public.sb_unknown_photo(uuid,text,bigint,timestamptz),public.sb_unknown_link(uuid,jsonb,timestamptz),public.sb_delivery_create(uuid,text[],text,text,text),public.sb_delivery_update(uuid,text,text,timestamptz),public.sb_delivery_guard() to service_role;
