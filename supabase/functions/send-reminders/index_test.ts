/* Pruebas de la función send-reminders.
   Correr con:  npx deno@2 test --allow-env supabase/functions/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { debeAvisarse, destinatarios, handle, Respaldo } from "./index.ts";
import {
  MESSAGES,
  messageFor,
  SEND_HOUR_BOGOTA,
  todayInBogota,
  weekdayInBogota,
} from "../_shared/reminderText.ts";

const realFetch = globalThis.fetch;
const TOKEN = "token-secreto-del-cron";

function post(token: string | null = TOKEN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-reminder-token"] = token;
  return new Request("https://x/send-reminders", { method: "POST", headers, body: "{}" });
}

interface Llamada { url: string; body: Record<string, unknown> }

function mock(opts: {
  subs?: unknown[];
  backups?: unknown[];
  oneSignalStatus?: number;
  llamadas?: Llamada[];
} = {}) {
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* no era JSON */ }
    opts.llamadas?.push({ url, body });

    if (url.includes("/rest/v1/push_subscriptions")) {
      return Promise.resolve(new Response(JSON.stringify(opts.subs ?? []), { status: 200 }));
    }
    if (url.includes("/rest/v1/backups")) {
      return Promise.resolve(new Response(JSON.stringify(opts.backups ?? []), { status: 200 }));
    }
    if (url.includes("onesignal.com")) {
      return Promise.resolve(new Response(JSON.stringify({ id: "notif-1", recipients: 1 }), {
        status: opts.oneSignalStatus ?? 200,
      }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

function conEntorno<T>(fn: () => Promise<T>, opts: { token?: boolean; oneSignal?: boolean } = {}) {
  if (opts.token === false) Deno.env.delete("REMINDER_TOKEN");
  else Deno.env.set("REMINDER_TOKEN", TOKEN);
  if (opts.oneSignal === false) Deno.env.delete("ONESIGNAL_REST_API_KEY");
  else Deno.env.set("ONESIGNAL_REST_API_KEY", "clave-rest-de-prueba");
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secreta");
  return fn().finally(() => {
    for (const k of ["REMINDER_TOKEN", "ONESIGNAL_REST_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      Deno.env.delete(k);
    }
    globalThis.fetch = realFetch;
  });
}

/* 2026-09-09 es miércoles → getUTCDay() = 3 */
const HOY = "2026-09-09";
const respaldo = (userId: string, gymDays: number[], fechas: string[] = [], extra = {}): Respaldo => ({
  user_id: userId,
  payload: {
    settings: { gymDays, ...extra },
    workouts: fechas.map((d) => ({ date: d, went: true })),
  },
});

/* ------------------------------------------------------- el portero */

Deno.test("sin el token del cron no manda nada", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({ subs: [{ user_id: "u1", subscription_id: "s1" }], llamadas });
    const res = await handle(post("token-equivocado"));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "No autorizado.");
    assertEquals(
      llamadas.some((l) => l.url.includes("onesignal")),
      false,
      "nadie con la URL puede gastar la cuota de OneSignal",
    );
  }));

Deno.test("sin cabecera tampoco", async () =>
  await conEntorno(async () => {
    mock();
    assertEquals((await handle(post(null))).status, 401);
  }));

/* Si REMINDER_TOKEN no estuviera puesto, una petición sin cabecera mandaría
   "" contra "" y entraría. */
Deno.test("con el secreto sin configurar no entra nadie", async () =>
  await conEntorno(async () => {
    mock();
    assertEquals((await handle(post(null))).status, 401);
    assertEquals((await handle(post(""))).status, 401);
  }, { token: false }));

Deno.test("GET no sirve para dispararla", async () => {
  const res = await handle(new Request("https://x/send-reminders", { method: "GET" }));
  assertEquals(res.status, 405);
});

/* ------------------------------------------------------ a quién avisar */

Deno.test("avisa si hoy toca y no registró nada", () => {
  assertEquals(debeAvisarse(respaldo("u1", [3]), HOY), true, "miércoles programado y vacío");
});

Deno.test("no avisa si ya registró hoy", () => {
  assertEquals(debeAvisarse(respaldo("u1", [3], [HOY]), HOY), false);
});

Deno.test("no avisa si hoy no es día programado", () => {
  assertEquals(debeAvisarse(respaldo("u1", [1, 5]), HOY), false, "lunes y viernes, hoy miércoles");
});

Deno.test("respeta el interruptor de recordatorios de la app", () => {
  assertEquals(debeAvisarse(respaldo("u1", [3], [], { reminders: false }), HOY), false);
  assertEquals(debeAvisarse(respaldo("u1", [3], [], { reminders: true }), HOY), true);
});

Deno.test("una sesión de otro día no cuenta como registrada hoy", () => {
  assertEquals(debeAvisarse(respaldo("u1", [3], ["2026-09-08"]), HOY), true);
});

Deno.test("sin respaldo todavía no se le escribe", () => {
  assertEquals(debeAvisarse(undefined, HOY), false);
  assertEquals(debeAvisarse({ user_id: "u1", payload: null }, HOY), false);
});

/* Lo que pidió el enunciado: quien no activó los avisos se salta sin ruido. */
Deno.test("a quien no tiene suscripción se lo salta sin error", () => {
  const subs = [
    { user_id: "u1", subscription_id: "s1" },
    { user_id: "u2", subscription_id: "" },
  ];
  const backups = [respaldo("u1", [3]), respaldo("u2", [3]), respaldo("u3", [3])];
  const out = destinatarios(subs, backups, HOY);
  assertEquals(out.map((o) => o.user_id), ["u1"], "u2 sin id y u3 sin suscripción");
});

/* ------------------------------------------------------------ envío */

Deno.test("manda una sola llamada con todos los ids", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({
      subs: [
        { user_id: "u1", subscription_id: "s1" },
        { user_id: "u2", subscription_id: "s2" },
      ],
      backups: [respaldo("u1", [0, 1, 2, 3, 4, 5, 6]), respaldo("u2", [0, 1, 2, 3, 4, 5, 6])],
      llamadas,
    });
    const res = await handle(post());
    assertEquals(res.status, 200);
    const d = await res.json();
    assertEquals(d.avisados, 2);

    const envios = llamadas.filter((l) => l.url.includes("onesignal"));
    assertEquals(envios.length, 1, "una sola solicitud, no una por persona");
    assertEquals(envios[0].body.include_subscription_ids, ["s1", "s2"]);
    assertEquals(envios[0].body.app_id, "6f77941f-f54d-4483-bc7d-60603cfe06a5");
  }));

