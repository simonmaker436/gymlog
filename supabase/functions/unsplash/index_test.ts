/* Pruebas de la función unsplash.
   Correr con:  npx deno@2 test --allow-env supabase/functions/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { APP_NAME, CARD_H, CARD_W, handle, POOL } from "./index.ts";
import { DEFAULT_TERM, SEARCH_TERMS, termFor } from "../_shared/unsplashTerms.ts";

const realFetch = globalThis.fetch;
const USER = "11111111-2222-3333-4444-555555555555";

function post(body: unknown, auth: string | null = "Bearer token-de-prueba") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  return new Request("https://x/unsplash", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function foto(n: number) {
  return {
    urls: { raw: `https://images.unsplash.com/foto-${n}?ixid=abc`, regular: `https://r/${n}` },
    links: { download_location: `https://api.unsplash.com/photos/${n}/download` },
    alt_description: `foto ${n}`,
    user: { name: `Autor ${n}`, username: `autor${n}`, links: { html: `https://unsplash.com/@autor${n}` } },
  };
}

interface Llamada { url: string; auth: string | null }

function mock(opts: {
  user?: string | null;
  status?: number;
  cuerpo?: unknown;
  llamadas?: Llamada[];
} = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    opts.llamadas?.push({ url, auth: new Headers(init?.headers).get("Authorization") });

    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        user
          ? new Response(JSON.stringify({ id: user }), { status: 200 })
          : new Response("{}", { status: 401 }),
      );
    }
    if (url.includes("/search/photos")) {
      const cuerpo = opts.cuerpo ?? { results: [foto(1), foto(2), foto(3)] };
      return Promise.resolve(
        new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), {
          status: opts.status ?? 200,
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

function conEntorno<T>(fn: () => Promise<T>, opts: { clave?: boolean } = {}): Promise<T> {
  Deno.env.set("SUPABASE_URL", "https://sb.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-secreta");
  if (opts.clave === false) Deno.env.delete("UNSPLASH_ACCESS_KEY");
  else Deno.env.set("UNSPLASH_ACCESS_KEY", "clave-unsplash");
  return fn().finally(() => {
    for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UNSPLASH_ACCESS_KEY"]) {
      Deno.env.delete(k);
    }
    globalThis.fetch = realFetch;
  });
}

/* ------------------------------------------------------- términos */

Deno.test("cada zona tiene su término en inglés", () => {
  for (const k of ["pierna", "brazo", "abdomen", "pecho", "espalda", "otro"]) {
    assert(SEARCH_TERMS[k], `falta el término de ${k}`);
    assertEquals(/^[\x20-\x7E]+$/.test(SEARCH_TERMS[k]), true, `${k}: sin acentos, es inglés`);
  }
});

Deno.test("una categoría desconocida cae al término genérico", () => {
  assertEquals(termFor("inventada"), DEFAULT_TERM);
  assertEquals(termFor(null), DEFAULT_TERM);
  assertEquals(termFor(42), DEFAULT_TERM);
});

Deno.test("con varias zonas manda la primera conocida", () => {
  assertEquals(termFor(["inventada", "espalda", "pierna"]), SEARCH_TERMS.espalda);
  assertEquals(termFor([]), DEFAULT_TERM);
});

Deno.test("las etiquetas viejas siguen teniendo término", () => {
  for (const k of ["empuje", "tiron", "fullbody", "cardio"]) {
    assert(SEARCH_TERMS[k], `falta ${k}`);
  }
});

/* ------------------------------------------------------ aislamiento */

Deno.test("sin token válido responde 401 y no llama a Unsplash", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({ user: null, llamadas });
    const res = await handle(post({ category: "pierna" }));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "Necesitás iniciar sesión.");
    assertEquals(
      llamadas.some((l) => l.url.includes("api.unsplash.com")),
      false,
      "un anónimo no puede gastar la cuota de Unsplash",
    );
  }));

Deno.test("sin cabecera Authorization tampoco", async () =>
  await conEntorno(async () => {
    mock();
    assertEquals((await handle(post({ category: "pierna" }, null))).status, 401);
  }));

/* ------------------------------------------------------ sin clave */

Deno.test("sin UNSPLASH_ACCESS_KEY avisa con 503 y disponible:false", async () =>
  await conEntorno(async () => {
    mock();
    const res = await handle(post({ category: "pierna" }));
    assertEquals(res.status, 503);
    const d = await res.json();
    assertEquals(d.disponible, false, "el cliente lo usa para caer a su fondo de siempre");
    assert(d.error.includes("UNSPLASH_ACCESS_KEY"));
  }, { clave: false }));

