-- =========================================================================
-- push_subscriptions — a qué dispositivo mandarle el recordatorio
-- =========================================================================
-- Una fila por usuario: el id de suscripción que devuelve el SDK web de
-- OneSignal cuando la persona acepta las notificaciones. Si las desactiva,
-- la fila se borra.
--
-- AISLAMIENTO: RLS por auth.uid(), igual que el resto de sus datos. Cada
-- cuenta solo ve y toca su propia fila. La función send-reminders usa la
-- service role, que se salta RLS a propósito: necesita recorrer a todos
-- para saber a quién avisar.
-- =========================================================================

create table if not exists public.push_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  subscription_id text not null,
  -- para poder depurar desde qué navegador se suscribió
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Id de suscripcion de OneSignal por usuario. Lo escribe el cliente con su propia sesion; lo lee send-reminders con la service role.';

alter table public.push_subscriptions enable row level security;

-- Cuatro políticas explícitas en vez de una "for all": así se lee de un
-- vistazo qué puede hacer cada quien, y añadir una excepción más adelante
-- no obliga a rehacer la única que hubiera.
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- updated_at al día sin que el cliente tenga que acordarse
create or replace function public.touch_push_subscriptions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_push_subscriptions();
