/* Pruebas del handler completo, con la API de Gemini simulada.
   Correr con:  npx deno@2 test --allow-env supabase/functions/coach/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { GEMINI_MODEL, handle } from "./index.ts";

const realFetch = globalThis.fetch;
const USER = "11111111-2222-3333-4444-555555555555";

/* La función valida el token contra /auth/v1/user antes de tocar la IA, así
   que el simulador tiene que enrutar por URL: la sesión por un lado y Gemini
   por otro. `sinSesion` hace que el token no valga. */
function mockGemini(status: number, body: unknown, opts: { sinSesion?: boolean } = {}) {
  globalThis.fetch = ((u: unknown) => {
    if (String(u).includes("/auth/v1/user")) {
      return Promise.resolve(
        opts.sinSesion
          ? new Response("{}", { status: 401 })
          : new Response(JSON.stringify({ id: USER }), { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
  }) as unknown as typeof fetch;
}

function geminiOk(recomendacion: string, consejo: string) {
  return {
    candidates: [{
      content: { parts: [{ text: JSON.stringify({ recomendacion, consejo }) }] },
    }],
  };
}

/* Envuelve un simulador propio para que la validación de sesión siga
   contestando: la función la consulta antes que nada, y si no, todas estas
   pruebas se quedarían en el 401. */
function conSesionOk(handler: (u: unknown, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    if (String(u).includes("/auth/v1/user")) {
      return Promise.resolve(new Response(JSON.stringify({ id: USER }), { status: 200 }));
    }
    return handler(u, init);
  }) as unknown as typeof fetch;
}

/* Las llamadas que cuestan dinero, que son las que interesa contar. */
const esIA = (u: unknown) =>
  String(u).includes("generativelanguage") || String(u).includes("api.groq.com");

function post(body: unknown, auth: string | null = "Bearer token-de-prueba") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  return new Request("https://x/coach", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const SESIONES = [
  { date: "2026-09-05", type: "empuje", energy: 4, feeling: 4, difficulty: 3, notes: "bien" },
  { date: "2026-09-03", type: "empuje", energy: 3, feeling: 4, difficulty: 3, notes: "" },
  { date: "2026-08-10", type: "pierna", energy: 2, feeling: 2, difficulty: 4, notes: "cansado" },
];

function conClave<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("GEMINI_API_KEY", "clave-de-prueba");
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secreta");
  return fn().finally(() => {
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    globalThis.fetch = realFetch;
  });
}

/* ------------------------------------------------------------ sesión
   Los datos van en la petición, así que acá no hay nada de otra cuenta que
   filtrar; lo que se protege es la cuota de IA del proyecto, que si no
   podría gastar cualquiera con la clave pública. */

Deno.test("sin token válido responde 401 y no llama a la IA", async () =>
  await conClave(async () => {
    const pedidas: string[] = [];
    mockGemini(200, geminiOk("x", "y"), { sinSesion: true });
    const base = globalThis.fetch;
    globalThis.fetch = ((u: unknown, i?: RequestInit) => {
      pedidas.push(String(u));
      return (base as typeof fetch)(u as string, i);
    }) as unknown as typeof fetch;

    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Necesitás iniciar sesión.");
    assertEquals(
      pedidas.some((u) => u.includes("generativelanguage") || u.includes("groq")),
      false,
      "un anónimo no puede gastar la cuota de IA",
    );
  }));

Deno.test("sin cabecera Authorization tampoco", async () =>
  await conClave(async () => {
    mockGemini(200, geminiOk("x", "y"));
    const res = await handle(post({ workouts: SESIONES }, null));
    assertEquals(res.status, 401);
  }));

/* El 401 llega antes que cualquier otra validación: si no, un anónimo
   podría deducir cosas por el mensaje de error que recibe. */
Deno.test("la sesión se comprueba antes que el cuerpo y las claves", async () => {
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GROQ_API_KEY");
  mockGemini(200, {}, { sinSesion: true });
  try {
    // sin claves de IA, con menos de 3 sesiones y sin JSON válido: igual 401
    assertEquals((await handle(post({ workouts: [] }))).status, 401);
    const roto = new Request("https://x/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer x" },
      body: "no es json",
    });
    assertEquals((await handle(roto)).status, 401);
  } finally {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    globalThis.fetch = realFetch;
  }
});

Deno.test("OPTIONS responde el preflight con CORS", async () => {
  const res = await handle(new Request("https://x/coach", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("GET no está permitido", async () => {
  const res = await handle(new Request("https://x/coach"));
  assertEquals(res.status, 405);
});

Deno.test("sin GEMINI_API_KEY avisa en vez de reventar", async () => {
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GROQ_API_KEY");
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
  conSesionOk(() => Promise.resolve(new Response("{}", { status: 200 })));
  try {
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 500);
    assert((await res.json()).error.includes("GEMINI_API_KEY"));
  } finally {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    globalThis.fetch = realFetch;
  }
});

Deno.test("con menos de 3 sesiones no llama a la IA", async () =>
  await conClave(async () => {
    let llamadasIA = 0;
    conSesionOk((u) => {
      if (esIA(u)) llamadasIA++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const res = await handle(post({ workouts: SESIONES.slice(0, 2) }));
    assertEquals(res.status, 400);
    assertEquals(llamadasIA, 0, "no se gasta cuota con datos insuficientes");
  }));

Deno.test("cuerpo que no es JSON devuelve 400", async () =>
  await conClave(async () => {
    conSesionOk(() => Promise.resolve(new Response("{}", { status: 200 })));
    const req = new Request("https://x/coach", {
      method: "POST",
      headers: { "Authorization": "Bearer token-de-prueba" },
      body: "{roto",
    });
    assertEquals((await handle(req)).status, 400);
  }));

Deno.test("camino feliz devuelve recomendacion y consejo", async () =>
  await conClave(async () => {
    mockGemini(200, geminiOk("Hoy toca pierna.", "Tu energía viene subiendo."));
    const res = await handle(post({ workouts: SESIONES, today: "2026-09-06" }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.recomendacion, "Hoy toca pierna.");
    assertEquals(body.consejo, "Tu energía viene subiendo.");
    assert(body.generatedAt, "trae marca de tiempo");
  }));

Deno.test("la clave nunca sale en la respuesta", async () =>
  await conClave(async () => {
    mockGemini(200, geminiOk("a", "b"));
    const res = await handle(post({ workouts: SESIONES }));
    assert(!(await res.text()).includes("clave-de-prueba"));
  }));

Deno.test("límite de cuota se traduce a un mensaje entendible", async () =>
  await conClave(async () => {
    mockGemini(429, { error: { status: "RESOURCE_EXHAUSTED" } });
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("cuota gratis"));
  }));

Deno.test("clave inválida se explica sin tecnicismos", async () =>
  await conClave(async () => {
    mockGemini(400, { error: { details: [{ reason: "API_KEY_INVALID" }] } });
    assert((await (await handle(post({ workouts: SESIONES }))).json()).error.includes("GEMINI_API_KEY"));
  }));

Deno.test("si la red falla no se rompe", async () =>
  await conClave(async () => {
    /* La sesión sí se valida; lo que se cae es la llamada a la IA. */
    conSesionOk(() => Promise.reject(new Error("sin red")));
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("No se pudo contactar"));
  }));

/* Pasó de verdad con gemini-3.6-flash: el modelo gasta el presupuesto
   razonando y devuelve 200 con el JSON cortado a mitad de frase. */
Deno.test("una respuesta cortada por falta de tokens se explica sola", async () =>
  await conClave(async () => {
    mockGemini(200, {
      candidates: [{
        finishReason: "MAX_TOKENS",
        content: {
          parts: [{
            text: '{"recomendacion":"Venís bien con Empuje, pero hace 16 días que no',
            thoughtSignature: "EsEfCr4fARFNMg8...",
          }],
        },
      }],
    });
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert(
      (await res.json()).error.includes("maxOutputTokens"),
      "el mensaje tiene que decir qué tocar",
    );
  }));

Deno.test("pide margen de sobra para que el modelo pueda razonar", async () =>
  await conClave(async () => {
    let enviado = "";
    conSesionOk((_u, init) => {
      enviado = String(init?.body);
      return Promise.resolve(new Response(JSON.stringify(geminiOk("a", "b")), { status: 200 }));
    });

    await handle(post({ workouts: SESIONES }));
    const tope = JSON.parse(enviado).generationConfig.maxOutputTokens;
    assert(tope >= 4000, `maxOutputTokens quedó corto: ${tope}`);
  }));

Deno.test("respuesta ininteligible del modelo no rompe", async () =>
  await conClave(async () => {
    mockGemini(200, { candidates: [{ content: { parts: [{ text: "puro texto" }] } }] });
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("no se pudo leer"));
  }));

/* Google retiró gemini-2.0-flash sin aviso y la función quedó devolviendo
   404. Esta prueba fija cuál es el modelo vigente y comprueba que es el que
   se pide de verdad, para que un cambio a medias se note acá y no en
   producción. */
Deno.test("apunta al modelo vigente, con la clave en la query y no en el cuerpo", async () =>
  await conClave(async () => {
    let url = "";
    conSesionOk((u) => {
      url = String(u);
      return Promise.resolve(new Response(JSON.stringify(geminiOk("a", "b")), { status: 200 }));
    });

    await handle(post({ workouts: SESIONES }));
    assertEquals(GEMINI_MODEL, "gemini-3.6-flash");
    assert(url.includes(`/models/${GEMINI_MODEL}:generateContent`), `URL inesperada: ${url}`);
    for (const viejo of ["gemini-2.0-flash", "gemini-2.5-flash"]) {
      assert(!url.includes(viejo), `no debe quedar rastro de ${viejo}`);
    }
    assert(url.includes("key=clave-de-prueba"), "la clave va en la query de Google");
  }));

Deno.test("el prompt que sale lleva los días reales", async () =>
  await conClave(async () => {
    let enviado = "";
    conSesionOk((_u, init) => {
      enviado = String(init?.body);
      return Promise.resolve(new Response(JSON.stringify(geminiOk("a", "b")), { status: 200 }));
    });

    await handle(post({ workouts: SESIONES, today: "2026-09-06" }));
    const cuerpo = JSON.parse(enviado);
    const texto = cuerpo.contents[0].parts[0].text;

    assert(texto.includes("Pierna: 1 sesi"), "manda el conteo por tipo");
    assert(texto.includes("27 d"), "manda los 27 días desde pierna");
    assert(!texto.includes("responseSchema"), "el esquema no se cuela en el prompt");
    assertEquals(
      cuerpo.generationConfig.responseSchema.required,
      ["recomendacion", "consejo"],
      "el esquema viaja en generationConfig, que es donde Gemini lo espera",
    );
    assertEquals(cuerpo.generationConfig.responseMimeType, "application/json");
  }));
