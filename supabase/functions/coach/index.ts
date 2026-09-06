/* =========================================================================
   coach — recomendación de entrenamiento con Gemini
   =========================================================================
   El cliente manda un resumen de sus últimas sesiones; acá se calculan los
   hechos (cuántos días hace de cada tipo, medias, notas) y se le pide al
   modelo que los redacte. Los números NO los inventa el modelo: se los damos
   ya masticados para que no se equivoque contando.

   La clave de Gemini vive en el entorno de la función (GEMINI_API_KEY) y
   nunca sale de acá.

   El modelo de datos de GymLog no tiene ejercicios ni series: solo fecha,
   tipo, duración, energía, sensación, dificultad, peso y notas. El prompt lo
   dice explícitamente para que no se invente rutinas.
   ========================================================================= */

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_WORKOUTS = 30;

export const TYPE_LABELS: Record<string, string> = {
  pierna: "Pierna",
  empuje: "Empuje",
  tiron: "Tirón",
  fullbody: "Full body",
  cardio: "Cardio",
  otro: "Otro",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface InWorkout {
  date?: unknown;
  type?: unknown;
  energy?: unknown;
  feeling?: unknown;
  difficulty?: unknown;
  duration?: unknown;
  notes?: unknown;
}

export interface CleanWorkout {
  date: string;
  type: string | null;
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
    const type = typeof w.type === "string" && TYPE_LABELS[w.type] ? w.type : null;
    out.push({
      date,
      type,
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
  untyped: number;
  avgEnergy: number | null;
  avgFeeling: number | null;
  avgDifficulty: number | null;
  lastNotes: { date: string; type: string | null; notes: string }[];
  lastEnergies: number[];
}

/* Los hechos, calculados acá y no por el modelo. */
export function summarize(workouts: CleanWorkout[], today: string): Summary {
  const types: TypeStat[] = Object.keys(TYPE_LABELS).map((key) => {
    const mine = workouts.filter((w) => w.type === key);
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

  return {
    total: workouts.length,
    today,
    types,
    untyped: workouts.filter((w) => !w.type).length,
    avgEnergy: avg((w) => w.energy),
    avgFeeling: avg((w) => w.feeling),
    avgDifficulty: avg((w) => w.difficulty),
    lastNotes: workouts
      .filter((w) => w.notes)
      .slice(0, 8)
      .map((w) => ({ date: w.date, type: w.type, notes: w.notes })),
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
      .map((n) =>
        `- ${n.date}${n.type ? ` (${TYPE_LABELS[n.type]})` : ""}: ${n.notes}`
      )
      .join("\n")
    : "(sin notas)";

  return `Sos el entrenador de una app de registro de gimnasio llamada GymLog.
Hablás en español rioplatense (vos, tenés, hacés), directo y sin florituras.

MUY IMPORTANTE: la app NO registra ejercicios, series, repeticiones ni pesos
levantados. Solo guarda: fecha, tipo de entreno, duración, energía (1-5),
sensación (1-5), dificultad (1-5), peso corporal y notas libres. No inventes
ejercicios concretos ni rutinas con series y repeticiones.

Datos reales de las últimas ${s.total} sesiones (hoy es ${s.today}):

Por tipo de entreno:
${lineas || "(todavía sin tipos registrados)"}
${nunca.length ? `Sin registrar nunca: ${nunca.map((t) => t.label).join(", ")}.` : ""}
${s.untyped ? `Sesiones sin tipo asignado: ${s.untyped}.` : ""}

Medias del período: energía ${s.avgEnergy ?? "s/d"}/5, sensación ${
    s.avgFeeling ?? "s/d"
  }/5, dificultad ${s.avgDifficulty ?? "s/d"}/5.
Energía de las últimas sesiones (de más nueva a más vieja): ${
    s.lastEnergies.join(", ") || "s/d"
  }.

Notas recientes:
${notas}

Devolvé exactamente dos campos:

"recomendacion": qué tipo de entreno le conviene hacer hoy o el próximo día.
Basate sobre todo en qué tipo lleva más tiempo sin entrenar, usando los días
reales de arriba. Una o dos frases. Mencioná algo que viene haciendo bien
antes de sugerir el que tiene abandonado.

"consejo": una observación corta sobre el patrón de sus notas, energía y
sensación recientes. Una o dos frases, concreta y accionable. Si las notas no
dan para nada, hablá de la tendencia de energía o de la constancia. Nada de
consejos médicos ni de nutrición.

No repitas cifras que no estén en los datos de arriba.`;
}

/* ------------------------------------------------------------- respuesta */
export interface Advice {
  recomendacion: string;
  consejo: string;
}

/* El modelo devuelve JSON, pero a veces lo envuelve en ```json. */
export function parseModelJson(text: string): Advice | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i < 0 || j <= i) return null;
    t = t.slice(i, j + 1);
  }
  try {
    const o = JSON.parse(t);
    const rec = typeof o.recomendacion === "string" ? o.recomendacion.trim() : "";
    const con = typeof o.consejo === "string" ? o.consejo.trim() : "";
    if (!rec && !con) return null;
    return { recomendacion: rec, consejo: con };
  } catch {
    return null;
  }
}

/* Errores de Gemini en castellano y sin tecnicismos. El límite del plan
   gratis (429) es el caso más probable, así que tiene su propio mensaje. */
export function friendlyGeminiError(status: number, body: string): string {
  const b = (body || "").toLowerCase();
  if (status === 429 || b.includes("resource_exhausted") || b.includes("quota")) {
    return "Se agotó la cuota gratis de la IA por ahora. Probá de nuevo más tarde.";
  }
  if (status === 400 && b.includes("api_key_invalid")) {
    return "La clave de la IA no es válida. Revisá GEMINI_API_KEY en Supabase.";
  }
  if (status === 403) {
    return "La clave de la IA no tiene permiso para este modelo.";
  }
  if (status === 404) {
    return "El modelo de IA configurado ya no está disponible.";
  }
  if (status >= 500) {
    return "La IA no está disponible en este momento. Probá más tarde.";
  }
  return "No se pudo generar la recomendación ahora mismo.";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------- handler */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: "Falta configurar GEMINI_API_KEY en Supabase." }, 500);
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

  const prompt = buildPrompt(summarize(workouts, today));

  let res: Response;
  try {
    res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 400,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              recomendacion: { type: "STRING" },
              consejo: { type: "STRING" },
            },
            required: ["recomendacion", "consejo"],
          },
        },
      }),
    });
  } catch {
    return json({ error: "No se pudo contactar con la IA. Probá más tarde." }, 502);
  }

  const text = await res.text();
  if (!res.ok) {
    console.error("gemini", res.status, text.slice(0, 500));
    return json({ error: friendlyGeminiError(res.status, text) }, 502);
  }

  let out: Advice | null = null;
  try {
    const data = JSON.parse(text);
    const part = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    out = parseModelJson(part);
  } catch {
    out = null;
  }

  if (!out) {
    console.error("respuesta ininteligible", text.slice(0, 500));
    return json({ error: "La IA respondió algo que no se pudo leer." }, 502);
  }

  return json({
    recomendacion: out.recomendacion,
    consejo: out.consejo,
    generatedAt: new Date().toISOString(),
  });
}

/* Solo levanta el servidor cuando este archivo es el que se ejecuta, para que
   las pruebas puedan importar las funciones sueltas sin abrir un puerto. */
if (import.meta.main) Deno.serve(handle);
