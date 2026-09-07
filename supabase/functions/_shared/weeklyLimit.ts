/* =========================================================================
   weeklyLimit.ts — cuántos análisis de foto quedan esta semana
   =========================================================================
   Aparte a propósito: si mañana el límite pasa a 3, o la ventana deja de ser
   semanal, se toca solo este archivo.

   La semana es de lunes a domingo, igual que en el resto de la app
   (js/stats.js: weekStart usa (getDay() + 6) % 7). Si eso cambiara allá,
   tiene que cambiar acá: es la misma idea de «semana» para el usuario.

   El conteo se hace en el servidor y no en el navegador, porque si no
   bastaría con tocar el cliente para gastar tokens sin tope.
   ========================================================================= */

/* El número a tocar si se quiere aflojar o apretar el límite. */
export const ANALYSES_PER_WEEK = 2;

/* Lunes de la semana de `iso` (YYYY-MM-DD), en formato YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const delta = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

/* El lunes siguiente: cuándo se reponen los análisis. */
export function nextReset(iso: string): string {
  const d = new Date(weekStart(iso) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/* Una entrada del registro de uso. `at` es la fecha del análisis. */
export interface AnalysisEntry {
  at: string;             // YYYY-MM-DD
  photo?: string;
  recomendacion?: string;
  consejo?: string;
  provider?: string;
}

export interface Usage {
  limit: number;
  used: number;
  remaining: number;
  weekStart: string;
  nextReset: string;
  allowed: boolean;
}

/* Cuenta solo los de la semana en curso; los viejos quedan en el historial
   pero no descuentan. */
export function usageFor(entries: AnalysisEntry[], today: string): Usage {
  const ws = weekStart(today);
  const used = (entries || []).filter((e) =>
    e && typeof e.at === "string" && weekStart(e.at) === ws
  ).length;
  const remaining = Math.max(0, ANALYSES_PER_WEEK - used);
  return {
    limit: ANALYSES_PER_WEEK,
    used,
    remaining,
    weekStart: ws,
    nextReset: nextReset(today),
    allowed: remaining > 0,
  };
}

/* El historial completo, de más nuevo a más viejo y acotado, para no dejar
   que el archivo de registro crezca sin fin. */
export const HISTORY_MAX = 40;

export function trimHistory(entries: AnalysisEntry[]): AnalysisEntry[] {
  return (entries || [])
    .filter((e) => e && typeof e.at === "string")
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, HISTORY_MAX);
}