/* ------------------------------------------------------ camino feliz */

Deno.test("devuelve foto, autor y los dos enlaces con utm", async () =>
  await conEntorno(async () => {
    mock({ cuerpo: { results: [foto(7)] } });
    const res = await handle(post({ category: "espalda" }));
    assertEquals(res.status, 200);
    const d = await res.json();

    assertEquals(d.disponible, true);
    assertEquals(d.category, "espalda");
    assertEquals(d.query, SEARCH_TERMS.espalda);
    assertEquals(d.photographer, "Autor 7");

    /* Lo que exigen los términos de Unsplash. */
    for (const enlace of [d.photographerUrl, d.unsplashUrl]) {
      assert(enlace.includes(`utm_source=${APP_NAME}`), `sin utm_source: ${enlace}`);
      assert(enlace.includes("utm_medium=referral"), `sin utm_medium: ${enlace}`);
    }
    assert(d.photographerUrl.startsWith("https://unsplash.com/@autor7"));
    assert(d.unsplashUrl.startsWith("https://unsplash.com/?"));
  }));

Deno.test("la imagen viene recortada al tamaño de la tarjeta", async () =>
  await conEntorno(async () => {
    mock({ cuerpo: { results: [foto(1)] } });
    const d = await (await handle(post({ category: "pierna" }))).json();
    assert(d.imageUrl.includes(`w=${CARD_W}`), d.imageUrl);
    assert(d.imageUrl.includes(`h=${CARD_H}`), d.imageUrl);
    assert(d.imageUrl.includes("fit=crop"), "recortada, no deformada");
  }));

Deno.test("pide un puñado de fotos verticales y elige una", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({ llamadas });
    await handle(post({ category: "pecho" }));
    const busqueda = llamadas.find((l) => l.url.includes("/search/photos"))!;
    assert(busqueda.url.includes(`per_page=${POOL}`), busqueda.url);
    assert(busqueda.url.includes("orientation=portrait"), "la tarjeta es vertical");
    assert(busqueda.url.includes("content_filter=high"), "nada subido de tono");
    assertEquals(busqueda.auth, "Client-ID clave-unsplash");
  }));

/* Con una sola foto la tarjeta saldría idéntica siempre. */
Deno.test("no sale siempre la misma foto del montón", async () =>
  await conEntorno(async () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 40; i++) {
      mock({ cuerpo: { results: [foto(1), foto(2), foto(3), foto(4)] } });
      const d = await (await handle(post({ category: "pierna" }))).json();
      vistas.add(d.photographer);
    }
    assert(vistas.size > 1, "elige al azar entre las que trae Unsplash");
  }));

/* Avisar del uso es obligatorio por los términos de Unsplash. */
Deno.test("dispara el aviso de uso al elegir una foto", async () =>
  await conEntorno(async () => {
    const llamadas: Llamada[] = [];
    mock({ cuerpo: { results: [foto(9)] }, llamadas });
    await handle(post({ category: "brazo" }));
    const aviso = llamadas.find((l) => l.url.includes("/download"));
    assert(aviso, "no se avisó del uso de la foto");
    assertEquals(aviso!.auth, "Client-ID clave-unsplash");
  }));

/* ------------------------------------------------------ fallos */

Deno.test("cuota agotada se explica en cristiano", async () =>
  await conEntorno(async () => {
    mock({ status: 429, cuerpo: { errors: ["Rate Limit Exceeded"] } });
    const res = await handle(post({ category: "pierna" }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("cuota de Unsplash"));
  }));

Deno.test("clave inválida se explica sin tecnicismos", async () =>
  await conEntorno(async () => {
    mock({ status: 401 });
    assert((await (await handle(post({ category: "pierna" }))).json()).error.includes("no es válida"));
  }));

Deno.test("una búsqueda sin resultados no revienta", async () =>
  await conEntorno(async () => {
    mock({ cuerpo: { results: [] } });
    const res = await handle(post({ category: "pierna" }));
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes("no devolvió fotos"));
  }));

Deno.test("respuesta ilegible de Unsplash tampoco", async () =>
  await conEntorno(async () => {
    mock({ cuerpo: "no es json" });
    assertEquals((await handle(post({ category: "pierna" }))).status, 502);
  }));

Deno.test("la clave nunca sale en la respuesta", async () =>
  await conEntorno(async () => {
    mock();
    const t = await (await handle(post({ category: "pierna" }))).text();
    assertEquals(t.includes("clave-unsplash"), false);
  }));

Deno.test("OPTIONS responde el preflight", async () => {
  const res = await handle(new Request("https://x/unsplash", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});
