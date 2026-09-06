/* =========================================================================
   coach — recomendación de entrenamiento, con Gemini y Groq de respaldo
   =========================================================================
   El cliente manda un resumen de sus últimas sesiones; acá se calculan los
   hechos (cuántos días hace de cada tipo, medias, notas) y se le pide al
   modelo que los redacte. Los números NO los inventa el modelo: se los damos
   ya masticados para que no se equivoque contando.

   Se pregunta primero a Gemini. Si falla por lo que sea —cuota agotada,
   caída, respuesta ilegible— la MISMA pregunta va a Groq. El contexto lo
   arma buildPrompt() una sola vez y lo comparten las dos: lo único distinto
   es cómo se les pide el JSON, porque Gemini tiene responseSchema y a Groq
   hay que decírselo por escrito.

   Las claves (GEMINI_API_KEY, GROQ_API_KEY) viven en el entorno de la
   función y nunca salen de acá.

   El modelo de datos de GymLog no tiene ejercicios ni series: solo fecha,
   tipo, duración, energía, sensación, dificultad, peso y notas. El prompt lo
   dice explícitamente para que no se invente rutinas.
   ========================================================================= */

/* Google retira modelos y además deja de habilitarlos para claves nuevas.
   Cuando pasa, la función responde «El modelo de IA configurado ya no está
   disponible» (404 de Gemini): es la señal de cambiar esta línea.

   Para saber cuál poner, la propia respuesta 404 de Google nombra el
   sustituto, y este endpoint lista los que la clave puede usar:
     https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY

   Ojo con los alias tipo «gemini-flash-latest»: se ven cómodos, pero al
   probarlos daban 503 por saturación. Mejor un modelo concreto. */
export const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/* Respaldo: cuando Gemini falla (cuota agotada, caída, lo que sea), la misma
   pregunta va a Groq. Endpoint compatible con OpenAI.

   Ojo: Groq ya no ofrece ningún Llama de chat. llama-3.3-70b-versatile está
   dado de baja, y en la lista de la clave no queda ninguno de la familia.
   Para ver los vigentes:
     curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models */
export const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

/* Los modelos que razonan devuelven varias partes, y la del texto no siempre
   es la primera: puede venir antes una parte de razonamiento. Se juntan todas
   las que tengan texto, saltando las marcadas como pensamiento. */
export function extractText(data: unknown): string {
  const parts = (data as {
    candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[];
  })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("")
    .trim();
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

/* Groq habla el dialecto de OpenAI y sus errores son otros. */
export function friendlyGroqError(status: number, body: string): string {
  const b = (body || "").toLowerCase();
  if (status === 429 || b.includes("rate_limit") || b.includes("quota")) {
    return "También se agotó la cuota del respaldo. Probá de nuevo más tarde.";
  }
  if (status === 401 || b.includes("invalid_api_key")) {
    return "La clave del respaldo no es válida. Revisá GROQ_API_KEY en Supabase.";
  }
  if (status === 404 || b.includes("model_not_found") || b.includes("decommissioned")) {
    return "El modelo del respaldo ya no está disponible.";
  }
  if (status >= 500) {
    return "El respaldo no está disponible en este momento.";
  }
  return "El respaldo tampoco pudo generar la recomendación.";
}

/* Resultado de preguntarle a una IA: o sale bien, o explica por qué no. */
export type AskResult =
  | { ok: true; advice: Advice }
  | { ok: false; error: string };

/* ------------------------------------------------------------- Gemini
   Aprovecha responseSchema, que obliga al modelo a devolver los dos campos
   sin tener que pedírselo por escrito. */
export async function askGemini(prompt: string, apiKey: string): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          /* Muy holgado a propósito. gemini-3.6-flash razona antes de
             escribir y ese razonamiento sale del MISMO presupuesto que la
             respuesta. Con 1200 la respuesta llegaba cortada a mitad de
             frase (finishReason MAX_TOKENS) y el JSON quedaba sin cerrar.
             La respuesta útil son ~200 tokens; el resto es para pensar. */
          maxOutputTokens: 4096,
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
    return { ok: false, error: "No se pudo contactar con la IA. Probá más tarde." };
  }

  const text = await res.text();
  if (!res.ok) {
    console.error("gemini", res.status, text.slice(0, 500));
    return { ok: false, error: friendlyGeminiError(res.status, text) };
  }

  let advice: Advice | null = null;
  let cortada = false;
  try {
    const data = JSON.parse(text);
    cortada = data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
    advice = parseModelJson(extractText(data));
  } catch { /* advice queda en null */ }

  if (!advice) {
    console.error("gemini ininteligible", res.status, text.slice(0, 800));
    return {
      ok: false,
      error: cortada
        ? "La IA se quedó sin espacio para responder. Hay que subir maxOutputTokens en la función."
        : "La IA respondió algo que no se pudo leer.",
    };
  }
  return { ok: true, advice };
}

