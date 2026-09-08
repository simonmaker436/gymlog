/* Pruebas de la lógica pura de la función coach.
   Correr con:  npx deno@2 test --allow-env supabase/functions/coach/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPrompt,
  cleanWorkouts,
  extractText,
  friendlyGeminiError,
  parseModelJson,
  summarize,
} from "./index.ts";

const HOY = "2026-09-06";

Deno.test("cleanWorkouts descarta basura y respeta el tope", () => {
  const raw = [
    { date: "2026-09-04", type: "pierna", energy: 4, feeling: 5, difficulty: 3, notes: " duro " },
    { date: "no-es-fecha", type: "pierna" },
    { date: "2026-09-02", type: "inventado", energy: 99 },
    null,
    "texto suelto",
  ];
  const out = cleanWorkouts(raw);
  assertEquals(out.length, 2);
  assertEquals(out[0].date, "2026-09-04");
  assertEquals(out[0].notes, "duro");
  assertEquals(out[1].groups, [], "una etiqueta que no existe no deja zona");
  assertEquals(out[1].energy, null, "energía fuera de 1-5 queda en null");
});

/* La selección nueva: varias zonas y sus músculos en una misma sesión. */
Deno.test("cleanWorkouts entiende la selección por músculos", () => {
  const out = cleanWorkouts([{
    date: "2026-09-04",
    focus: {
      groups: ["pierna", "brazo", "inventada"],
      muscles: ["cuadriceps", "biceps", "inventado"],
    },
  }]);
  assertEquals(out[0].groups, ["pierna", "brazo"], "descarta la zona inventada");
  assertEquals(out[0].muscles, ["cuadriceps", "biceps"], "descarta el músculo inventado");
});

Deno.test("la etiqueta vieja solo se usa si no hay selección nueva", () => {
  const conAmbas = cleanWorkouts([
    { date: "2026-09-04", type: "empuje", focus: { groups: ["pecho"], muscles: [] } },
  ]);
  assertEquals(conAmbas[0].groups, ["pecho"], "gana la nueva, no se cuenta dos veces");

  const soloVieja = cleanWorkouts([{ date: "2026-09-04", type: "empuje" }]);
  assertEquals(soloVieja[0].groups, ["empuje"], "una sesión de antes conserva su etiqueta");
});

Deno.test("sin zona marcada no se guardan músculos sueltos", () => {
  const out = cleanWorkouts([{ date: "2026-09-04", focus: { muscles: ["biceps"] } }]);
  assertEquals(out[0].groups, []);
  assertEquals(out[0].muscles, []);
});

Deno.test("cleanWorkouts ordena de más nueva a más vieja", () => {
  const out = cleanWorkouts([
    { date: "2026-08-01" },
    { date: "2026-09-01" },
    { date: "2026-08-15" },
  ]);
  assertEquals(out.map((w) => w.date), ["2026-09-01", "2026-08-15", "2026-08-01"]);
});

Deno.test("cleanWorkouts corta en 30", () => {
  const raw = Array.from({ length: 50 }, (_, i) => ({
    date: `2026-0${1 + (i % 9)}-0${1 + (i % 9)}`,
  }));
  assertEquals(cleanWorkouts(raw).length, 30);
});

Deno.test("summarize cuenta los días desde cada zona", () => {
  const ws = cleanWorkouts([
    { date: "2026-09-05", focus: { groups: ["pecho"] }, energy: 4 },
    { date: "2026-09-03", focus: { groups: ["pecho"] }, energy: 3 },
    { date: "2026-08-10", focus: { groups: ["pierna"] }, energy: 2 },
  ]);
  const s = summarize(ws, HOY);
  const porZona = Object.fromEntries(s.types.map((t) => [t.key, t]));

  assertEquals(porZona.pecho.count, 2);
  assertEquals(porZona.pecho.daysSince, 1, "pecho fue ayer");
  assertEquals(porZona.pierna.count, 1);
  assertEquals(porZona.pierna.daysSince, 27, "pierna hace 27 días");
  assertEquals(porZona.espalda.count, 0);
  assertEquals(porZona.espalda.daysSince, null, "espalda nunca");
  assertEquals(s.avgEnergy, 3);
});

Deno.test("una sesión con varias zonas cuenta en todas", () => {
  const ws = cleanWorkouts([
    { date: "2026-09-05", focus: { groups: ["pecho", "brazo"], muscles: ["triceps"] } },
  ]);
  const s = summarize(ws, HOY);
  const porZona = Object.fromEntries(s.types.map((t) => [t.key, t]));
  assertEquals(porZona.pecho.count, 1);
  assertEquals(porZona.brazo.count, 1);
  assertEquals(s.untyped, 0);
  assertEquals(s.muscles, [{ label: "Tríceps", count: 1 }]);
});

/* Las etiquetas retiradas no deben aparecer como «0 sesiones» para siempre;
   solo se listan si la persona realmente las usó alguna vez. */
