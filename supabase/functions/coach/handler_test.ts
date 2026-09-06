/* Pruebas del handler completo, con la API de Gemini simulada.
   Correr con:  npx deno@2 test --allow-env supabase/functions/coach/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handle } from "./index.ts";

const realFetch = globalThis.fetch;

function mockGemini(status: number, body: unknown) {
  globalThis.fetch = ((..._a: unknown[]) =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    )) as typeof fetch;
}

function geminiOk(recomendacion: string, consejo: string) {
  return {
    candidates: [{
      content: { parts: [{ text: JSON.stringify({ recomendacion, consejo }) }] },
    }],
  };
}

function post(body: unknown) {
  return new Request("https://x/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return fn().finally(() => {
    Deno.env.delete("GEMINI_API_KEY");
    globalThis.fetch = realFetch;
  });
}

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
  const res = await handle(post({ workouts: SESIONES }));
  assertEquals(res.status, 500);
  assert((await res.json()).error.includes("GEMINI_API_KEY"));
});

Deno.test("con menos de 3 sesiones no llama a la IA", async () =>
  await conClave(async () => {
    let llamadas = 0;
    globalThis.fetch = (() => {
      llamadas++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    const res = await handle(post({ workouts: SESIONES.slice(0, 2) }));
    assertEquals(res.status, 400);
    assertEquals(llamadas, 0, "no se gasta cuota con datos insuficientes");
  }));

Deno.test("cuerpo que no es JSON devuelve 400", async () =>
  await conClave(async () => {
    const req = new Request("https://x/coach", { method: "POST", body: "{roto" });
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
    globalThis.fetch = (() => Promise.reject(new Error("sin red"))) as typeof fetch;
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("No se pudo contactar"));
  }));

Deno.test("respuesta ininteligible del modelo no rompe", async () =>
  await conClave(async () => {
    mockGemini(200, { candidates: [{ content: { parts: [{ text: "puro texto" }] } }] });
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("no se pudo leer"));
  }));

Deno.test("el prompt que sale lleva los días reales", async () =>
  await conClave(async () => {
    let enviado = "";
    globalThis.fetch = ((_u: unknown, init: RequestInit) => {
      enviado = String(init.body);
      return Promise.resolve(new Response(JSON.stringify(geminiOk("a", "b")), { status: 200 }));
    }) as unknown as typeof fetch;

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
