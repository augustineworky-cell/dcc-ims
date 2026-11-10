-- GoodsGuru item photos: run ONCE in Supabase > SQL Editor > New query > Run.
alter table public.items add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do update set public = true;

drop policy if exists item_photos_read on storage.objects;
drop policy if exists item_photos_insert on storage.objects;
drop policy if exists item_photos_update on storage.objects;
drop policy if exists item_photos_delete on storage.objects;

create policy item_photos_read on storage.objects for select
  using (bucket_id = 'item-photos');
create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() in ('admin', 'manager'));
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() in ('admin', 'manager'));
create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() in ('admin', 'manager'));

select 'photos ready' as result, count(*) as items from public.items;
