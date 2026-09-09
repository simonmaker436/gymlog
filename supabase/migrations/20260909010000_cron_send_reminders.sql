-- =========================================================================
-- Cron diario del recordatorio push
-- =========================================================================
-- Dispara la Edge Function send-reminders una vez al día.
--
-- HORARIO: pg_cron trabaja en UTC. Colombia es UTC-5 todo el año (no hay
-- horario de verano), así que:
--
--        19:00 en Bogotá  =  00:00 UTC  =  '0 0 * * *'
--
-- Para cambiar la hora, reprogramar con el mismo nombre de trabajo:
--     select cron.schedule('gymlog-recordatorios', '<minuto> <hora> * * *', $$ ... $$);
-- (hora UTC = hora local + 5). El resumen del cambio lo explica con ejemplos.
--
-- EL TOKEN no está acá: se lee de Vault en el momento de ejecutar, para que
-- este archivo pueda vivir en el repositorio sin llevar ningún secreto.
-- =========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Desprogramar antes de programar: cron.schedule con un nombre que ya existe
-- lo reemplaza, pero si el nombre cambió alguna vez quedaría el viejo suelto.
select cron.unschedule(jobname)
from cron.job
where jobname = 'gymlog-recordatorios';

select cron.schedule(
  'gymlog-recordatorios',
  '0 0 * * *',   -- 00:00 UTC = 19:00 en Bogotá
  $cron$
  select net.http_post(
    url := 'https://dfvidkbcnvngnskswirs.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-token', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'reminder_token'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$
);
