-- Allow warehouse staff to view and coordinate customer delivery requests.
create or replace function public.sb_delivery_update(p_id uuid,p_status text,p_note text,p_expected timestamptz)
returns public.sb_delivery_requests language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['customer','admin','staff','warehouse']); actor_role text; r public.sb_delivery_requests;
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
revoke all on function public.sb_delivery_update(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sb_delivery_update(uuid,text,text,timestamptz) to service_role;