Deno.test("las etiquetas viejas solo salen si están en el historial", () => {
  const sinNada = summarize(cleanWorkouts([{ date: "2026-09-05" }]), HOY);
  assertEquals(sinNada.types.some((t) => t.key === "empuje"), false);

  const conVieja = summarize(cleanWorkouts([{ date: "2026-09-05", type: "empuje" }]), HOY);
  assertEquals(conVieja.types.find((t) => t.key === "empuje")?.count, 1);
});

Deno.test("summarize sobrevive sin datos de energía ni tipos", () => {
  const s = summarize(cleanWorkouts([{ date: "2026-09-01" }]), HOY);
  assertEquals(s.avgEnergy, null);
  assertEquals(s.untyped, 1);
  assertEquals(s.total, 1);
});

Deno.test("buildPrompt trae los hechos y prohíbe inventar ejercicios", () => {
  const ws = cleanWorkouts([
    { date: "2026-09-05", focus: { groups: ["pecho"], muscles: ["pectoral-medio"] }, energy: 4, notes: "buena sesión" },
    { date: "2026-08-10", focus: { groups: ["pierna"] }, energy: 2 },
  ]);
  const p = buildPrompt(summarize(ws, HOY));

  assert(p.includes("Pierna: 1 sesión, última hace 27 días"), "días reales de pierna");
  assert(p.includes("Pecho: 1 sesión, última hace 1 día"), "singular de día");
  assert(p.includes("Pectoral medio (1)"), "los músculos concretos entran");
  assert(p.includes("series"), "advierte que no hay series");
  assert(p.includes("buena sesión"), "incluye las notas");
  assert(p.includes("Sin trabajar nunca:"), "lista las zonas no usadas");
  assert(p.indexOf("Pierna") < p.indexOf("Pecho"), "la más abandonada va primero");
});

Deno.test("el prompt del consejo también pide español neutro", () => {
  const p = buildPrompt(summarize(cleanWorkouts([{ date: "2026-09-05" }]), HOY));
  assert(p.includes("español neutro"));
  assert(/Trata de "tú"/.test(p));
  assertEquals(/\bSos\b|\bHablás\b|\bBasate\b|\bMencioná\b|\bDevolvé\b/.test(p), false,
    "las instrucciones ya no van en voseo");
});

Deno.test("parseModelJson acepta JSON pelado, con vallas y con texto alrededor", () => {
  const esperado = { recomendacion: "Toca pierna.", consejo: "Dormí más." };
  assertEquals(
    parseModelJson('{"recomendacion":"Toca pierna.","consejo":"Dormí más."}'),
    esperado,
  );
  assertEquals(
    parseModelJson('```json\n{"recomendacion":"Toca pierna.","consejo":"Dormí más."}\n```'),
    esperado,
  );
  assertEquals(
    parseModelJson('Claro:\n{"recomendacion":"Toca pierna.","consejo":"Dormí más."}\nSaludos'),
    esperado,
  );
});

Deno.test("parseModelJson devuelve null con basura", () => {
  assertEquals(parseModelJson(""), null);
  assertEquals(parseModelJson("no hay json acá"), null);
  assertEquals(parseModelJson("{roto"), null);
  assertEquals(parseModelJson('{"otra":"cosa"}'), null);
});

/* gemini-3.6-flash razona antes de responder y la respuesta real trae
   thoughtSignature junto al texto. Si algún día el razonamiento viene como
   una parte aparte y primera, leer solo parts[0] devolvería basura. */
Deno.test("extractText junta las partes de texto y saltea el razonamiento", () => {
  const conFirma = {
    candidates: [{
      content: {
        parts: [{ text: '{"recomendacion":"a","consejo":"b"}', thoughtSignature: "xxx" }],
      },
    }],
  };
  assertEquals(extractText(conFirma), '{"recomendacion":"a","consejo":"b"}');

  const conParteDePensamiento = {
    candidates: [{
      content: {
        parts: [
          { text: "déjame pensar…", thought: true },
          { text: '{"recomendacion":"a",' },
          { text: '"consejo":"b"}' },
        ],
      },
    }],
  };
  assertEquals(extractText(conParteDePensamiento), '{"recomendacion":"a","consejo":"b"}');
  assertEquals(parseModelJson(extractText(conParteDePensamiento)), {
    recomendacion: "a",
    consejo: "b",
  });
});

Deno.test("extractText no explota con respuestas raras", () => {
  assertEquals(extractText(null), "");
  assertEquals(extractText({}), "");
  assertEquals(extractText({ candidates: [] }), "");
  assertEquals(extractText({ candidates: [{ content: {} }] }), "");
});

Deno.test("friendlyGeminiError distingue el límite del plan gratis", () => {
  assert(friendlyGeminiError(429, "").includes("cuota gratis"));
  assert(
    friendlyGeminiError(400, '{"error":{"status":"RESOURCE_EXHAUSTED"}}').includes("cuota gratis"),
    "también cuando llega como 400 con RESOURCE_EXHAUSTED",
  );
  assert(friendlyGeminiError(400, '{"reason":"API_KEY_INVALID"}').includes("GEMINI_API_KEY"));
  assert(friendlyGeminiError(503, "").includes("no está disponible"));
  assert(friendlyGeminiError(418, "").length > 0, "cualquier otro caso también habla");
});
