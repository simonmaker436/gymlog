/* =========================================================================
   coach — recomendación de entrenamiento a partir del historial
   =========================================================================
   El cliente manda un resumen de sus últimas sesiones; acá se calculan los
   hechos (cuántos días hace de cada tipo, medias, notas) y se le pide al
   modelo que los redacte. Los números NO los inventa el modelo: se los damos
   ya masticados para que no se equivoque contando.

   La cadena Gemini → Groq vive en ../_shared/ai.ts y la comparte con las
   demás funciones. Acá solo se arma el contexto.

   El modelo de datos de GymLog no tiene ejercicios ni series: solo fecha,
   tipo, duración, energía, sensación, dificultad, peso y notas. El prompt lo
   dice explícitamente para que no se invente rutinas.
   ========================================================================= */
import {
  askAI,
  CORS,
  json,
} from "../_shared/ai.ts";

/* Se reexportan para que las pruebas de esta carpeta sigan importando desde
   un solo sitio. */
export {
  askGemini,
  askGroq,
  extractText,
  friendlyGeminiError,
  friendlyGroqError,
  GEMINI_MODEL,
  GROQ_JSON_HINT,
  GROQ_MODEL,
  groqPrompt,
  parseModelJson,
} from "../_shared/ai.ts";
export type { Advice, AskResult } from "../_shared/ai.ts";

const MAX_WORKOUTS = 30;

/* Las zonas que se marcan hoy. Tiene que coincidir con MUSCLE_GROUPS de
   store.js; si allá se agrega una, acá también. */
export const GROUP_LABELS: Record<string, string> = {
  pierna: "Pierna",
  brazo: "Brazo",
  abdomen: "Abdomen",
  pecho: "Pecho",
  espalda: "Espalda",
  otro: "Otro",
};

/* Etiquetas de cuando cada sesión llevaba una sola. Ya no se pueden elegir,
   pero siguen en el historial y no hay que perderlas. */
export const LEGACY_LABELS: Record<string, string> = {
  empuje: "Empuje",
  tiron: "Tirón",
  fullbody: "Full body",
  cardio: "Cardio",
};

export const TYPE_LABELS: Record<string, string> = { ...GROUP_LABELS, ...LEGACY_LABELS };

export const MUSCLE_LABELS: Record<string, string> = {
  cuadriceps: "Cuádriceps",
  isquiotibiales: "Isquiotibiales",
  gluteos: "Glúteos",
  pantorrillas: "Pantorrillas",
  biceps: "Bíceps",
  triceps: "Tríceps",
  antebrazo: "Antebrazo",
  abdominales: "Abdominales",
  oblicuos: "Oblicuos",
  "pectoral-superior": "Pectoral superior",
  "pectoral-medio": "Pectoral medio",
  "pectoral-inferior": "Pectoral inferior",
  dorsales: "Dorsales",
  trapecio: "Trapecio",
  romboides: "Romboides",
  lumbares: "Lumbares",
};

export interface InWorkout {
  date?: unknown;
  type?: unknown;   // etiqueta vieja, de una sola opción
  focus?: unknown;  // { groups: [...], muscles: [...] }
  energy?: unknown;
  feeling?: unknown;
  difficulty?: unknown;
  duration?: unknown;
  notes?: unknown;
}

export interface CleanWorkout {
  date: string;
  /* Una sesión puede tocar varias zonas. Las de antes traen una sola, la que
     tuvieran en `type`. */
  groups: string[];
  muscles: string[];
  energy: number | null;
  feeling: number | null;
  difficulty: number | null;
  duration: number | null;
  notes: string;
}

/* --------------------------------------------------------------- limpieza
   Todo lo que llega del cliente es sospechoso: se recorta, se valida y se
   descarta lo que no encaje. Las notas se cortan para que nadie meta un
   texto enorme en el prompt. */
