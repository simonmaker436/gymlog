/* Pruebas de la función chat.
   Correr con:  npx deno@2 test --allow-env supabase/functions/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handle } from "./index.ts";

const realFetch = globalThis.fetch;
const USER = "11111111-2222-3333-4444-555555555555";

function post(body: unknown, auth = "Bearer token-de-prueba") {
  return new Request("https://x/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth },
    body: JSON.stringify(body),
  });
}

interface Llamada { url: string; body: Record<string, unknown> }

/* Simula el token válido y las dos IAs. `gemini`/`groq` deciden qué
   responde cada una; en `llamadas` queda todo lo que se pidió. */
function mockTodo(opts: {
  user?: string | null;
  gemini?: Response;
  groq?: Response;
  llamadas?: Llamada[];
} = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* no era JSON */ }
    opts.llamadas?.push({ url, body });

    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        user
          ? new Response(JSON.stringify({ id: user }), { status: 200 })
          : new Response("{}", { status: 401 }),
      );
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(opts.gemini ?? geminiDice("respuesta de gemini"));
    }
    if (url.includes("api.groq.com")) {
      return Promise.resolve(opts.groq ?? groqDice("respuesta de groq"));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

const geminiDice = (t: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }),
    { status: 200 },
  );
const groqDice = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: t } }] }), { status: 200 });

function conEntorno<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secreta");
  Deno.env.set("GEMINI_API_KEY", "clave-gemini");
  Deno.env.set("GROQ_API_KEY", "clave-groq");
  return fn().finally(() => {
    for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"]) {
      Deno.env.delete(k);
    }
    globalThis.fetch = realFetch;
  });
}

/* ------------------------------------------------------- aislamiento */

Deno.test("sin token válido no se contesta ni se llama a la IA", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mockTodo({ user: null, llamadas });
    const res = await handle(post({ messages: [{ role: "user", text: "hola" }] }));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Necesitás iniciar sesión.");
    assert(
      !llamadas.some((l) => /googleapis|groq/.test(l.url)),
      "un anónimo no puede gastar la cuota de IA",
    );
  }));

Deno.test("sin cabecera Authorization tampoco", async () =>
  await conEntorno(async () => {
    mockTodo();
    const req = new Request("https://x/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: "hola" }] }),
    });
    assertEquals((await handle(req)).status, 401);
  }));

/* ------------------------------------------------------- validación */

Deno.test("hace falta una pregunta", async () =>
  await conEntorno(async () => {
    mockTodo();
    assertEquals((await handle(post({ messages: [] }))).status, 400);
    assertEquals((await handle(post({}))).status, 400);
  }));

Deno.test("el último mensaje tiene que ser de la persona", async () =>
  await conEntorno(async () => {
    mockTodo();
    const res = await handle(post({
      messages: [{ role: "user", text: "hola" }, { role: "assistant", text: "qué tal" }],
    }));
    assertEquals(res.status, 400);
  }));

Deno.test("OPTIONS responde el preflight", async () => {
  const res = await handle(new Request("https://x/chat", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

/* ------------------------------------------------------------ camino feliz */

Deno.test("responde con lo que dijo Gemini", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mockTodo({ llamadas, gemini: geminiDice("Descansá 48 h entre piernas.") });
    const res = await handle(post({ messages: [{ role: "user", text: "¿cada cuánto piernas?" }] }));
    assertEquals(res.status, 200);
    const d = await res.json();
    assertEquals(d.reply, "Descansá 48 h entre piernas.");
    assertEquals(d.provider, "gemini");
    assert(!llamadas.some((l) => l.url.includes("groq")), "no se llama al respaldo si el primero anduvo");
  }));

Deno.test("la conversación entera viaja, con los roles que espera Gemini", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mockTodo({ llamadas });
    await handle(post({
      messages: [
        { role: "user", text: "primera" },
        { role: "assistant", text: "contesté" },
        { role: "user", text: "segunda" },
      ],
    }));
    const g = llamadas.find((l) => l.url.includes("googleapis"))!;
    const contents = g.body.contents as { role: string; parts: { text: string }[] }[];
    assertEquals(contents.map((c) => c.role), ["user", "model", "user"]);
    assertEquals(contents[2].parts[0].text, "segunda");
    assert(!("responseSchema" in (g.body.generationConfig as object)), "un chat no devuelve JSON");
  }));

Deno.test("el perfil del usuario llega a las instrucciones", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mockTodo({ llamadas });
    await handle(post({
      messages: [{ role: "user", text: "¿voy bien?" }],
      profile: { nombre: "Simón", diasPorSemana: 3, rachaSemanas: 5 },
    }));
    const g = llamadas.find((l) => l.url.includes("googleapis"))!;
    const sys = JSON.stringify(g.body.systemInstruction);
    assert(sys.includes("Simón"));
    assert(sys.includes("3 días"));
    assert(sys.includes("5 semanas"));
  }));

Deno.test("sin perfil funciona igual", async () =>
  await conEntorno(async () => {
    mockTodo();
    const res = await handle(post({ messages: [{ role: "user", text: "hola" }] }));
    assertEquals(res.status, 200);
  }));

/* ------------------------------------------------------------- respaldo */

Deno.test("si Gemini se queda sin cuota contesta Groq", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mockTodo({
      llamadas,
      gemini: new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 }),
      groq: groqDice("Te contesto yo."),
    });
    const res = await handle(post({ messages: [{ role: "user", text: "hola" }] }));
    assertEquals(res.status, 200);
    const d = await res.json();
    assertEquals(d.reply, "Te contesto yo.");
    assertEquals(d.provider, "groq");

    /* El respaldo tiene que recibir la MISMA conversación y las mismas
       instrucciones, no una versión recortada. */
    const q = llamadas.find((l) => l.url.includes("groq"))!;
    const msgs = q.body.messages as { role: string; content: string }[];
    assertEquals(msgs[0].role, "system");
    assert(msgs[0].content.includes("rioplatense"));
    assertEquals(msgs[1], { role: "user", content: "hola" });
  }));

Deno.test("si fallan las dos, un solo error legible", async () =>
  await conEntorno(async () => {
    mockTodo({
      gemini: new Response("{}", { status: 500 }),
      groq: new Response("{}", { status: 500 }),
    });
    const res = await handle(post({ messages: [{ role: "user", text: "hola" }] }));
    assertEquals(res.status, 502);
    const d = await res.json();
    assert(d.error.includes("IA no está disponible"), d.error);
    assert(d.error.includes("respaldo no está disponible"), d.error);
  }));

Deno.test("una respuesta vacía de Gemini también cae al respaldo", async () =>
  await conEntorno(async () => {
    mockTodo({
      gemini: new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      groq: groqDice("acá estoy"),
    });
    const d = await (await handle(post({ messages: [{ role: "user", text: "hola" }] }))).json();
    assertEquals(d.provider, "groq");
  }));

Deno.test("sin ninguna clave de IA lo dice en vez de fallar raro", async () => {
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GROQ_API_KEY");
  mockTodo();
  try {
    const res = await handle(post({ messages: [{ role: "user", text: "hola" }] }));
    assertEquals(res.status, 500);
    assert((await res.json()).error.includes("GEMINI_API_KEY"));
  } finally {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    globalThis.fetch = realFetch;
  }
});
