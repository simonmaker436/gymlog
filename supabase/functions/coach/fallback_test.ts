/* Pruebas del respaldo: Gemini falla → Groq contesta, con el mismo contexto.
   Correr con:  npx deno@2 test --allow-env supabase/functions/coach/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { GROQ_MODEL, handle } from "./index.ts";

const realFetch = globalThis.fetch;

const SESIONES = [
  { date: "2026-09-04", type: "empuje", energy: 2, feeling: 3, difficulty: 4, notes: "dormi mal" },
  { date: "2026-09-02", type: "empuje", energy: 4, feeling: 5, difficulty: 2, notes: "" },
  { date: "2026-08-24", type: "pierna", energy: 4, feeling: 4, difficulty: 3, notes: "fundido" },
];

function post(body: unknown) {
  return new Request("https://x/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function esGemini(u: unknown) { return String(u).includes("generativelanguage"); }
function esGroq(u: unknown) { return String(u).includes("api.groq.com"); }

function groqOk(recomendacion: string, consejo: string) {
  return {
    choices: [{ message: { content: JSON.stringify({ recomendacion, consejo }) } }],
  };
}

/* Enruta cada llamada según a quién vaya, y guarda lo que se envió. */
function ruta(
  gemini: () => Response,
  groq: () => Response,
  espia?: { gemini?: string; groq?: string; auth?: string | null },
) {
  globalThis.fetch = ((u: unknown, init: RequestInit) => {
    if (esGemini(u)) {
      if (espia) espia.gemini = String(init?.body ?? "");
      return Promise.resolve(gemini());
    }
    if (esGroq(u)) {
      if (espia) {
        espia.groq = String(init?.body ?? "");
        espia.auth = new Headers(init?.headers).get("Authorization");
      }
      return Promise.resolve(groq());
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

function conClaves<T>(fn: () => Promise<T>, opts?: { gemini?: boolean; groq?: boolean }) {
  const g = opts?.gemini ?? true, q = opts?.groq ?? true;
  if (g) Deno.env.set("GEMINI_API_KEY", "clave-gemini"); else Deno.env.delete("GEMINI_API_KEY");
  if (q) Deno.env.set("GROQ_API_KEY", "clave-groq"); else Deno.env.delete("GROQ_API_KEY");
  return fn().finally(() => {
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("GROQ_API_KEY");
    globalThis.fetch = realFetch;
  });
}

const R429 = () =>
  new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 });

Deno.test("cuota de Gemini agotada: contesta Groq y el usuario no ve error", async () =>
  await conClaves(async () => {
    ruta(R429, () => new Response(JSON.stringify(groqOk("Hoy pierna.", "Dormí mejor.")), { status: 200 }));

    const res = await handle(post({ workouts: SESIONES, today: "2026-09-06" }));
    assertEquals(res.status, 200);
    const b = await res.json();
    assertEquals(b.recomendacion, "Hoy pierna.");
    assertEquals(b.consejo, "Dormí mejor.");
    assertEquals(b.provider, "groq");
    assertEquals(b.error, undefined, "no se filtra ningún error al cliente");
  }));

Deno.test("Groq recibe EXACTAMENTE el mismo contexto que Gemini", async () =>
  await conClaves(async () => {
    const espia: { gemini?: string; groq?: string; auth?: string | null } = {};
    ruta(R429, () => new Response(JSON.stringify(groqOk("a", "b")), { status: 200 }), espia);

    await handle(post({ workouts: SESIONES, today: "2026-09-06" }));

    const aGemini = JSON.parse(espia.gemini!).contents[0].parts[0].text as string;
    const aGroq = JSON.parse(espia.groq!).messages[0].content as string;

    /* El de Groq es el mismo, más las instrucciones de formato al final. */
    assert(aGroq.startsWith(aGemini), "Groq no recibió el mismo contexto base");

    /* Los hechos calculados tienen que estar en los dos. Se comparan con los
       saltos de línea colapsados: el prompt va justificado a 78 columnas y una
       frase puede partirse en dos líneas. */
    const plano = (t: string) => t.replace(/\s+/g, " ");
    for (const hecho of [
      "Pierna: 1 sesión, última hace 13 días",
      "Empuje: 2 sesiones, última hace 2 días",
      "NO registra ejercicios, series, repeticiones ni pesos",
      "dormi mal",
    ]) {
      assert(plano(aGemini).includes(hecho), `falta en Gemini: ${hecho}`);
      assert(plano(aGroq).includes(hecho), `falta en Groq: ${hecho}`);
    }

    // y lo único que se le suma a Groq es cómo devolver el JSON
    const extra = aGroq.slice(aGemini.length);
    assert(extra.includes("recomendacion") && extra.includes("consejo"));
    assert(extra.length < 400, "el añadido de formato no debería ser un prompt aparte");
  }));

Deno.test("Groq se llama con el modelo, la clave y el modo JSON correctos", async () =>
  await conClaves(async () => {
    const espia: { groq?: string; auth?: string | null } = {};
    ruta(R429, () => new Response(JSON.stringify(groqOk("a", "b")), { status: 200 }), espia);

    await handle(post({ workouts: SESIONES }));
    const cuerpo = JSON.parse(espia.groq!);
    assertEquals(cuerpo.model, GROQ_MODEL);
    assertEquals(cuerpo.response_format, { type: "json_object" });
    assertEquals(espia.auth, "Bearer clave-groq");

    /* Groq rechaza con 400 si se pide response_format json_object y el
       mensaje no menciona la palabra «json». Pasó de verdad al probar. */
    assert(
      /json/i.test(cuerpo.messages[0].content),
      "el prompt tiene que nombrar json o Groq devuelve 400",
    );
  }));

/* Groq dio de baja todos los Llama de chat, así que el modelo que teníamos
   apuntado dejó de existir. Esta prueba fija el vigente. */
Deno.test("apunta a un modelo de Groq que existe hoy", () => {
  assertEquals(GROQ_MODEL, "openai/gpt-oss-120b");
  assert(!GROQ_MODEL.includes("llama-3.3"), "llama-3.3-70b-versatile está dado de baja");
});

Deno.test("cualquier fallo de Gemini pasa a Groq, no solo la cuota", async () => {
  const casos: [string, () => Response][] = [
    ["503 caída", () => new Response("{}", { status: 503 })],
    ["404 modelo retirado", () => new Response("{}", { status: 404 })],
    ["200 pero ilegible", () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "puro texto" }] } }] }), { status: 200 })],
    ["200 cortado por tokens", () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"recomendacion":"a mitad' }] } }],
        }),
        { status: 200 },
      )],
  ];
  for (const [nombre, gemini] of casos) {
    await conClaves(async () => {
      ruta(gemini, () => new Response(JSON.stringify(groqOk("rescatado", "ok")), { status: 200 }));
      const res = await handle(post({ workouts: SESIONES }));
      assertEquals(res.status, 200, `${nombre} debería haber caído a Groq`);
      assertEquals((await res.json()).recomendacion, "rescatado");
    });
  }
});

