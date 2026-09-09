/* =========================================================================
   send-reminders — el aviso de «hoy tocaba y no registraste nada»
   =========================================================================
   La llama el cron de la base de datos una vez al día, nadie más. Por eso
   NO usa el patrón de sesión de chat/photos/coach: no hay usuario detrás.
   En su lugar exige un token compartido en la cabecera x-reminder-token,
   que solo conocen el cron y el entorno de la función. Sin él no se manda
   nada, y así nadie con la URL puede gastar la cuota de OneSignal.

   A quién avisar sale de dos sitios, los dos con la service role:
     - push_subscriptions: quién activó los recordatorios (RLS por usuario,
       pero la service role la recorre entera a propósito).
     - backups: el respaldo de cada cuenta, de donde salen sus días de
       gimnasio y si ya registró algo hoy.

   El texto y la hora están en ../_shared/reminderText.ts.
   ========================================================================= */
import { CORS, json } from "../_shared/ai.ts";
import { serviceKey, supabaseUrl, svc } from "../_shared/auth.ts";
import { messageFor, todayInBogota, weekdayInBogota } from "../_shared/reminderText.ts";

const ONESIGNAL_API = "https://api.onesignal.com/notifications";
/* Host anterior. OneSignal mantiene los dos; alguna clave vieja solo
   funciona contra este. */
const ONESIGNAL_API_LEGACY = "https://onesignal.com/api/v1/notifications";
export const ENDPOINTS = [ONESIGNAL_API, ONESIGNAL_API_LEGACY] as const;
/* Endpoint de app (no de organización): sirve para validar la clave REST. */
const ONESIGNAL_LIST = "https://api.onesignal.com/notifications";
export const ONESIGNAL_APP_ID = "6f77941f-f54d-4483-bc7d-60603cfe06a5";

/* A dónde lleva el aviso al tocarlo. */
export const LAUNCH_URL = "https://gymlog-delta-bay.vercel.app/";

export interface Suscripcion {
  user_id: string;
  subscription_id: string;
}

export interface Respaldo {
  user_id: string;
  payload: {
    settings?: { gymDays?: unknown; reminders?: unknown };
    workouts?: { date?: unknown; went?: unknown }[];
  } | null;
}

/* ------------------------------------------------------ a quién avisar
   Se avisa cuando hoy es día programado, no hay ninguna sesión registrada
   con la fecha de hoy, y la persona no apagó los recordatorios dentro de la
   app. Sin respaldo todavía no se sabe nada de ella: no se le escribe. */
export function debeAvisarse(respaldo: Respaldo | undefined, hoy: string): boolean {
  const p = respaldo?.payload;
  if (!p) return false;

  if (p.settings?.reminders === false) return false;

  const dias = Array.isArray(p.settings?.gymDays) ? p.settings!.gymDays as unknown[] : [];
  const hoyDow = weekdayInBogota(hoy);
  if (!dias.map(Number).includes(hoyDow)) return false;

  const yaRegistro = (Array.isArray(p.workouts) ? p.workouts : [])
    .some((w) => w && w.date === hoy);
  return !yaRegistro;
}

/* Quiénes, de los suscritos, tocan hoy. */
export function destinatarios(
  subs: Suscripcion[],
  respaldos: Respaldo[],
  hoy: string,
): Suscripcion[] {
  const porUsuario = new Map(respaldos.map((r) => [r.user_id, r]));
  return subs.filter((s) =>
    !!s.subscription_id && debeAvisarse(porUsuario.get(s.user_id), hoy)
  );
}

