/* Pruebas de la lógica pura de la función coach.
   Correr con:  npx deno@2 test --allow-env supabase/functions/coach/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPrompt,
  cleanWorkouts,
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
  assertEquals(out[1].type, null, "un tipo que no existe queda en null");
  assertEquals(out[1].energy, null, "energía fuera de 1-5 queda en null");
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

Deno.test("summarize cuenta los días desde cada tipo", () => {
  const ws = cleanWorkouts([
    { date: "2026-09-05", type: "empuje", energy: 4 },
    { date: "2026-09-03", type: "empuje", energy: 3 },
    { date: "2026-08-10", type: "pierna", energy: 2 },
  ]);
  const s = summarize(ws, HOY);
  const porTipo = Object.fromEntries(s.types.map((t) => [t.key, t]));

  assertEquals(porTipo.empuje.count, 2);
  assertEquals(porTipo.empuje.daysSince, 1, "empuje fue ayer");
  assertEquals(porTipo.pierna.count, 1);
  assertEquals(porTipo.pierna.daysSince, 27, "pierna hace 27 días");
  assertEquals(porTipo.cardio.count, 0);
  assertEquals(porTipo.cardio.daysSince, null, "cardio nunca");
  assertEquals(s.avgEnergy, 3);
});

Deno.test("summarize sobrevive sin datos de energía ni tipos", () => {
  const s = summarize(cleanWorkouts([{ date: "2026-09-01" }]), HOY);
  assertEquals(s.avgEnergy, null);
  assertEquals(s.untyped, 1);
  assertEquals(s.total, 1);
});

Deno.test("buildPrompt trae los hechos y prohíbe inventar ejercicios", () => {
  const ws = cleanWorkouts([
    { date: "2026-09-05", type: "empuje", energy: 4, notes: "buena sesión" },
    { date: "2026-08-10", type: "pierna", energy: 2 },
  ]);
  const p = buildPrompt(summarize(ws, HOY));

  assert(p.includes("Pierna: 1 sesión, última hace 27 días"), "días reales de pierna");
  assert(p.includes("Empuje: 1 sesión, última hace 1 día"), "singular de día");
  assert(p.includes("series"), "advierte que no hay series");
  assert(p.includes("buena sesión"), "incluye las notas");
  assert(p.includes("Sin registrar nunca:"), "lista los tipos no usados");
  assert(p.indexOf("Pierna") < p.indexOf("Empuje"), "el más abandonado va primero");
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
