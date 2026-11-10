-- GoodsGuru photo protection: run ONCE in Supabase > SQL Editor > New query > Run.
-- Rule: managers can ADD a photo to an item that has none. Only the admin can REPLACE or REMOVE an existing photo.

create or replace function public.guard_item_photo() returns trigger
language plpgsql as $$
begin
  if old.image_url is not null
     and new.image_url is distinct from old.image_url
     and auth.uid() is not null
     and public.my_role() is distinct from 'admin' then
    raise exception 'Only the admin can replace or remove an item photo.';
  end if;
  return new;
end $$;

drop trigger if exists guard_item_photo on public.items;
create trigger guard_item_photo before update of image_url on public.items
  for each row execute function public.guard_item_photo();

-- Storage: add = admin or manager, overwrite and delete = admin only
drop policy if exists item_photos_update on storage.objects;
drop policy if exists item_photos_delete on storage.objects;
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() = 'admin')
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() = 'admin');
create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.my_company()::text and public.my_role() = 'admin');

select 'photo rules ready' as result,
       count(*) filter (where image_url is not null) as items_with_photo,
       count(*) as items_total
from public.items;