async function leerTabla<T>(tabla: string, columnas: string): Promise<T[]> {
  const r = await fetch(
    `${supabaseUrl()}/rest/v1/${tabla}?select=${encodeURIComponent(columnas)}`,
    { headers: svc({ "Accept": "application/json" }) },
  );
  if (!r.ok) {
    console.error(tabla, r.status, (await r.text()).slice(0, 300));
    return [];
  }
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

/* ------------------------------------------------------------ OneSignal
   Una sola llamada con todos los ids: la API acepta hasta 2000 por envío y
   así no se gasta una solicitud por persona. */
export async function enviar(
  ids: string[],
  mensaje: { title: string; body: string },
  restKey: string,
): Promise<{ ok: boolean; status: number; body: string; formato: string | null }> {
  const cuerpo = JSON.stringify({
    app_id: ONESIGNAL_APP_ID,
    include_subscription_ids: ids,
    headings: { en: mensaje.title, es: mensaje.title },
    contents: { en: mensaje.body, es: mensaje.body },
    url: LAUNCH_URL,
  });

  /* Los dos formatos de autorización, por el mismo motivo que en
     verificarClave(): según la antigüedad de la clave funciona uno u otro.
     Un 401 con el primero no es un fallo, es que toca el segundo. */
  let ultimo = { ok: false, status: 0, body: "sin respuesta", formato: null as string | null };
  for (const formato of AUTH_FORMATS) {
    const res = await fetch(ONESIGNAL_API, {
      method: "POST",
      headers: {
        "Authorization": `${formato} ${restKey}`,
        "Content-Type": "application/json",
      },
      body: cuerpo,
    });
    const body = await res.text();
    if (res.ok) return { ok: true, status: res.status, body, formato };
    ultimo = { ok: false, status: res.status, body, formato };
    /* Un 401/403 es «probá el otro formato»; cualquier otro error es un
       problema de verdad y no se insiste. */
    if (res.status !== 401 && res.status !== 403) break;
  }
  return ultimo;
}

/* Comprueba la clave REST SIN mandar ninguna notificación.

   Dos cosas que cuestan un rato descubrir a mano:
   - El endpoint /apps/{id} NO acepta la clave REST de una app: pide la User
     Auth Key de la organización. Para validar una clave de app hay que
     pegarle a un endpoint de app, como el listado de notificaciones.
   - OneSignal aceptó durante años «Basic <clave>» y ahora documenta
     «Key <clave>». Según cuándo se generó la clave funciona una u otra, así
     que se prueban las dos y se informa cuál sirvió. */
export const AUTH_FORMATS = ["Key", "Basic"] as const;

/* Describe la clave SIN revelarla: longitud, familia y si viene con espacios
   pegados. Con eso se distingue un pegado con salto de línea de una clave de
   otro tipo (el App ID es un UUID de 36; la User Auth Key no sirve acá) sin
   que el secreto salga nunca en una respuesta ni en los registros. */
export function describirClave(raw: string): {
  largo: number;
  familia: string;
  conEspacios: boolean;
} {
  const limpia = raw.trim();
  let familia = "desconocida";
  if (/^os_v2_app_/.test(limpia)) familia = "v2 de app (os_v2_app_…)";
  else if (/^os_v2_org_/.test(limpia)) familia = "v2 de organización (no sirve para enviar)";
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpia)) {
    familia = "un UUID: parece el App ID, no la clave REST";
  } else if (/^[A-Za-z0-9+/=_-]{40,60}$/.test(limpia)) familia = "clave REST clásica";
  return { largo: limpia.length, familia, conEspacios: raw !== limpia };
}

/* Las claves «os_v2_app_…» llevan dentro, en base32, el id de la app a la
   que pertenecen. Sacarlo y compararlo con el App ID configurado distingue
   «la clave está mal» de «la clave es de OTRA app», que da el mismo 401 y
   es un error facilísimo de cometer con varias apps en la cuenta.
   El App ID no es secreto, así que devolverlo no revela nada. */
