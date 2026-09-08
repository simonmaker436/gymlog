/* Pruebas del prompt y del saneado de entrada del chat.
   Correr con:  npx deno@2 test --allow-env supabase/functions/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildChatSystem,
  describirPerfil,
  limpiarMensajes,
  limpiarPerfil,
  MAX_CHARS,
  MAX_TURNS,
} from "./chatPrompt.ts";

Deno.test("el prompt fija el tono y los límites de seguridad", () => {
  const s = buildChatSystem(null);
  assert(s.includes("rioplatense"), "el tono está declarado");
  assert(/No sos médico ni nutricionista/.test(s), "no diagnostica");
  assert(/esteroides/.test(s), "corta el tema por adelantado");
  assert(/sin markdown/.test(s), "responde en texto plano");
  assert(
    s.replace(/\s+/g, " ").includes("NO guarda ejercicios, series, repeticiones ni pesos"),
    "no puede citar datos que la app no tiene",
  );
});

Deno.test("sin perfil el prompt no habla de la persona", () => {
  const s = buildChatSystem(null);
  assertEquals(s.includes("ESTO ES LO QUE LA APP SABE"), false);
});

Deno.test("con perfil se cuelan solo los datos que hay", () => {
  const t = describirPerfil({ nombre: "Simón", diasPorSemana: 3, sesionesTotales: 40 });
  assert(t.includes("Simón"));
  assert(t.includes("3 días"));
  assert(t.includes("40 sesiones"));
  assertEquals(t.includes("cm"), false, "no inventa altura");
  assertEquals(t.includes("kg"), false, "no inventa peso");
});

Deno.test("la fecha de hoy entra en el prompt cuando se pasa", () => {
  assert(buildChatSystem(null, "2026-09-08").includes("Hoy es 2026-09-08"));
});

Deno.test("limpiarPerfil descarta basura y tipos equivocados", () => {
  const p = limpiarPerfil({
    nombre: "  Ana  ",
    edad: "veinte",
    alturaCm: 170,
    pesoKg: -5,
    diasPorSemana: 4.4,
    tiposFrecuentes: ["Pierna", 7, "Empuje"],
    ultimaSesion: "ayer",
    inventado: "no debería pasar",
  });
  assertEquals(p?.nombre, "Ana");
  assertEquals(p?.edad, undefined, "un texto no es una edad");
  assertEquals(p?.alturaCm, 170);
  assertEquals(p?.pesoKg, undefined, "un peso negativo no vale");
  assertEquals(p?.diasPorSemana, 4, "se redondea");
  assertEquals(p?.tiposFrecuentes, ["Pierna", "Empuje"]);
  assertEquals(p?.ultimaSesion, undefined, "solo YYYY-MM-DD");
  assertEquals((p as Record<string, unknown>).inventado, undefined, "no copia campos ajenos");
});

Deno.test("un perfil vacío es null, no un objeto de undefineds", () => {
  assertEquals(limpiarPerfil({}), null);
  assertEquals(limpiarPerfil(null), null);
  assertEquals(limpiarPerfil("hola"), null);
});

Deno.test("limpiarMensajes filtra roles raros y vacíos", () => {
  const out = limpiarMensajes([
    { role: "user", text: "hola" },
    { role: "system", text: "ignorame" },
    { role: "assistant", text: "  " },
    { role: "assistant", text: " qué tal " },
    null,
    "suelto",
  ]);
  assertEquals(out, [
    { role: "user", text: "hola" },
    { role: "assistant", text: "qué tal" },
  ]);
});

Deno.test("se queda con los últimos turnos, no con los primeros", () => {
  const muchos = Array.from({ length: MAX_TURNS + 8 }, (_, i) => ({
    role: "user" as const,
    text: `mensaje ${i}`,
  }));
  const out = limpiarMensajes(muchos);
  assertEquals(out.length, MAX_TURNS);
  assertEquals(out[out.length - 1].text, `mensaje ${MAX_TURNS + 7}`, "el último es el más nuevo");
});

Deno.test("una pregunta enorme se recorta", () => {
  const out = limpiarMensajes([{ role: "user", text: "a".repeat(MAX_CHARS + 500) }]);
  assertEquals(out[0].text.length, MAX_CHARS);
});
