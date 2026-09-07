/* =========================================================================
   photos — fotos de progreso en Supabase Storage
   =========================================================================
   AISLAMIENTO: el bucket es privado y NO tiene ninguna política que permita
   el acceso directo del cliente. Todo pasa por acá, y el id de usuario sale
   SIEMPRE del token verificado, nunca de lo que mande el navegador. Las
   rutas son `<userId>/<archivo>`, así que un usuario no puede ni nombrar la
   carpeta de otro: no hay parámetro que lo permita.

   Las URLs que se devuelven son firmadas y caducan en una hora.

   La opinión de la IA reusa la cadena Gemini → Groq de ../_shared/ai.ts,
   con los modelos que sí aceptan imágenes.
   ========================================================================= */
import { askAI, CORS, Img, json } from "../_shared/ai.ts";
import {
  AnalysisEntry,
  trimHistory,
  usageFor,
} from "../_shared/weeklyLimit.ts";

const BUCKET = "progress";
/* El registro de análisis de cada usuario, dentro de su propia carpeta: se
   aísla igual que las fotos y no hace falta una tabla nueva. El nombre no
   empieza por fecha, así que listar() no lo confunde con una foto. */
const LEDGER = "usage.json";
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB por foto
const SIGNED_TTL = 3600;

/* Se leen al usarlas, no al cargar el módulo: así las pruebas pueden
   prepararlas antes de llamar, y un despliegue sin variables falla con un
   mensaje claro en vez de con cadenas vacías. */
const url = () => Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const hoy = () => new Date().toISOString().slice(0, 10);

function svc(extra: Record<string, string> = {}) {
  const k = serviceKey();
  return { "Authorization": `Bearer ${k}`, "apikey": k, ...extra };
}

/* ------------------------------------------------------- quién llama
   Se valida el token contra el propio Supabase; no se decodifica a mano ni
   se confía en nada del cuerpo de la petición. */
async function userIdFrom(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const r = await fetch(`${url()}/auth/v1/user`, {
      headers: { "Authorization": auth, "apikey": serviceKey() },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

/* El bucket se crea solo la primera vez. Privado y sin políticas: nadie que
   no sea esta función (con la service role) puede leerlo ni listarlo.
   Se memoriza para no consultarlo en cada petición. */
let bucketListo: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (!bucketListo) bucketListo = crearBucket();
  return bucketListo;
}

async function crearBucket(): Promise<void> {
  const r = await fetch(`${url()}/storage/v1/bucket/${BUCKET}`, {
    headers: svc(),
  });
  if (r.ok) { await r.body?.cancel(); return; }
  await fetch(`${url()}/storage/v1/bucket`, {
    method: "POST",
    headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: MAX_BYTES,
      /* json además de las imágenes, porque el registro de análisis vive en
         el mismo bucket. */
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "application/json"],
    }),
  }).then((x) => x.body?.cancel());
}

/* ------------------------------------------------- registro de análisis
   Un JSON por usuario en su propia carpeta. Se lee y se escribe solo desde
   acá con la service role: el navegador no lo ve ni lo puede tocar. */
async function leerLedger(userId: string): Promise<AnalysisEntry[]> {
  const r = await fetch(`${url()}/storage/v1/object/${BUCKET}/${userId}/${LEDGER}`, {
    headers: svc(),
  });
  if (!r.ok) { await r.text(); return []; }
  try {
    const d = await r.json();
    return Array.isArray(d?.entries) ? d.entries : [];
  } catch {
    return [];
  }
}

async function guardarLedger(userId: string, entries: AnalysisEntry[]): Promise<void> {
  const cuerpo = new Blob([JSON.stringify({ entries: trimHistory(entries) })], {
    type: "application/json",
  });
  /* upsert para pisar el anterior en vez de fallar por duplicado. */
  const r = await fetch(`${url()}/storage/v1/object/${BUCKET}/${userId}/${LEDGER}`, {
    method: "POST",
    headers: svc({ "x-upsert": "true", "Content-Type": "application/json" }),
    body: cuerpo,
  });
  if (!r.ok) console.error("ledger", r.status, (await r.text()).slice(0, 200));
  else await r.text();
}

interface Foto {
  path: string;
  date: string; // YYYY-MM-DD
  name: string;
  created_at?: string;
}

