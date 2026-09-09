/* =========================================================================
   unsplash — foto de fondo para la tarjeta que se comparte
   =========================================================================
   La clave de Unsplash vive en el entorno de la función (UNSPLASH_ACCESS_KEY)
   y nunca llega al navegador. Hace falta sesión, igual que en chat, photos y
   coach: si no, cualquiera con la clave pública del proyecto podría gastar
   las 50 solicitudes por hora del plan gratis.

   ATRIBUCIÓN: los términos de Unsplash obligan a nombrar al fotógrafo y a
   Unsplash, enlazando a sus perfiles con utm_source y utm_medium=referral, y
   a avisar a Unsplash cuando una foto se usa de verdad (el «download
   trigger»). Las dos cosas se hacen acá: los enlaces se devuelven ya
   armados y el aviso se dispara antes de responder.

   El mapeo de categorías a términos de búsqueda está en
   ../_shared/unsplashTerms.ts, que es lo que se va a querer retocar.
   ========================================================================= */
import { CORS, json } from "../_shared/ai.ts";
import { supabaseUrl, userIdFrom } from "../_shared/auth.ts";
import { normalizeCategory, termFor } from "../_shared/unsplashTerms.ts";

const API = "https://api.unsplash.com";

/* Nombre de la app registrada en Unsplash. Va en los utm_source de la
   atribución; si algún día se renombra la app, se cambia acá. */
export const APP_NAME = "GymLog";

/* De cuántas fotos se elige una al azar. Con 1 saldría siempre la misma y la
   tarjeta se volvería aburrida; con demasiadas, la calidad baja. */
export const POOL = 12;

/* La tarjeta es 1080x1350, así que se pide ya recortada a esa proporción en
   vez de recortarla en el canvas. */
export const CARD_W = 1080;
export const CARD_H = 1350;

const utm = (base: string) =>
  `${base}${base.includes("?") ? "&" : "?"}utm_source=${APP_NAME}&utm_medium=referral`;

function friendlyError(status: number): string {
  if (status === 401 || status === 403) {
    return "La clave de Unsplash no es válida o no tiene permiso.";
  }
  if (status === 429) {
    return "Se agotó la cuota de Unsplash por esta hora. Probá más tarde.";
  }
  if (status >= 500) return "Unsplash no está disponible en este momento.";
  return "No se pudo traer la foto de fondo.";
}

/* Unsplash pide avisar cada vez que una foto se usa de verdad. No es
   opcional: es parte de sus términos. Si falla, da igual: no vamos a dejar
   sin tarjeta a nadie por esto. */
async function avisarUso(downloadLocation: string, key: string): Promise<void> {
  try {
    const r = await fetch(downloadLocation, {
      headers: { "Authorization": `Client-ID ${key}` },
    });
    await r.body?.cancel();
  } catch {
    /* silencio a propósito */
  }
}

interface Foto {
  urls?: { raw?: string; regular?: string; small?: string };
  links?: { download_location?: string; html?: string };
  alt_description?: string;
  user?: { name?: string; username?: string; links?: { html?: string } };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  if (!supabaseUrl()) return json({ error: "La función no está bien configurada." }, 500);

  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Necesitás iniciar sesión." }, 401);

  const key = Deno.env.get("UNSPLASH_ACCESS_KEY") ?? "";
  /* 503 y no 500: no es un fallo, es que la integración no está montada. El
     cliente lo trata como «sin foto» y la tarjeta sale con su fondo de
     siempre. */
  if (!key) {
    return json({ error: "Falta configurar UNSPLASH_ACCESS_KEY.", disponible: false }, 503);
  }

  let body: { category?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const query = termFor(body.category);
  const category = normalizeCategory(body.category);

  const url = `${API}/search/photos?query=${encodeURIComponent(query)}` +
    `&per_page=${POOL}&orientation=portrait&content_filter=high`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "Authorization": `Client-ID ${key}`,
        "Accept-Version": "v1",
      },
    });
  } catch {
    return json({ error: "No se pudo contactar con Unsplash." }, 502);
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error("unsplash", res.status, raw.slice(0, 300));
    return json({ error: friendlyError(res.status) }, 502);
  }

  let fotos: Foto[] = [];
  try {
    const d = JSON.parse(raw);
    fotos = Array.isArray(d?.results) ? d.results : [];
  } catch {
    return json({ error: "Unsplash respondió algo que no se pudo leer." }, 502);
  }

  fotos = fotos.filter((f) => f?.urls?.raw || f?.urls?.regular);
  if (!fotos.length) {
    return json({ error: `Unsplash no devolvió fotos para «${query}».` }, 502);
  }

  const foto = fotos[Math.floor(Math.random() * fotos.length)];

  /* Sobre urls.raw se pueden pedir las dimensiones exactas de la tarjeta, y
     así no hay que recortar nada en el canvas. */
  const base = foto.urls?.raw;
  const imageUrl = base
    ? `${base}&w=${CARD_W}&h=${CARD_H}&fit=crop&crop=entropy&q=80&fm=jpg`
    : foto.urls!.regular!;

  if (foto.links?.download_location) await avisarUso(foto.links.download_location, key);

  const perfil = foto.user?.links?.html ??
    (foto.user?.username ? `https://unsplash.com/@${foto.user.username}` : "https://unsplash.com");

  return json({
    disponible: true,
    category,
    query,
    imageUrl,
    alt: foto.alt_description ?? "",
    photographer: foto.user?.name ?? "Unsplash",
    /* Los dos enlaces que exigen los términos, ya con utm. */
    photographerUrl: utm(perfil),
    unsplashUrl: utm("https://unsplash.com/"),
    generatedAt: new Date().toISOString(),
  });
}

if (import.meta.main) Deno.serve(handle);