export function cleanWorkouts(raw: unknown): CleanWorkout[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanWorkout[] = [];
  for (const w of raw as InWorkout[]) {
    if (!w || typeof w !== "object") continue;
    const date = typeof w.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.date)
      ? w.date
      : null;
    if (!date) continue;
    /* Primero la selección nueva; si no hay, la etiqueta vieja. Nunca las
       dos, para no contar la misma sesión dos veces. */
    const focus = (w.focus && typeof w.focus === "object" && !Array.isArray(w.focus))
      ? w.focus as { groups?: unknown; muscles?: unknown }
      : null;

    const groups: string[] = [];
    if (Array.isArray(focus?.groups)) {
      for (const g of focus.groups) {
        if (typeof g === "string" && GROUP_LABELS[g] && !groups.includes(g)) groups.push(g);
      }
    }
    if (!groups.length && typeof w.type === "string" && TYPE_LABELS[w.type]) {
      groups.push(w.type);
    }

    const muscles: string[] = [];
    if (groups.length && Array.isArray(focus?.muscles)) {
      for (const m of focus.muscles) {
        if (typeof m === "string" && MUSCLE_LABELS[m] && !muscles.includes(m)) muscles.push(m);
      }
    }

    out.push({
      date,
      groups,
      muscles: muscles.slice(0, 16),
      energy: clamp15(w.energy),
      feeling: clamp15(w.feeling),
      difficulty: clamp15(w.difficulty),
      duration: numOrNull(w.duration),
      notes: typeof w.notes === "string" ? w.notes.trim().slice(0, 240) : "",
    });
  }
  // más recientes primero, y como mucho MAX_WORKOUTS
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out.slice(0, MAX_WORKOUTS);
}

