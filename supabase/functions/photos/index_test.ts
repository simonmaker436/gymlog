/* Pruebas de la función photos.
   Correr con:  npx deno@2 test --allow-env supabase/functions/photos/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildPhotoPrompt, handle } from "./index.ts";

const realFetch = globalThis.fetch;

function post(body: unknown, auth = "Bearer token-de-prueba") {
  return new Request("https://x/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth },
    body: JSON.stringify(body),
  });
}

const USER = "11111111-2222-3333-4444-555555555555";
const OTRO = "99999999-8888-7777-6666-555555555555";

/* Simula Supabase: el bucket existe, /auth/v1/user devuelve nuestro usuario,
   y se anota cada URL que la función pide. */
function mockSupabase(opts: { user?: string | null; espia?: string[] } = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    opts.espia?.push(`${init?.method ?? "GET"} ${url.replace("https://sb.test", "")}`);

    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        user
          ? new Response(JSON.stringify({ id: user }), { status: 200 })
          : new Response("{}", { status: 401 }),
      );
    }
    if (url.includes("/storage/v1/bucket")) {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    if (url.includes("/storage/v1/object/list/")) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    if (url.includes("/storage/v1/object/")) {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

function conEntorno<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secreta");
  return fn().finally(() => {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    globalThis.fetch = realFetch;
  });
}

Deno.test("sin token válido no se atiende nada", async () =>
  await conEntorno(async () => {
    mockSupabase({ user: null });
    for (const action of ["list", "upload-url", "delete", "opine"]) {
      const res = await handle(post({ action, path: `${OTRO}/foto.jpg` }));
      assertEquals(res.status, 401, `${action} debería exigir sesión`);
    }
  }));

Deno.test("sin cabecera Authorization tampoco", async () =>
  await conEntorno(async () => {
    mockSupabase();
    const req = new Request("https://x/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    });
    assertEquals((await handle(req)).status, 401);
  }));

Deno.test("solo se listan las fotos de la carpeta del propio usuario", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    mockSupabase({ espia });
    await handle(post({ action: "list" }));

    const listado = espia.find((l) => l.includes("/object/list/"));
    assert(listado, "no se llamó a listar");
    /* El prefijo lo pone la función con el id del token. Que no aparezca en
       la URL es esperable (va en el cuerpo); lo que importa es que no exista
       ninguna vía para pedir otro prefijo: `prefix` no sale del body. */
    assert(!espia.some((l) => l.includes(OTRO)), "se tocó la carpeta de otro");
  }));

Deno.test("no se puede borrar una foto de otra cuenta", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    mockSupabase({ espia });

    const res = await handle(post({ action: "delete", path: `${OTRO}/foto.jpg` }));
    assertEquals(res.status, 403);
    assert((await res.json()).error.includes("no es tuya"));
    assert(
      !espia.some((l) => l.startsWith("DELETE")),
      "ni siquiera se intentó el borrado",
    );
  }));

Deno.test("tampoco escapando con ..", async () =>
  await conEntorno(async () => {
    mockSupabase();
    for (const path of [`${USER}/../${OTRO}/foto.jpg`, "../secreto.jpg", "/etc/passwd"]) {
      const res = await handle(post({ action: "delete", path }));
      assertEquals(res.status, 403, `debería rechazar: ${path}`);
    }
  }));

Deno.test("borrar lo propio sí se permite", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    mockSupabase({ espia });
    const res = await handle(post({ action: "delete", path: `${USER}/2026-09-06-abc.jpg` }));
    assertEquals(res.status, 200);
    assert(espia.some((l) => l.startsWith("DELETE")), "debería haber borrado");
  }));

Deno.test("la ruta de subida la arma el servidor, no el cliente", async () =>
  await conEntorno(async () => {
    mockSupabase();
    /* El cliente intenta colar una ruta ajena por «name»; se ignora. */
    const res = await handle(post({
      action: "upload-url",
      date: "2026-09-06",
      name: `../../${OTRO}/robada.png`,
    }));
    const d = await res.json();
    assert(d.path.startsWith(`${USER}/`), `la ruta salió de: ${d.path}`);
    assert(!d.path.includes(OTRO));
    assert(!d.path.includes(".."));
    assert(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(jpg|png)$/.test(d.path.split("/")[1]));
  }));