Deno.test("si hoy no le toca a nadie, no llama a OneSignal", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({
      subs: [{ user_id: "u1", subscription_id: "s1" }],
      backups: [respaldo("u1", [3], [todayInBogota()])],   // ya registró hoy
      llamadas,
    });
    const d = await (await handle(post())).json();
    assertEquals(d.avisados, 0);
    assertEquals(llamadas.some((l) => l.url.includes("onesignal")), false);
  }));

Deno.test("sin nadie suscrito responde 200 y no falla", async () =>
  await conEntorno(async () => {
    mock({ subs: [] });
    const res = await handle(post());
    assertEquals(res.status, 200);
    const d = await res.json();
    assertEquals(d.suscritos, 0);
    assertEquals(d.avisados, 0);
  }));

Deno.test("un fallo de OneSignal se reporta con su detalle", async () =>
  await conEntorno(async () => {
    mock({
      subs: [{ user_id: "u1", subscription_id: "s1" }],
      backups: [respaldo("u1", [0, 1, 2, 3, 4, 5, 6])],
      oneSignalStatus: 400,
    });
    const res = await handle(post());
    assertEquals(res.status, 502);
    const d = await res.json();
    assertEquals(d.status, 400);
    assert(d.error.includes("OneSignal"));
  }));

Deno.test("sin ONESIGNAL_REST_API_KEY lo dice claro", async () =>
  await conEntorno(async () => {
    mock();
    const res = await handle(post());
    assertEquals(res.status, 500);
    assert((await res.json()).error.includes("ONESIGNAL_REST_API_KEY"));
  }, { oneSignal: false }));

Deno.test("la clave REST nunca sale en la respuesta", async () =>
  await conEntorno(async () => {
    mock({
      subs: [{ user_id: "u1", subscription_id: "s1" }],
      backups: [respaldo("u1", [0, 1, 2, 3, 4, 5, 6])],
    });
    const t = await (await handle(post())).text();
    assertEquals(t.includes("clave-rest-de-prueba"), false);
  }));

/* ------------------------------------------------------- fecha y texto */

/* El servidor corre en UTC. A las 00:00 UTC en Bogotá todavía es ayer: sin
   corregirlo, el aviso de las 19:00 miraría el día equivocado. */
Deno.test("la fecha se calcula en hora de Bogotá, no en UTC", () => {
  // 2026-09-10 02:00 UTC = 2026-09-09 21:00 en Bogotá
  assertEquals(todayInBogota(new Date("2026-09-10T02:00:00Z")), "2026-09-09");
  // 2026-09-09 23:00 UTC = 2026-09-09 18:00 en Bogotá
  assertEquals(todayInBogota(new Date("2026-09-09T23:00:00Z")), "2026-09-09");
});

Deno.test("el día de la semana usa el mismo criterio que gymDays", () => {
  assertEquals(weekdayInBogota("2026-09-09"), 3, "miércoles");
  assertEquals(weekdayInBogota("2026-09-13"), 0, "domingo es 0, como en store.js");
});

Deno.test("el mensaje rota y siempre trae título y cuerpo", () => {
  const vistos = new Set<string>();
  for (let i = 1; i <= 20; i++) {
    const iso = `2026-01-${String(i).padStart(2, "0")}`;
    const m = messageFor(iso);
    assert(m.title && m.body, `mensaje vacío en ${iso}`);
    vistos.add(m.title);
  }
  assertEquals(vistos.size, MESSAGES.length, "recorre todos los mensajes");
});

Deno.test("la hora de envío está declarada en una constante", () => {
  assert(SEND_HOUR_BOGOTA >= 12 && SEND_HOUR_BOGOTA <= 22, "una hora de tarde/noche");
});
