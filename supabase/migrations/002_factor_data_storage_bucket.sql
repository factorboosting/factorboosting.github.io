insert into storage.buckets (id, name, public)
values ('factor-data', 'factor-data', false)
on conflict (id) do update
set public = false;