function clamp15(v: unknown): number | null {
  const n = Number(v);
  if (!isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.round((db - da) / 86400000);
}

export interface TypeStat {
  key: string;
  label: string;
  count: number;
  daysSince: number | null; // null = nunca en esta ventana
}

export interface Summary {
  total: number;
  today: string;
  types: TypeStat[];
  muscles: { label: string; count: number }[];
  untyped: number;
  avgEnergy: number | null;
  avgFeeling: number | null;
  avgDifficulty: number | null;
  lastNotes: { date: string; type: string | null; notes: string }[];  // type = zonas ya en texto
  lastEnergies: number[];
}

/* Los hechos, calculados acá y no por el modelo. */
export function summarize(workouts: CleanWorkout[], today: string): Summary {
  /* Solo se listan las zonas elegibles hoy más las viejas que la persona
     realmente usó: si no, aparecerían «Tirón: 0 sesiones» para siempre. */
  const vigentes = Object.keys(GROUP_LABELS);
  const historicas = Object.keys(LEGACY_LABELS)
    .filter((k) => workouts.some((w) => w.groups.includes(k)));

  const types: TypeStat[] = [...vigentes, ...historicas].map((key) => {
    const mine = workouts.filter((w) => w.groups.includes(key));
    const last = mine[0]; // ya vienen ordenados de más nuevo a más viejo
    return {
      key,
      label: TYPE_LABELS[key],
      count: mine.length,
      daysSince: last ? Math.max(0, daysBetween(last.date, today)) : null,
    };
  });

  const avg = (pick: (w: CleanWorkout) => number | null) => {
    const vals = workouts.map(pick).filter((n): n is number => n != null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  /* Los músculos concretos, de más a menos marcados. */
  const cuenta = new Map<string, number>();
  for (const w of workouts) {
    for (const m of w.muscles) cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  const muscles = [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ label: MUSCLE_LABELS[key], count }));

  return {
    total: workouts.length,
    today,
    types,
    muscles,
    untyped: workouts.filter((w) => !w.groups.length).length,
    avgEnergy: avg((w) => w.energy),
    avgFeeling: avg((w) => w.feeling),
    avgDifficulty: avg((w) => w.difficulty),
    lastNotes: workouts
      .filter((w) => w.notes)
      .slice(0, 8)
      .map((w) => ({
        date: w.date,
        type: w.groups.length ? w.groups.map((g) => TYPE_LABELS[g]).join(" y ") : null,
        notes: w.notes,
      })),
    lastEnergies: workouts.slice(0, 6).map((w) => w.energy).filter(
      (n): n is number => n != null,
    ),
  };
}

/* ----------------------------------------------------------------- prompt */
export function buildPrompt(s: Summary): string {
  const usados = s.types.filter((t) => t.count > 0);
  const nunca = s.types.filter((t) => t.count === 0);

  const lineas = usados
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))
    .map((t) =>
      `- ${t.label}: ${t.count} ${t.count === 1 ? "sesión" : "sesiones"}, ` +
      `última hace ${t.daysSince} ${t.daysSince === 1 ? "día" : "días"}`
    )
    .join("\n");

  const notas = s.lastNotes.length
    ? s.lastNotes
      .map((n) => `- ${n.date}${n.type ? ` (${n.type})` : ""}: ${n.notes}`)
      .join("\n")
    : "(sin notas)";

  const musculos = s.muscles.length
    ? s.muscles.map((m) => `${m.label} (${m.count})`).join(", ")
    : "(todavía sin detallar)";

  return `Eres el entrenador de una aplicación de registro de gimnasio
llamada GymLog.

IDIOMA: escribe en español neutro, el que entiende cualquier hispanohablante.
Trata de "tú", nunca de "vos". Sin modismos ni jerga de ningún país (nada de
"che", "vale", "órale", "guay"). Directo y sin florituras.

MUY IMPORTANTE: la aplicación NO registra ejercicios, series, repeticiones ni
pesos levantados. Solo guarda: fecha, zonas y músculos trabajados, duración,
energía (1-5), sensación (1-5), dificultad (1-5), peso corporal y notas
libres. No inventes ejercicios concretos ni rutinas con series y repeticiones.

Datos reales de las últimas ${s.total} sesiones (hoy es ${s.today}):

Por zona trabajada:
${lineas || "(todavía sin zonas registradas)"}
${nunca.length ? `Sin trabajar nunca: ${nunca.map((t) => t.label).join(", ")}.` : ""}
${s.untyped ? `Sesiones sin nada marcado: ${s.untyped}.` : ""}

Músculos concretos marcados (veces): ${musculos}

Medias del período: energía ${s.avgEnergy ?? "s/d"}/5, sensación ${
    s.avgFeeling ?? "s/d"
  }/5, dificultad ${s.avgDifficulty ?? "s/d"}/5.
Energía de las últimas sesiones (de más nueva a más vieja): ${
    s.lastEnergies.join(", ") || "s/d"
  }.

Notas recientes:
${notas}

Devuelve exactamente dos campos:

"recomendacion": qué zona le conviene trabajar hoy o el próximo día. Básate
sobre todo en cuál lleva más tiempo sin tocar, usando los días reales de
arriba. Una o dos frases. Menciona algo que viene haciendo bien antes de
sugerir la que tiene abandonada.

"consejo": una observación corta sobre el patrón de sus notas, su energía y su
sensación recientes. Una o dos frases, concreta y accionable. Si las notas no
dan para nada, habla de la tendencia de energía o de la constancia. Nada de
consejos médicos ni de nutrición.

No repitas cifras que no estén en los datos de arriba.`;
}

/* ------------------------------------------------------------- handler */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const keys = {
    gemini: Deno.env.get("GEMINI_API_KEY") ?? undefined,
    groq: Deno.env.get("GROQ_API_KEY") ?? undefined,
  };
  if (!keys.gemini && !keys.groq) {
    return json({ error: "Falta configurar GEMINI_API_KEY o GROQ_API_KEY en Supabase." }, 500);
  }

  let payload: { workouts?: unknown; today?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const workouts = cleanWorkouts(payload.workouts);
  if (workouts.length < 3) {
    return json({ error: "Hacen falta al menos 3 sesiones registradas." }, 400);
  }

  const today = typeof payload.today === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
    ? payload.today
    : new Date().toISOString().slice(0, 10);

  /* Un solo contexto para las dos IAs. */
  const r = await askAI(buildPrompt(summarize(workouts, today)), keys);
  if (!r.ok) return json({ error: r.error }, 502);

  return json({
    recomendacion: r.advice.recomendacion,
    consejo: r.advice.consejo,
    provider: r.provider,
    generatedAt: new Date().toISOString(),
  });
}

/* Solo levanta el servidor cuando este archivo es el que se ejecuta, para que
   las pruebas puedan importar las funciones sueltas sin abrir un puerto. */
if (import.meta.main) Deno.serve(handle);
