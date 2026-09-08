/* =========================================================================
   chat — el entrenador que contesta preguntas
   =========================================================================
   AISLAMIENTO: hace falta un token válido, y el historial de la
   conversación lo manda el cliente desde SU propia cuenta (vive en los
   ajustes, que viajan por la tabla `backups` con RLS por auth.uid()). Acá no
   se guarda nada: la función es apátrida, así que no hay ningún almacén
   compartido del que se pueda leer la charla de otra persona.

   La clave de la IA vive en el entorno de la función; el navegador nunca la
   ve. Reusa la cadena Gemini → Groq de ../_shared/ai.ts, la misma que el
   análisis de fotos.
   ========================================================================= */
import { chatAI, CORS, json } from "../_shared/ai.ts";
import { supabaseUrl, userIdFrom } from "../_shared/auth.ts";
import { buildChatSystem, limpiarMensajes, limpiarPerfil } from "../_shared/chatPrompt.ts";

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  if (!supabaseUrl()) return json({ error: "La función no está bien configurada." }, 500);

  /* Sin sesión no se contesta: si no, cualquiera con la clave pública
     gastaría la cuota de IA del proyecto. */
  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Necesitás iniciar sesión." }, 401);

  let body: { messages?: unknown; profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const msgs = limpiarMensajes(body.messages);
  if (!msgs.length) return json({ error: "No hay ninguna pregunta que responder." }, 400);
  if (msgs[msgs.length - 1].role !== "user") {
    return json({ error: "El último mensaje tiene que ser tuyo." }, 400);
  }

  const keys = {
    gemini: Deno.env.get("GEMINI_API_KEY") ?? undefined,
    groq: Deno.env.get("GROQ_API_KEY") ?? undefined,
  };
  if (!keys.gemini && !keys.groq) {
    return json({ error: "Falta configurar GEMINI_API_KEY o GROQ_API_KEY." }, 500);
  }

  const system = buildChatSystem(
    limpiarPerfil(body.profile),
    new Date().toISOString().slice(0, 10),
  );

  const r = await chatAI(system, msgs, keys);
  if (!r.ok) return json({ error: r.error }, 502);

  return json({
    reply: r.text,
    provider: r.provider,
    generatedAt: new Date().toISOString(),
  });
}

if (import.meta.main) Deno.serve(handle);
