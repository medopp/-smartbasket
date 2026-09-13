begin;
-- Synthetic fixtures only; all data, audit and notifications roll back.
insert into public.sb_accounts(code,name,role,salt,password_hash,phone) values
 ('QA-LN-ADMIN','TEST ROLLBACK','admin','test','test',''),
 ('QA-LN-C1','TEST ROLLBACK','customer','test','test','0920000000');
insert into public.sb_trips(trip_code,country,mode,arrival_date) values('QA-LN-T1','الصين','جوي',current_date+10);
set local role service_role;
do $$
declare result jsonb; rows jsonb; u public.sb_unknown_shipments; again public.sb_unknown_shipments;
begin
 perform set_config('request.headers','{"x-sb-actor":"QA-LN-ADMIN","x-sb-batch":"QA-LN-ROLLBACK","x-sb-whatsapp":"disabled"}',true);
 rows='[{"id":"QA-LN-A1","customer":"LN-","weight":1.25,"unit":"كجم","category":"ملابس","action":"unknown"},{"id":"QA-LN-B1","customer":"QA-LN-C1","weight":2,"unit":"كجم","action":"create"}]';
 result=public.sb_import_with_unknowns(rows,'QA-LN-T1','الصين','جوي');
 assert result->>'created'='1' and result->>'unknownCreated'='1','mixed batch routes each row';
 assert not exists(select 1 from public.sb_shipments where id='QA-LN-A1'),'placeholder not in customer shipments';
 select * into strict u from public.sb_unknown_shipments where tracking='QA-LN-A1';
 assert u.customer_code is null and u.status='unresolved','unknown private and unassigned';
 assert u.intake_data->>'trip'='QA-LN-T1' and u.intake_data->>'weight'='1.25' and u.intake_data->>'category'='ملابس','structured metadata preserved';
 assert result->'unknownRows'->0->>'id'=u.id::text,'manual photo destination returned';
 perform public.sb_reserve_photo('unknown/'||u.id||'/test',100);
 u=public.sb_unknown_photo(u.id,'unknown/'||u.id||'/test',100,u.updated_at);
 result=public.sb_import_with_unknowns(jsonb_build_array(rows->0),'QA-LN-T1','الصين','جوي');
 select * into strict again from public.sb_unknown_shipments where id=u.id;
 assert result->>'unknownCreated'='0' and result->>'unknownExisting'='1','retry no duplicate';
 assert again.updated_at=u.updated_at and again.photo_key=u.photo_key and again.intake_data=u.intake_data,'retry does not overwrite existing metadata or photo';
 begin
  perform public.sb_import_with_unknowns('[{"id":"QA-LN-A2","customer":"LN-","weight":1,"unit":"كجم","action":"unknown"},{"id":"QA-LN-ZINVALID","customer":"QA-LN-MISSING","weight":1,"unit":"كجم","action":"create"}]','QA-LN-T1','الصين','جوي');
  raise exception 'TEST FAILED: invalid customer accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert not exists(select 1 from public.sb_unknown_shipments where tracking='QA-LN-A2'),'unknown insertion rolled back with bad normal row';
 begin
  perform public.sb_import_with_unknowns(jsonb_build_array((rows->0)||'{"id":"QA-LN-B1"}'),'QA-LN-T1','الصين','جوي');
  raise exception 'TEST FAILED: known ownership stripped';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert (select customer_code from public.sb_shipments where id='QA-LN-B1')='QA-LN-C1','known owner intact';
 begin
  perform public.sb_import_with_unknowns(jsonb_build_array((rows->0)||'{"customer":"QA-LN-C1","action":"create"}'),'QA-LN-T1','الصين','جوي');
  raise exception 'TEST FAILED: bypassed unknown ownership verification';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_import_with_unknowns(jsonb_build_array(rows->0,rows->0),'QA-LN-T1','الصين','جوي');
  raise exception 'TEST FAILED: duplicate rows accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform public.sb_unknown_link(u.id,jsonb_build_object('tracking',u.tracking,'customer','QA-LN-C1','trip','QA-LN-T1','country','الصين','mode','جوي','weight',1.25,'unit','كجم','step',0,'confirmation','مطابقة الفاتورة الأصلية','confirmed',true),u.updated_at);
 assert (select category='ملابس' and photo_key=u.photo_key and customer_code='QA-LN-C1' from public.sb_shipments where id='QA-LN-A1'),'claim retains imported category and photo';
 update public.sb_trips set step=1 where trip_code='QA-LN-T1';
 result=public.sb_import_with_unknowns(jsonb_build_array((rows->0)||'{"id":"QA-LN-A3"}'),'QA-LN-T1','الصين','جوي');
 assert result->>'unknownCreated'='1','unknown can record departed-trip metadata without entering customer manifest';
 perform set_config('request.headers','{"x-sb-actor":"QA-LN-C1"}',true);
 begin
  perform public.sb_import_with_unknowns(rows,'QA-LN-T1','الصين','جوي');
  raise exception 'TEST FAILED: customer used internal intake';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert not has_function_privilege('anon','public.sb_import_with_unknowns(jsonb,text,text,text)','execute'),'RPC not public';
 assert not has_function_privilege('authenticated','public.sb_import_with_unknowns(jsonb,text,text,text)','execute'),'RPC not directly callable by customer';
end $$;
reset role;
select 'PASS: LN- mixed atomic intake, metadata/photos, duplicate protection, known ownership, verified linking, roles and rollback' as result;
rollback;