/* --------------------------------------------------------------- Groq
   Mismo prompt que Gemini, palabra por palabra: los mismos días por tipo,
   las mismas medias, las mismas notas y las mismas reglas. Lo único que se
   suma es cómo pedir el JSON, porque Groq no tiene responseSchema y hay que
   decírselo por escrito.

   OJO: con response_format json_object, Groq EXIGE que el mensaje contenga
   la palabra «json»; si no, responde 400. Por eso está escrita abajo, y hay
   una prueba que lo comprueba. */
export const GROQ_JSON_HINT = `

FORMATO DE SALIDA: respondé únicamente con un objeto json válido, sin texto
antes ni después y sin bloques de código. Exactamente estas dos claves:
{"recomendacion": "...", "consejo": "..."}`;

export function groqPrompt(sharedPrompt: string): string {
  return sharedPrompt + GROQ_JSON_HINT;
}

export async function askGroq(prompt: string, apiKey: string): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: groqPrompt(prompt) }],
      }),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar con el respaldo." };
  }

  const text = await res.text();
  if (!res.ok) {
    console.error("groq", res.status, text.slice(0, 500));
    return { ok: false, error: friendlyGroqError(res.status, text) };
  }

  let advice: Advice | null = null;
  try {
    const data = JSON.parse(text);
    advice = parseModelJson(data?.choices?.[0]?.message?.content ?? "");
  } catch { /* advice queda en null */ }

  if (!advice) {
    console.error("groq ininteligible", res.status, text.slice(0, 800));
    return { ok: false, error: "El respaldo respondió algo que no se pudo leer." };
  }
  return { ok: true, advice };
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

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!geminiKey && !groqKey) {
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

  /* Un solo contexto para las dos IAs: los mismos días por tipo, las mismas
     medias, las mismas notas y las mismas reglas. Groq solo le suma, aparte,
     cómo tiene que formatear el JSON. */
  const prompt = buildPrompt(summarize(workouts, today));

  const fallos: string[] = [];
  let advice: Advice | null = null;
  let provider = "";

  if (geminiKey) {
    const r = await askGemini(prompt, geminiKey);
    if (r.ok) { advice = r.advice; provider = "gemini"; }
    else fallos.push(r.error);
  }

  /* Cualquier fallo de Gemini (cuota, caída, respuesta ilegible) manda la
     misma pregunta a Groq antes de darse por vencido. */
  if (!advice && groqKey) {
    const r = await askGroq(prompt, groqKey);
    if (r.ok) { advice = r.advice; provider = "groq"; }
    else fallos.push(r.error);
  }

  if (!advice) {
    /* Se muestra el primer motivo, que es el de la IA principal y el que
       suele importar; si hubo dos, el segundo va detrás. */
    return json({ error: fallos.join(" ") || "No se pudo generar la recomendación." }, 502);
  }

  return json({
    recomendacion: advice.recomendacion,
    consejo: advice.consejo,
    provider,
    generatedAt: new Date().toISOString(),
  });
}

/* Solo levanta el servidor cuando este archivo es el que se ejecuta, para que
   las pruebas puedan importar las funciones sueltas sin abrir un puerto. */
if (import.meta.main) Deno.serve(handle);