export function appIdDeLaClave(restKey: string): string | null {
  const m = restKey.trim().match(/^os_v2_app_([a-z2-7]+)/i);
  if (!m) return null;
  try {
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of m[1].toUpperCase()) {
      const i = alfabeto.indexOf(c);
      if (i < 0) return null;
      bits += i.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length && bytes.length < 16; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    if (bytes.length < 16) return null;
    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch {
    return null;
  }
}

/* Prueba el endpoint que de verdad importa —el de enviar— contra un id de
   suscripción inexistente. Si la clave sirve, OneSignal contesta 400
   («no hay destinatarios»), no 401. Es la única forma honesta de saber si
   se puede enviar sin mandarle nada a nadie. */
export async function probarEnvio(restKey: string): Promise<{
  ok: boolean;
  formato: string | null;
  status: number;
  detalle: string;
}> {
  let ultimo = { status: 0, detalle: "sin respuesta" };
  for (const endpoint of ENDPOINTS) {
    for (const formato of AUTH_FORMATS) {
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `${formato} ${restKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            app_id: ONESIGNAL_APP_ID,
            include_subscription_ids: ["00000000-0000-0000-0000-000000000000"],
            contents: { en: "prueba" },
          }),
        });
        const body = await r.text();
        /* 400 con la queja de destinatarios = autenticó bien. */
        if (r.status !== 401 && r.status !== 403) {
          return {
            ok: true,
            formato: `${formato} en ${endpoint}`,
            status: r.status,
            detalle: body.slice(0, 200),
          };
        }
        ultimo = { status: r.status, detalle: body.slice(0, 200) };
      } catch (e) {
        ultimo = { status: 0, detalle: String(e).slice(0, 200) };
      }
    }
  }
  return { ok: false, formato: null, ...ultimo };
}

export async function verificarClave(restKey: string): Promise<{
  ok: boolean;
  formato: string | null;
  status: number;
  detalle: string;
}> {
  let ultimo = { status: 0, detalle: "sin respuesta" };
  for (const formato of AUTH_FORMATS) {
    try {
      const r = await fetch(
        `${ONESIGNAL_LIST}?app_id=${ONESIGNAL_APP_ID}&limit=1`,
        { headers: { "Authorization": `${formato} ${restKey}` } },
      );
      const body = await r.text();
      if (r.ok) {
        return { ok: true, formato, status: r.status, detalle: "clave válida" };
      }
      ultimo = { status: r.status, detalle: body.slice(0, 200) };
    } catch (e) {
      ultimo = { status: 0, detalle: String(e).slice(0, 200) };
    }
  }
  return { ok: false, formato: null, ...ultimo };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  /* --------------------------------------------------------- el portero
     Comparación de longitud primero para no comparar contra vacío por
     accidente si la variable no estuviera puesta. */
  const esperado = Deno.env.get("REMINDER_TOKEN") ?? "";
  const recibido = req.headers.get("x-reminder-token") ?? "";
  if (!esperado || recibido.length !== esperado.length || recibido !== esperado) {
    return json({ error: "No autorizado." }, 401);
  }

  if (!supabaseUrl() || !serviceKey()) {
    return json({ error: "La función no está bien configurada." }, 500);
  }

  /* .trim(): un salto de línea pegado al copiar la clave la invalida entera
     y el error de OneSignal («Access denied») no da ninguna pista. */
  const restKey = (Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "").trim();
  if (!restKey) {
    return json({ error: "Falta configurar ONESIGNAL_REST_API_KEY." }, 500);
  }

  const hoy = todayInBogota();

  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío es válido */ }

  const subs = await leerTabla<Suscripcion>("push_subscriptions", "user_id,subscription_id");

  /* --------------------------------------------------------- ensayo
     Con {"dryRun": true} se comprueba la clave y se dice a quién le
     tocaría, sin mandar ninguna notificación. */
  if (body.dryRun === true) {
    const respaldos = await leerTabla<Respaldo>("backups", "user_id,payload");
    const elegidos = destinatarios(subs, respaldos, hoy);
    return json({
      ensayo: true,
      hoy,
      clave: await verificarClave(restKey),
      formaDeLaClave: describirClave(restKey),
      envio: await probarEnvio(restKey),
      appIdConfigurado: ONESIGNAL_APP_ID,
      appIdDeLaClave: appIdDeLaClave(restKey),
      suscritos: subs.length,
      respaldos: respaldos.length,
      avisaria: elegidos.length,
      mensaje: messageFor(hoy),
    });
  }

  /* Nadie suscrito todavía no es un error: es que nadie activó los avisos. */
  if (!subs.length) {
    return json({ hoy, suscritos: 0, avisados: 0, motivo: "nadie activó los recordatorios" });
  }

  const respaldos = await leerTabla<Respaldo>("backups", "user_id,payload");
  const elegidos = destinatarios(subs, respaldos, hoy);

  if (!elegidos.length) {
    return json({
      hoy,
      suscritos: subs.length,
      avisados: 0,
      motivo: "hoy no le toca a nadie, o ya registraron",
    });
  }

  const mensaje = messageFor(hoy);
  const r = await enviar(elegidos.map((e) => e.subscription_id), mensaje, restKey);

  if (!r.ok) {
    console.error("onesignal", r.status, r.body.slice(0, 400));
    return json({
      error: "OneSignal rechazó el envío.",
      status: r.status,
      detalle: r.body.slice(0, 300),
      hoy,
      intentados: elegidos.length,
    }, 502);
  }

  return json({
    hoy,
    suscritos: subs.length,
    avisados: elegidos.length,
    titulo: mensaje.title,
    onesignal: JSON.parse(r.body || "{}"),
  });
}

if (import.meta.main) Deno.serve(handle);