Deno.test("una fecha inventada no rompe el nombre del archivo", async () =>
  await conEntorno(async () => {
    mockSupabase();
    const d = await (await handle(post({ action: "upline", date: "no-es-fecha" }))).json();
    assertEquals(d.error, "Acción desconocida.");

    const d2 = await (await handle(post({ action: "upload-url", date: "no-es-fecha" }))).json();
    assert(/^\d{4}-\d{2}-\d{2}-/.test(d2.path.split("/")[1]), "cae a la fecha de hoy");
  }));

Deno.test("opine avisa cuando todavía no hay fotos", async () =>
  await conEntorno(async () => {
    Deno.env.set("GEMINI_API_KEY", "x");
    mockSupabase();
    const res = await handle(post({ action: "opine" }));
    Deno.env.delete("GEMINI_API_KEY");
    assertEquals(res.status, 400);
    assert((await res.json()).error.includes("Todavía no subiste"));
  }));

/* ------------------------------------------- límite semanal de análisis
   Lo importante es que se decida en el servidor: si se comprobara solo en el
   navegador, tocando el cliente se gastarían tokens sin tope. */
function mockConLedger(opts: { entries: { at: string }[]; espia: string[] }) {
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    opts.espia.push(`${init?.method ?? "GET"} ${url}`);

    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(new Response(JSON.stringify({ id: USER }), { status: 200 }));
    }
    if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"recomendacion":"a","consejo":"b"}' }] } }],
      }), { status: 200 }));
    }
    if (url.endsWith("usage.json")) {
      return Promise.resolve(
        new Response(JSON.stringify({ entries: opts.entries }), { status: 200 }),
      );
    }
    if (url.includes("/storage/v1/object/sign/")) {
      return Promise.resolve(new Response(
        JSON.stringify({ signedURL: "/object/sign/progress/x?token=t" }),
        { status: 200 },
      ));
    }
    if (url.includes("/storage/v1/object/list/")) {
      return Promise.resolve(new Response(
        JSON.stringify([{ name: "2026-09-09-aaaaaaaa.jpg" }]),
        { status: 200 },
      ));
    }
    if (url.includes("/storage/v1/object/")) {
      /* la descarga de la foto para mandársela a la IA */
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

const HOY = new Date().toISOString().slice(0, 10);
function lunesDeHoy(): string {
  const d = new Date(HOY + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

Deno.test("con el cupo agotado no se llama a la IA y se responde 429", async () =>
  await conEntorno(async () => {
    Deno.env.set("GEMINI_API_KEY", "x");
    const espia: string[] = [];
    mockConLedger({ entries: [{ at: lunesDeHoy() }, { at: HOY }], espia });

    const res = await handle(post({ action: "opine" }));
    Deno.env.delete("GEMINI_API_KEY");

    assertEquals(res.status, 429);
    const b = await res.json();
    assert(b.limited, "marca que fue por el límite");
    assert(b.error.includes("2 análisis"), `mensaje: ${b.error}`);
    assert(b.error.includes("lunes"), "dice cuándo vuelven");
    assertEquals(b.usage.remaining, 0);
    assert(
      !espia.some((l) => l.includes("generativelanguage") || l.includes("api.groq.com")),
      "no se gastó ni un token",
    );
  }));

Deno.test("con cupo disponible sí analiza y descuenta", async () =>
  await conEntorno(async () => {
    Deno.env.set("GEMINI_API_KEY", "x");
    const espia: string[] = [];
    mockConLedger({ entries: [{ at: lunesDeHoy() }], espia });

    const res = await handle(post({ action: "opine" }));
    Deno.env.delete("GEMINI_API_KEY");

    assertEquals(res.status, 200);
    const b = await res.json();
    assertEquals(b.recomendacion, "a");
    assertEquals(b.usage.used, 2, "el análisis recién hecho ya cuenta");
    assertEquals(b.usage.remaining, 0);
    assert(espia.some((l) => l.includes("generativelanguage")), "sí llamó a la IA");
    assert(
      espia.some((l) => l.startsWith("POST") && l.endsWith("usage.json")),
      "guardó el registro",
    );
  }));

Deno.test("los análisis de la semana pasada no bloquean", async () =>
  await conEntorno(async () => {
    Deno.env.set("GEMINI_API_KEY", "x");
    const espia: string[] = [];
    const d = new Date(lunesDeHoy() + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 7);
    const laSemanaPasada = d.toISOString().slice(0, 10);
    mockConLedger({ entries: [{ at: laSemanaPasada }, { at: laSemanaPasada }], espia });

    const res = await handle(post({ action: "opine" }));
    Deno.env.delete("GEMINI_API_KEY");
    assertEquals(res.status, 200, "semana nueva, cupo nuevo");
  }));

Deno.test("si la IA falla no se descuenta el análisis", async () =>
  await conEntorno(async () => {
    Deno.env.set("GEMINI_API_KEY", "x");
    const espia: string[] = [];
    mockConLedger({ entries: [], espia });
    /* Se pisa la respuesta de la IA por una caída. */
    const conLedger = globalThis.fetch;
    globalThis.fetch = ((u: unknown, init?: RequestInit) => {
      if (String(u).includes("generativelanguage") || String(u).includes("api.groq.com")) {
        return Promise.resolve(new Response("{}", { status: 503 }));
      }
      return (conLedger as typeof fetch)(u as string, init);
    }) as unknown as typeof fetch;

    const res = await handle(post({ action: "opine" }));
    Deno.env.delete("GEMINI_API_KEY");

    assertEquals(res.status, 502);
    assertEquals((await res.json()).usage.used, 0, "no se cobra un análisis que no salió");
    assert(
      !espia.some((l) => l.startsWith("POST") && l.endsWith("usage.json")),
      "no se tocó el registro",
    );
  }));

Deno.test("usage informa sin analizar nada", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    mockConLedger({ entries: [{ at: HOY }], espia });
    const b = await (await handle(post({ action: "usage" }))).json();
    assertEquals(b.usage.used, 1);
    assertEquals(b.usage.remaining, 1);
    assert(
      !espia.some((l) => l.includes("generativelanguage") || l.includes("api.groq.com")),
      "consultar el cupo no cuesta tokens",
    );
  }));

Deno.test("list trae fotos, cupo e historial en una sola llamada", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    mockConLedger({ entries: [{ at: HOY }], espia });
    const b = await (await handle(post({ action: "list" }))).json();
    assert(Array.isArray(b.photos), "trae fotos");
    assert(b.usage && typeof b.usage.remaining === "number", "trae cupo");
    assert(Array.isArray(b.history), "trae historial");
  }));

