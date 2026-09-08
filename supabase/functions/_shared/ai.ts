/* =========================================================================
   ai.ts — la cadena Gemini → Groq, compartida por todas las funciones
   =========================================================================
   Se pregunta primero a Gemini. Si falla por lo que sea (cuota agotada,
   caída, respuesta ilegible o cortada), la MISMA pregunta va a Groq.

   Sirve para texto y para imágenes. Ojo con los modelos: en Groq el que
   usamos para texto NO acepta imágenes, así que hay dos constantes. Ambas
   listas se comprobaron llamando a las APIs de verdad, no leyendo docs.
   ========================================================================= */

/* --- Gemini -------------------------------------------------------------
   Google retira modelos y además deja de habilitarlos para claves nuevas.
   Cuando pasa, la respuesta 404 nombra el sustituto. Para ver los vigentes:
     https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY   */
export const GEMINI_MODEL = "gemini-3.6-flash";
/* El mismo modelo lee imágenes: probado con un PNG de un triángulo azul y
   lo describió bien. No hace falta uno aparte. */
export const GEMINI_VISION_MODEL = "gemini-3.6-flash";

/* --- Groq ---------------------------------------------------------------
   Groq ya no ofrece ningún Llama de chat. Para ver los vigentes:
     curl -H "Authorization: Bearer $GROQ_API_KEY" \
       https://api.groq.com/openai/v1/models                               */
export const GROQ_MODEL = "openai/gpt-oss-120b";
/* gpt-oss-120b responde 400 «content must be a string» si se le manda una
   imagen: es solo texto. qwen sí ve, probado con el mismo triángulo. */
export const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const geminiUrl = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

/* Una imagen tal como viaja a los modelos. */
export interface Img {
  mime: string;
  b64: string;
  label?: string; // p. ej. "foto del 12 de agosto"
}

export interface Advice {
  recomendacion: string;
  consejo: string;
}

export type AskResult =
  | { ok: true; advice: Advice }
  | { ok: false; error: string };

/* ------------------------------------------------------------- parseo */

/* Los modelos que razonan devuelven varias partes, y la del texto no siempre
   es la primera. Se juntan todas las que tengan texto, saltando las marcadas
   como pensamiento. */
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

/* ------------------------------------------------------------- errores */
export function friendlyGeminiError(status: number, body: string): string {
  const b = (body || "").toLowerCase();
  if (status === 429 || b.includes("resource_exhausted") || b.includes("quota")) {
    return "Se agotó la cuota gratis de la IA por ahora. Probá de nuevo más tarde.";
  }
  if (status === 400 && b.includes("api_key_invalid")) {
    return "La clave de la IA no es válida. Revisá GEMINI_API_KEY en Supabase.";
  }
  if (status === 403) return "La clave de la IA no tiene permiso para este modelo.";
  if (status === 404) return "El modelo de IA configurado ya no está disponible.";
  if (status >= 500) return "La IA no está disponible en este momento. Probá más tarde.";
  return "No se pudo generar la recomendación ahora mismo.";
}

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
  if (status >= 500) return "El respaldo no está disponible en este momento.";
  return "El respaldo tampoco pudo generar la recomendación.";
}

