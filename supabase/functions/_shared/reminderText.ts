/* =========================================================================
   reminderText.ts — qué dice el recordatorio y a qué hora sale
   =========================================================================
   ESTO es lo que se va a querer retocar. La función send-reminders solo
   decide a quién avisar; el texto y el horario viven acá.

   El horario real lo fija el cron en la base de datos (ver la migración
   ...._cron_send_reminders.sql). La constante de abajo está para que el
   código y el cron no se contradigan y para poder comprobarlo desde una
   prueba: si cambiás uno, cambiá el otro.
   ========================================================================= */

/* Hora local de Bogotá a la que sale el aviso. Cambiarla acá NO mueve el
   cron: hay que reprogramarlo (el resumen final explica cómo). */
export const SEND_HOUR_BOGOTA = 19;
export const BOGOTA_UTC_OFFSET = -5; // Colombia no tiene horario de verano

/* Varias frases para que no llegue siempre la misma. Se elige por el día
   del año, así que a una misma persona le va rotando. */
export const MESSAGES: { title: string; body: string }[] = [
  { title: "¿Entrenás hoy?", body: "Todavía no registraste nada 💪" },
  { title: "Hoy toca", body: "Tu día de gimnasio sigue sin registrar 🏋️" },
  { title: "Queda día", body: "No dejes hoy en blanco. Un rato alcanza 💪" },
  { title: "¿Cómo vas?", body: "Hoy estaba programado y sigue vacío 🔥" },
  { title: "Te falta hoy", body: "Registrá tu sesión y mantené la racha 💪" },
];

/* Día del año, para rotar el mensaje sin guardar nada. */
export function dayOfYear(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - inicio) / 86400000);
}

export function messageFor(iso: string): { title: string; body: string } {
  return MESSAGES[dayOfYear(iso) % MESSAGES.length];
}

/* La fecha de hoy en Bogotá. El servidor de la función corre en UTC, y a
   las 00:00 UTC en Bogotá todavía es el día anterior: sin esto, el aviso de
   las 19:00 miraría el día equivocado. */
export function todayInBogota(now: Date = new Date()): string {
  const t = new Date(now.getTime() + BOGOTA_UTC_OFFSET * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/* 0 = domingo … 6 = sábado, en hora de Bogotá y con el mismo criterio que
   gymDays en store.js. */
export function weekdayInBogota(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay();
}
