/* =========================================================================
   auth.ts — quién llama, y con qué permisos se habla con Supabase
   =========================================================================
   Lo comparten todas las funciones que tocan datos de una persona. La regla
   es siempre la misma: el id de usuario sale del token verificado contra el
   propio Supabase, NUNCA de algo que mande el navegador. Es lo que hace que
   una cuenta no pueda ni nombrar los datos de otra.
   ========================================================================= */

/* Se leen al usarlas, no al cargar el módulo: así las pruebas pueden
   prepararlas antes de llamar, y un despliegue sin variables falla con un
   mensaje claro en vez de con cadenas vacías. */
export const supabaseUrl = () => Deno.env.get("SUPABASE_URL") ?? "";
export const serviceKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/* Cabeceras con la service role: acceso total, y por eso solo se usa desde
   dentro de las funciones, jamás se manda al cliente. */
export function svc(extra: Record<string, string> = {}) {
  const k = serviceKey();
  return { "Authorization": `Bearer ${k}`, "apikey": k, ...extra };
}

/* Se valida el token contra el propio Supabase; no se decodifica a mano ni
   se confía en nada del cuerpo de la petición. */
export async function userIdFrom(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const r = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { "Authorization": auth, "apikey": serviceKey() },
    });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}
