begin;
insert into public.sb_accounts(code,name,role,salt,password_hash,phone) values
 ('QA-OPS-ADMIN','TEST ROLLBACK','admin','test','test',''),('QA-OPS-CUSTOMER','TEST ROLLBACK','customer','test','test','+218900000000');
select set_config('request.headers','{"x-sb-actor":"QA-OPS-ADMIN","x-sb-batch":"TEST-ROLLBACK","x-sb-whatsapp":"disabled"}',true);
insert into public.sb_trips(trip_code,country,mode,arrival_date) values('QA-OPS-T1','الصين','جوي','2026-10-01'),('QA-OPS-T2','الصين','جوي','2026-10-02');
do $$
declare result jsonb;items jsonb;i jsonb;invoice_id uuid;payment_id uuid=gen_random_uuid();request_id uuid=gen_random_uuid();rate_time timestamptz;counted integer;
begin
 result=public.sb_operations_batch('import','[{"id":"QA-OPS-S1","customer":"QA-OPS-CUSTOMER","weight":0.5,"unit":"كجم","category":"QA-OPS-CATEGORY","action":"create"},{"id":"QA-OPS-S2","customer":"QA-OPS-CUSTOMER","weight":1.5,"unit":"كجم","category":"QA-OPS-CATEGORY","action":"create"}]','QA-OPS-T1','الصين','جوي');
 assert (result->>'created')::integer=2,'bulk import count';
 begin
  perform public.sb_operations_batch('import','[{"id":"QA-OPS-S3","customer":"QA-OPS-CUSTOMER","weight":1,"unit":"كجم","action":"create"},{"id":"QA-OPS-S4","customer":"QA-OPS-CUSTOMER","weight":0,"unit":"كجم","action":"create"}]','QA-OPS-T1','الصين','جوي');
  raise exception 'TEST FAILED: invalid batch accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert not exists(select 1 from public.sb_shipments where id='QA-OPS-S3'),'atomic rollback';
 begin
  perform public.sb_operations_batch('import','[{"id":"QA-OPS-S1","customer":"QA-OPS-CUSTOMER","weight":1,"unit":"كجم","action":"create"}]','QA-OPS-T1','الصين','جوي');
  raise exception 'TEST FAILED: duplicate accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 begin
  perform public.sb_operations_batch('status','[{"id":"QA-OPS-S1","updatedAt":"2000-01-01T00:00:00Z"}]',null,null,null,1);
  raise exception 'TEST FAILED: stale version accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) into items from public.sb_shipments where id in ('QA-OPS-S1','QA-OPS-S2');
 perform public.sb_operations_batch('status',items,null,null,null,1);
 assert (select count(*) from public.sb_notifications where customer_code='QA-OPS-CUSTOMER')=1,'grouped notification';
 assert (select shipment_count from public.sb_notifications where customer_code='QA-OPS-CUSTOMER')=2,'grouped notification count';
 assert (select whatsapp_status from public.sb_notifications where customer_code='QA-OPS-CUSTOMER')='not_connected','no external send without connection';
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) into items from public.sb_shipments where id='QA-OPS-S1';
 perform public.sb_operations_batch('transfer',items,'QA-OPS-T2','الصين','جوي');
 assert exists(select 1 from public.sb_shipments where id='QA-OPS-S1' and trip='QA-OPS-T2' and step=1 and weight=0.5 and ship_date='2026-10-02'),'transfer preserves state';
 assert exists(select 1 from public.sb_audit where entity_id='QA-OPS-S1' and actor='QA-OPS-ADMIN' and before_data->>'trip'='QA-OPS-T1' and after_data->>'trip'='QA-OPS-T2'),'audit old and new';
 perform public.sb_save_reconciliation('QA-OPS-T1','الصين','جوي','["QA-OPS-S2","QA-OPS-EXTRA"]');
 assert exists(select 1 from public.sb_reconciliations where trip='QA-OPS-T1' and expected_ids='["QA-OPS-S2"]'::jsonb),'reconciliation snapshot';
 insert into public.sb_rates(country,mode,category,unit,currency,rate) values('الصين','جوي','QA-OPS-CATEGORY','كجم','USD',10) returning updated_at into rate_time;
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at,'rateUpdatedAt',rate_time)) into items from public.sb_shipments where id in ('QA-OPS-S1','QA-OPS-S2');
 i=public.sb_issue_invoice('QA-OPS-CUSTOMER',items,'USD','LYD',5,request_id);invoice_id=(i->>'id')::uuid;
 assert (i->>'total')::numeric=20 and (i->>'settlement_total')::numeric=100,'invoice arithmetic';
 assert public.sb_issue_invoice('QA-OPS-CUSTOMER',items,'USD','LYD',5,request_id)->>'id'=i->>'id','invoice idempotency';
 begin
  perform public.sb_issue_invoice('QA-OPS-CUSTOMER',items,'USD','LYD',5,gen_random_uuid());raise exception 'TEST FAILED: rebilling accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform public.sb_record_payment(payment_id,invoice_id,25,'TEST');perform public.sb_record_payment(payment_id,invoice_id,25,'TEST');
 assert (select count(*) from public.sb_payments p where p.id=payment_id)=1,'payment idempotency';
 begin
  perform public.sb_record_payment(gen_random_uuid(),invoice_id,76,'TEST');raise exception 'TEST FAILED: overpayment accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 perform set_config('request.headers','{"x-sb-actor":"QA-OPS-CUSTOMER"}',true);
 begin
  perform public.sb_operations_batch('status',items,null,null,null,4);raise exception 'TEST FAILED: customer mutation accepted';
 exception when raise_exception then if sqlerrm not like 'SB:%' then raise;end if;end;
 assert not has_table_privilege('anon','public.sb_audit','select'),'audit not public';
 assert not has_function_privilege('authenticated','public.sb_operations_batch(text,jsonb,text,text,text,integer)','execute'),'batch not public';
end $$;
select 'PASS: atomic import, duplicates, stale review, grouped notifications, transfer, audit, reconciliation, invoicing, payment idempotency, overpayment and authorization' as tests;
rollback;