/* Las fotos de un usuario, de más nueva a más vieja. La fecha va en el
   nombre del archivo, así el orden no depende de metadatos. */
async function listar(userId: string): Promise<Foto[]> {
  const r = await fetch(`${url()}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      prefix: `${userId}/`,
      limit: 200,
      sortBy: { column: "name", order: "desc" },
    }),
  });
  if (!r.ok) { await r.text(); return []; }
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((o: { name?: string }) => o?.name && !o.name.endsWith("/"))
    .map((o: { name: string; created_at?: string }) => ({
      path: `${userId}/${o.name}`,
      name: o.name,
      date: (o.name.match(/^(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? "",
      created_at: o.created_at,
    }))
    .filter((f: Foto) => f.date)
    .sort((a: Foto, b: Foto) => (a.name < b.name ? 1 : -1));
}

async function firmar(path: string): Promise<string | null> {
  const r = await fetch(`${url()}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: SIGNED_TTL }),
  });
  if (!r.ok) { await r.text(); return null; }
  const d = await r.json();
  return d?.signedURL ? `${url()}/storage/v1${d.signedURL}` : null;
}

async function descargarB64(path: string): Promise<Img | null> {
  const r = await fetch(`${url()}/storage/v1/object/${BUCKET}/${path}`, {
    headers: svc(),
  });
  if (!r.ok) { await r.text(); return null; }
  const mime = r.headers.get("content-type") ?? "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { mime, b64: btoa(bin) };
}

/* ------------------------------------------------------------- prompt
   Mismo espíritu que el de coach: hechos concretos y prohibiciones claras.
   La IA ve fotos, así que hay que ser explícito en que no diagnostique ni
   opine sobre el cuerpo de nadie más allá del cambio visible. */