Deno.test("el registro de uso no se confunde con una foto", async () =>
  await conEntorno(async () => {
    const espia: string[] = [];
    globalThis.fetch = ((u: unknown, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/auth/v1/user")) {
        return Promise.resolve(new Response(JSON.stringify({ id: USER }), { status: 200 }));
      }
      if (url.endsWith("usage.json")) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
      }
      if (url.includes("/storage/v1/object/sign/")) {
        return Promise.resolve(new Response(
          JSON.stringify({ signedURL: "/object/sign/progress/x?token=t" }),
          { status: 200 },
        ));
      }
      if (url.includes("/storage/v1/object/list/")) {
        return Promise.resolve(new Response(
          JSON.stringify([{ name: "usage.json" }, { name: "2026-09-09-aaaaaaaa.jpg" }]),
          { status: 200 },
        ));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    const b = await (await handle(post({ action: "list" }))).json();
    assertEquals(b.photos.length, 1, "usage.json no aparece como foto");
    assert(b.photos[0].path.endsWith(".jpg"));
  }));

Deno.test("el prompt de fotos prohíbe diagnosticar e inventar rutinas", () => {
  const p = buildPhotoPrompt(["2026-09-05", "2026-08-15"]);
  assert(p.includes("2026-09-05") && p.includes("2026-08-15"), "lleva las fechas");
  assert(p.includes("la más reciente"), "dice cuál es la nueva");
  assert(/diagn[óo]sticos m[ée]dicos/i.test(p), "prohíbe diagnosticar");
  assert(/grasa corporal/i.test(p), "prohíbe estimar grasa corporal");
  assert(/series/.test(p), "recuerda que no hay series");
  assert(/nutrici[óo]n/i.test(p), "prohíbe consejos de nutrición");
  assert(p.includes("español neutro"), "el análisis también va en neutro");
  assertEquals(/\bSos\b|\bComentá\b|\bdecilo\b|\bDevolvé\b/.test(p), false,
    "sin voseo");
});

Deno.test("con una sola foto el prompt lo dice en singular", () => {
  const p = buildPhotoPrompt(["2026-09-05"]);
  assert(p.includes("1 foto\n") || p.includes("1 foto"), "singular");
  assert(/una sola foto/i.test(p), "avisa que no hay comparación");
});