Deno.test("Groq también acepta el JSON envuelto en ```json", async () =>
  await conClaves(async () => {
    ruta(R429, () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: { content: '```json\n{"recomendacion":"Hoy pierna.","consejo":"Descansá."}\n```' },
          }],
        }),
        { status: 200 },
      ));
    const b = await (await handle(post({ workouts: SESIONES }))).json();
    assertEquals(b.recomendacion, "Hoy pierna.");
  }));

Deno.test("si Gemini anda, a Groq no se lo molesta", async () =>
  await conClaves(async () => {
    let llamadasGroq = 0;
    ruta(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"recomendacion":"a","consejo":"b"}' }] } }],
          }),
          { status: 200 },
        ),
      () => {
        llamadasGroq++;
        return new Response("{}", { status: 200 });
      },
    );
    const b = await (await handle(post({ workouts: SESIONES }))).json();
    assertEquals(b.provider, "gemini");
    assertEquals(llamadasGroq, 0, "no se gasta cuota del respaldo sin necesidad");
  }));

Deno.test("si fallan las dos, el mensaje explica ambas", async () =>
  await conClaves(async () => {
    ruta(R429, () => new Response(JSON.stringify({ error: "rate_limit_exceeded" }), { status: 429 }));
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 502);
    const err = (await res.json()).error as string;
    assert(err.includes("cuota gratis"), `sin el motivo de Gemini: ${err}`);
    assert(err.includes("respaldo"), `sin el motivo de Groq: ${err}`);
  }));

Deno.test("sin GEMINI_API_KEY se va derecho a Groq", async () =>
  await conClaves(async () => {
    let llamadasGemini = 0;
    ruta(
      () => { llamadasGemini++; return new Response("{}", { status: 200 }); },
      () => new Response(JSON.stringify(groqOk("solo groq", "ok")), { status: 200 }),
    );
    const b = await (await handle(post({ workouts: SESIONES }))).json();
    assertEquals(llamadasGemini, 0);
    assertEquals(b.provider, "groq");
  }, { gemini: false }));

Deno.test("sin ninguna de las dos claves lo dice claro", async () =>
  await conClaves(async () => {
    const res = await handle(post({ workouts: SESIONES }));
    assertEquals(res.status, 500);
    const err = (await res.json()).error as string;
    assert(err.includes("GEMINI_API_KEY") && err.includes("GROQ_API_KEY"));
  }, { gemini: false, groq: false }));

Deno.test("las claves nunca salen en la respuesta", async () =>
  await conClaves(async () => {
    ruta(R429, () => new Response(JSON.stringify(groqOk("a", "b")), { status: 200 }));
    const t = await (await handle(post({ workouts: SESIONES }))).text();
    assert(!t.includes("clave-groq") && !t.includes("clave-gemini"));
  }));
