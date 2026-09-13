begin;
-- Synthetic data exists only within this transaction. No real shipments are changed.
insert into public.sb_accounts(code,name,role,salt,password_hash,phone) values
 ('QA-SVC-ADMIN','TEST ROLLBACK','admin','test','test',''),
 ('QA-SVC-C1','TEST ROLLBACK','customer','test','test','0920000000'),
 ('QA-SVC-C2','TEST ROLLBACK','customer','test','test','0910000000');
insert into public.sb_trips(trip_code,country,mode,arrival_date) values('QA-SVC-T1','الصين','جوي',current_date+10);
insert into public.sb_shipments(id,customer_code,country,mode,weight,unit,trip,step) values
 ('QA-SVC-S1','QA-SVC-C1','الصين','جوي',1,'كجم','QA-SVC-T1',0),
 ('QA-SVC-S2','QA-SVC-C1','الصين','جوي',2,'كجم','QA-SVC-T1',4),
 ('QA-SVC-OTHER','QA-SVC-C2','الصين','جوي',1,'كجم','QA-SVC-T1',0);
set local role service_role;
do $$
declare parcel uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); another uuid:=gen_random_uuid();
 r public.sb_unknown_shipments; d public.sb_delivery_requests; again public.sb_delivery_requests; payload jsonb; linked jsonb;
begin
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-ADMIN","x-sb-batch":"QA-SVC-ROLLBACK","x-sb-whatsapp":"disabled"}',true);
 r=public.sb_unknown_create(parcel,null,'صندوق اختبار بدون مالك',current_date);
 assert r.status='unresolved' and r.customer_code is null,'unknown remains unassigned';
 r=public.sb_unknown_create(parcel,null,'صندوق اختبار بدون مالك',current_date);
 assert (select count(*) from public.sb_unknown_shipments where id=parcel)=1,'unknown idempotency';
 perform public.sb_reserve_photo('unknown/'||parcel||'/test',100);
 r=public.sb_unknown_photo(parcel,'unknown/'||parcel||'/test',100,r.updated_at);
 payload=jsonb_build_object('tracking','QA-SVC-LINKED','customer','QA-SVC-C1','trip','QA-SVC-T1','country','الصين','mode','جوي','weight',1.5,'unit','كجم','step',0,'confirmation','طابقت فاتورة الشراء','confirmed',true);
 begin
  perform public.sb_unknown_link(parcel,payload-'confirmed',r.updated_at);
  raise exception 'TEST FAILED: missing confirmation accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_unknown_link(parcel,payload||'{"customer":"QA-MISSING"}',r.updated_at);
  raise exception 'TEST FAILED: missing customer accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_unknown_link(parcel,payload||'{"tracking":"QA-SVC-S1"}',r.updated_at);
  raise exception 'TEST FAILED: overwrote existing tracking';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert (select status from public.sb_unknown_shipments where id=parcel)='unresolved','failed claim stays unassigned';
 linked=public.sb_unknown_link(parcel,payload,r.updated_at);
 assert linked->>'shipment'='QA-SVC-LINKED','linked real tracking';
 assert (select customer_code='QA-SVC-C1' and photo_key=r.photo_key and weight=1.5 from public.sb_shipments where id='QA-SVC-LINKED'),'ownership and photo preserved atomically';
 assert (public.sb_unknown_link(parcel,payload,r.updated_at)->>'replayed')::boolean,'claim retry idempotency';
 begin
  perform public.sb_unknown_photo(parcel,'unknown/'||parcel||'/test',100,r.updated_at);
  raise exception 'TEST FAILED: photo changed after claim';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-C1","x-sb-whatsapp":"disabled"}',true);
 begin
  perform public.sb_unknown_create(gen_random_uuid(),null,'اختبار خصوصية',current_date);
  raise exception 'TEST FAILED: customer created unknown parcel';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_delivery_create(gen_random_uuid(),array['QA-SVC-OTHER'],'0920000000','طرابلس - عنوان الاختبار','');
  raise exception 'TEST FAILED: another customer shipment accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_delivery_create(gen_random_uuid(),array['QA-SVC-S2'],'0920000000','طرابلس - عنوان الاختبار','');
  raise exception 'TEST FAILED: delivered shipment accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 d=public.sb_delivery_create(request,array['QA-SVC-LINKED','QA-SVC-S1'],'0920000000','طرابلس - عنوان الاختبار','وقت الاتصال صباحًا');
 again=public.sb_delivery_create(request,array['QA-SVC-S1','QA-SVC-LINKED'],'0920000000','طرابلس - عنوان الاختبار','وقت الاتصال صباحًا');
 assert again.id=d.id and jsonb_array_length(d.shipments)=2,'delivery idempotency and snapshot';
 begin
  perform public.sb_delivery_create(another,array['QA-SVC-S1'],'0920000000','طرابلس - عنوان الاختبار','');
  raise exception 'TEST FAILED: duplicate active delivery accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert not exists(select 1 from public.sb_delivery_requests where id=another),'failed delivery atomic rollback';
 begin
  perform public.sb_delivery_create(request,array['QA-SVC-S1'],'0920000000','عنوان مختلف للاختبار','');
  raise exception 'TEST FAILED: request ID payload overwritten';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  update public.sb_shipments set customer_code='QA-SVC-C2' where id='QA-SVC-S1';
  raise exception 'TEST FAILED: changed owner with open delivery';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-C2","x-sb-whatsapp":"disabled"}',true);
 begin
  perform public.sb_delivery_update(request,'cancelled','',d.updated_at);
  raise exception 'TEST FAILED: another customer cancelled request';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-ADMIN","x-sb-whatsapp":"disabled"}',true);
 d=public.sb_delivery_update(request,'accepted','سنتصل للتنسيق',d.updated_at);
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-C1","x-sb-whatsapp":"disabled"}',true);
 begin
  perform public.sb_delivery_update(request,'cancelled','',d.updated_at);
  raise exception 'TEST FAILED: cancellation after coordination accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-ADMIN","x-sb-whatsapp":"disabled"}',true);
 begin
  perform public.sb_delivery_update(request,'closed','','2000-01-01'::timestamptz);
  raise exception 'TEST FAILED: stale update accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 d=public.sb_delivery_update(request,'closed','تم إنهاء التنسيق',d.updated_at);
 assert not exists(select 1 from public.sb_delivery_items where request_id=request and active),'close releases delivery reservation';
 assert (select step from public.sb_shipments where id='QA-SVC-S1')=0,'closing request does not mark shipment delivered';
 perform set_config('request.headers','{"x-sb-actor":"QA-SVC-C1","x-sb-whatsapp":"disabled"}',true);
 d=public.sb_delivery_create(another,array['QA-SVC-S1'],'0920000000','طرابلس - عنوان الاختبار','');
 d=public.sb_delivery_update(another,'cancelled','FORGED ADMIN NOTE',d.updated_at);
 assert d.response_note='' and d.status='cancelled','customer can cancel pending; cannot inject admin response';
 assert not has_table_privilege('anon','public.sb_unknown_shipments','select'),'no anonymous unknown reads';
 assert not has_table_privilege('authenticated','public.sb_delivery_requests','select'),'no direct customer table access';
 assert not has_function_privilege('anon','public.sb_delivery_create(uuid,text[],text,text,text)','execute'),'no public RPC';
 assert (select count(*) from public.sb_audit where entity_id=parcel::text)>=3,'unknown create/photo/link audited';
end $$;
reset role;
select 'PASS: unknown ownership/photo, idempotency, delivery ownership, duplicate prevention, cancellation, stale updates, audit, service-only grants' as result;
rollback;