/* ------------------------------------------------------------- Gemini */
export async function askGemini(
  prompt: string,
  apiKey: string,
  images: Img[] = [],
): Promise<AskResult> {
  const model = images.length ? GEMINI_VISION_MODEL : GEMINI_MODEL;
  const parts: unknown[] = [{ text: prompt }];
  for (const im of images) {
    if (im.label) parts.push({ text: im.label });
    parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } });
  }

  let res: Response;
  try {
    res = await fetch(`${geminiUrl(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.7,
          /* Muy holgado a propósito: gemini-3.6-flash razona antes de
             escribir y ese razonamiento sale del MISMO presupuesto que la
             respuesta. Con poco margen llegaba cortada a mitad de frase. */
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
    console.error("gemini", model, res.status, text.slice(0, 400));
    return { ok: false, error: friendlyGeminiError(res.status, text) };
  }

  let advice: Advice | null = null;
  let cortada = false;
  try {
    const data = JSON.parse(text);
    cortada = data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
    advice = parseModelJson(extractText(data));
  } catch { /* queda null */ }

  if (!advice) {
    console.error("gemini ininteligible", res.status, text.slice(0, 600));
    return {
      ok: false,
      error: cortada
        ? "La IA se quedó sin espacio para responder. Hay que subir maxOutputTokens."
        : "La IA respondió algo que no se pudo leer.",
    };
  }
  return { ok: true, advice };
}

/* --------------------------------------------------------------- Groq
   Groq no tiene responseSchema, así que el formato se pide por escrito.
   OJO: con response_format json_object, Groq EXIGE que el mensaje contenga
   la palabra «json»; si no, responde 400. Por eso está escrita abajo. */
export const GROQ_JSON_HINT = `

FORMATO DE SALIDA: respondé únicamente con un objeto json válido, sin texto
antes ni después y sin bloques de código. Exactamente estas dos claves:
{"recomendacion": "...", "consejo": "..."}`;

export function groqPrompt(sharedPrompt: string): string {
  return sharedPrompt + GROQ_JSON_HINT;
}

export async function askGroq(
  prompt: string,
  apiKey: string,
  images: Img[] = [],
): Promise<AskResult> {
  const model = images.length ? GROQ_VISION_MODEL : GROQ_MODEL;

  /* Con imágenes el contenido es una lista de piezas; sin imágenes tiene que
     ser un string pelado, porque gpt-oss-120b rechaza la lista. */
  let content: unknown;
  if (images.length) {
    const piezas: unknown[] = [{ type: "text", text: groqPrompt(prompt) }];
    for (const im of images) {
      if (im.label) piezas.push({ type: "text", text: im.label });
      piezas.push({
        type: "image_url",
        image_url: { url: `data:${im.mime};base64,${im.b64}` },
      });
    }
    content = piezas;
  } else {
    content = groqPrompt(prompt);
  }

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar con el respaldo." };
  }

  const text = await res.text();
  if (!res.ok) {
    console.error("groq", model, res.status, text.slice(0, 400));
    return { ok: false, error: friendlyGroqError(res.status, text) };
  }

  let advice: Advice | null = null;
  try {
    advice = parseModelJson(JSON.parse(text)?.choices?.[0]?.message?.content ?? "");
  } catch { /* queda null */ }

  if (!advice) {
    console.error("groq ininteligible", res.status, text.slice(0, 600));
    return { ok: false, error: "El respaldo respondió algo que no se pudo leer." };
  }
  return { ok: true, advice };
}

/* ------------------------------------------------------------- cadena
   El punto de entrada: mismo prompt y mismas imágenes para las dos, y si la
   primera no puede, la segunda. */
export interface AiKeys {
  gemini?: string;
  groq?: string;
}

export type ChainResult =
  | { ok: true; advice: Advice; provider: "gemini" | "groq" }
  | { ok: false; error: string };

export async function askAI(
  prompt: string,
  keys: AiKeys,
  images: Img[] = [],
): Promise<ChainResult> {
  const fallos: string[] = [];

  if (keys.gemini) {
    const r = await askGemini(prompt, keys.gemini, images);
    if (r.ok) return { ok: true, advice: r.advice, provider: "gemini" };
    fallos.push(r.error);
  }
  if (keys.groq) {
    const r = await askGroq(prompt, keys.groq, images);
    if (r.ok) return { ok: true, advice: r.advice, provider: "groq" };
    fallos.push(r.error);
  }
  return {
    ok: false,
    error: fallos.join(" ") || "No se pudo generar la recomendación.",
  };
}

/* =========================================================================
   CONVERSACIÓN
   =========================================================================
   El coach de fotos devuelve dos campos fijos; el chat, en cambio, es una
   charla: varios turnos y respuesta en texto corriente. Mismo par de
   proveedores y mismo orden (Gemini → Groq), pero sin responseSchema, que
   acá solo estorbaría.
   ========================================================================= */

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/* Gemini llama "model" a lo que OpenAI llama "assistant", y las
   instrucciones de sistema van en su propio campo. */
export async function chatGemini(
  system: string,
  msgs: ChatMsg[],
  apiKey: string,
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${geminiUrl(GEMINI_MODEL)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: msgs.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text }],
        })),
        generationConfig: {
          temperature: 0.8,
          /* Holgado a propósito: el modelo razona antes de escribir y ese
             razonamiento sale del MISMO presupuesto que la respuesta. */
          maxOutputTokens: 4096,
        },
      }),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar con la IA. Probá más tarde." };
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error("gemini chat", res.status, raw.slice(0, 400));
    return { ok: false, error: friendlyGeminiError(res.status, raw) };
  }

  let text = "";
  try {
    text = extractText(JSON.parse(raw));
  } catch { /* queda vacío */ }

  if (!text) {
    console.error("gemini chat vacío", res.status, raw.slice(0, 600));
    return { ok: false, error: "La IA no devolvió respuesta." };
  }
  return { ok: true, text };
}

export async function chatGroq(
  system: string,
  msgs: ChatMsg[],
  apiKey: string,
): Promise<ChatResult> {
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
        temperature: 0.8,
        max_tokens: 900,
        /* Sin response_format: acá la respuesta es texto, no un objeto. Y sin
           él tampoco aplica la regla de Groq de exigir la palabra «json». */
        messages: [
          { role: "system", content: system },
          ...msgs.map((m) => ({ role: m.role, content: m.text })),
        ],
      }),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar con el respaldo." };
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error("groq chat", res.status, raw.slice(0, 400));
    return { ok: false, error: friendlyGroqError(res.status, raw) };
  }

  let text = "";
  try {
    const c = JSON.parse(raw)?.choices?.[0]?.message?.content;
    if (typeof c === "string") text = c.trim();
  } catch { /* queda vacío */ }

  if (!text) {
    console.error("groq chat vacío", res.status, raw.slice(0, 600));
    return { ok: false, error: "El respaldo no devolvió respuesta." };
  }
  return { ok: true, text };
}

export type ChatChainResult =
  | { ok: true; text: string; provider: "gemini" | "groq" }
  | { ok: false; error: string };

export async function chatAI(
  system: string,
  msgs: ChatMsg[],
  keys: AiKeys,
): Promise<ChatChainResult> {
  const fallos: string[] = [];

  if (keys.gemini) {
    const r = await chatGemini(system, msgs, keys.gemini);
    if (r.ok) return { ok: true, text: r.text, provider: "gemini" };
    fallos.push(r.error);
  }
  if (keys.groq) {
    const r = await chatGroq(system, msgs, keys.groq);
    if (r.ok) return { ok: true, text: r.text, provider: "groq" };
    fallos.push(r.error);
  }
  return { ok: false, error: fallos.join(" ") || "No se pudo responder ahora mismo." };
}

/* CORS y respuestas JSON, que las usan todas las funciones. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