export function buildPhotoPrompt(fechas: string[]): string {
  const lista = fechas
    .map((f, i) => `${i + 1}. ${i === 0 ? "la más reciente" : "anterior"}: ${f}`)
    .join("\n");

  return `Sos el entrenador de una app de registro de gimnasio llamada GymLog.
Hablás en español rioplatense (vos, tenés, hacés), directo y sin florituras.

Te paso ${fechas.length} ${fechas.length === 1 ? "foto" : "fotos"} de progreso
de la misma persona, en este orden:
${lista}

Comentá brevemente los cambios visibles de un período a otro: postura,
volumen, definición, cómo le queda la ropa. Si las fotos son muy parecidas o
están sacadas en condiciones distintas (luz, ángulo, distancia), decilo con
honestidad en vez de inventar un cambio.

REGLAS:
- Nada de diagnósticos médicos, ni de estimar porcentajes de grasa corporal,
  ni de comentar el aspecto físico más allá del cambio entre fotos.
- Nada de consejos de nutrición ni de suplementos.
- No inventes rutinas con ejercicios, series ni repeticiones: la app no
  registra nada de eso.
- Si hay una sola foto, no hay comparación posible: decilo y limitate a
  señalar que sirve como punto de partida.

Devolvé exactamente dos campos:
"recomendacion": qué se ve de una foto a otra. Dos o tres frases.
"consejo": una sugerencia corta para que las próximas fotos sean más
comparables (misma luz, mismo ángulo, misma distancia, misma hora).`;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  if (!url() || !serviceKey()) {
    return json({ error: "La función no tiene acceso a Storage." }, 500);
  }

  /* El bucket es infraestructura, no dato de nadie: se asegura antes de mirar
     quién llama, así existe (vacío y privado) desde el primer despliegue. */
  await ensureBucket();

  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Necesitás iniciar sesión." }, 401);

  let body: { action?: unknown; date?: unknown; name?: unknown; path?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const action = String(body.action ?? "");

  /* ---------------------------------------------------------- subir */
  if (action === "upload-url") {
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const ext = String(body.name ?? "").toLowerCase().endsWith(".png") ? "png" : "jpg";
    /* La ruta la arma el servidor: fecha para ordenar y aleatorio para no
       pisar otra foto del mismo día. */
    const path = `${userId}/${date}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    const r = await fetch(
      `${url()}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
      { method: "POST", headers: svc({ "Content-Type": "application/json" }) },
    );
    if (!r.ok) {
      console.error("upload-sign", r.status, (await r.text()).slice(0, 300));
      return json({ error: "No se pudo preparar la subida." }, 502);
    }
    const d = await r.json();
    return json({ path, uploadUrl: `${url()}/storage/v1${d.url}` });
  }

  /* --------------------------------------------------------- listar
     Devuelve además cuántos análisis quedan y el historial, para que la
     pantalla lo muestre sin una segunda llamada. */
  if (action === "list") {
    const fotos = await listar(userId);
    const out = [];
    for (const f of fotos) {
      const signed = await firmar(f.path);
      if (signed) out.push({ path: f.path, date: f.date, url: signed });
    }
    const entries = await leerLedger(userId);
    return json({
      photos: out,
      usage: usageFor(entries, hoy()),
      history: entries.slice(0, 10),
    });
  }

  /* -------------------------------------------------------- borrar
     Solo puede borrar dentro de su propia carpeta: la ruta se compara
     contra el id del token, no contra lo que diga el cliente. */
  if (action === "delete") {
    const path = String(body.path ?? "");
    if (!path.startsWith(`${userId}/`) || path.includes("..")) {
      return json({ error: "Esa foto no es tuya." }, 403);
    }
    const r = await fetch(`${url()}/storage/v1/object/${BUCKET}/${path}`, {
      method: "DELETE",
      headers: svc(),
    });
    await r.text();
    return json({ ok: r.ok });
  }

  /* -------------------------------------------- uso, sin analizar nada */
  if (action === "usage") {
    const entries = await leerLedger(userId);
    return json({ usage: usageFor(entries, hoy()), history: entries.slice(0, 10) });
  }

  /* --------------------------------------------------- opinión IA
     El límite se comprueba ACÁ, no en el navegador: es lo que evita que
     tocando el cliente se gasten tokens sin tope. La foto ya está guardada
     pase lo que pase; lo único que se bloquea es el análisis. */
  if (action === "opine") {
    const entries = await leerLedger(userId);
    const usage = usageFor(entries, hoy());
    if (!usage.allowed) {
      return json({
        error: `Ya usaste tus ${usage.limit} análisis de esta semana. ` +
          `Vuelven el lunes ${usage.nextReset}.`,
        usage,
        limited: true,
      }, 429);
    }

    const keys = {
      gemini: Deno.env.get("GEMINI_API_KEY") ?? undefined,
      groq: Deno.env.get("GROQ_API_KEY") ?? undefined,
    };
    if (!keys.gemini && !keys.groq) {
      return json({ error: "Falta configurar GEMINI_API_KEY o GROQ_API_KEY." }, 500);
    }

    const fotos = await listar(userId);
    if (!fotos.length) return json({ error: "Todavía no subiste ninguna foto.", usage }, 400);

    /* La más reciente y hasta dos anteriores. */
    const elegidas = fotos.slice(0, 3);
    const imgs: Img[] = [];
    for (const f of elegidas) {
      const im = await descargarB64(f.path);
      if (im) imgs.push({ ...im, label: `Foto del ${f.date}:` });
    }
    if (!imgs.length) return json({ error: "No se pudieron leer las fotos.", usage }, 502);

    const r = await askAI(buildPhotoPrompt(elegidas.map((f) => f.date)), keys, imgs);
    /* Si la IA falló no se descuenta: sería cobrarle un análisis que no
       llegó a existir. */
    if (!r.ok) return json({ error: r.error, usage }, 502);

    const entrada: AnalysisEntry = {
      at: hoy(),
      photo: elegidas[0].path,
      recomendacion: r.advice.recomendacion,
      consejo: r.advice.consejo,
      provider: r.provider,
    };
    const actualizado = trimHistory([entrada, ...entries]);
    await guardarLedger(userId, actualizado);

    return json({
      recomendacion: r.advice.recomendacion,
      consejo: r.advice.consejo,
      provider: r.provider,
      compared: elegidas.map((f) => f.date),
      usage: usageFor(actualizado, hoy()),
      history: actualizado.slice(0, 10),
      generatedAt: new Date().toISOString(),
    });
  }

  return json({ error: "Acción desconocida." }, 400);
}

if (import.meta.main) Deno.serve(handle);
