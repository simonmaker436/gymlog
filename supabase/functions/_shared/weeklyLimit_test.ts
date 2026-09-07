/* Pruebas del límite semanal de análisis.
   Correr con:  npx deno@2 test --allow-env supabase/functions/ */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ANALYSES_PER_WEEK,
  AnalysisEntry,
  HISTORY_MAX,
  nextReset,
  trimHistory,
  usageFor,
  weekStart,
} from "./weeklyLimit.ts";

/* 2026-09-07 es lunes; 2026-09-13, domingo. */
Deno.test("la semana va de lunes a domingo", () => {
  assertEquals(weekStart("2026-09-07"), "2026-09-07", "el lunes es su propio inicio");
  assertEquals(weekStart("2026-09-09"), "2026-09-07", "miércoles");
  assertEquals(weekStart("2026-09-13"), "2026-09-07", "domingo sigue en la misma semana");
  assertEquals(weekStart("2026-09-14"), "2026-09-14", "el lunes siguiente abre otra");
});

Deno.test("nextReset es siempre el lunes que viene", () => {
  assertEquals(nextReset("2026-09-07"), "2026-09-14");
  assertEquals(nextReset("2026-09-13"), "2026-09-14", "desde el domingo, mañana");
  assertEquals(nextReset("2026-09-14"), "2026-09-21");
});

Deno.test("cruza fin de mes y de año sin despeinarse", () => {
  assertEquals(weekStart("2026-01-01"), "2025-12-29", "jueves de la semana anterior");
  assertEquals(nextReset("2026-12-31"), "2027-01-04");
});

const e = (at: string): AnalysisEntry => ({ at });

Deno.test("sin análisis, quedan todos", () => {
  const u = usageFor([], "2026-09-09");
  assertEquals(u.used, 0);
  assertEquals(u.remaining, ANALYSES_PER_WEEK);
  assertEquals(u.limit, ANALYSES_PER_WEEK);
  assert(u.allowed);
});

Deno.test("con uno usado queda uno", () => {
  const u = usageFor([e("2026-09-08")], "2026-09-09");
  assertEquals(u.used, 1);
  assertEquals(u.remaining, 1);
  assert(u.allowed, "todavía se puede");
});

Deno.test("con dos usados se bloquea", () => {
  const u = usageFor([e("2026-09-07"), e("2026-09-09")], "2026-09-09");
  assertEquals(u.used, 2);
  assertEquals(u.remaining, 0);
  assertEquals(u.allowed, false, "el tercero no");
  assertEquals(u.nextReset, "2026-09-14");
});

Deno.test("los de semanas anteriores no descuentan", () => {
  const viejos = [e("2026-08-31"), e("2026-09-01"), e("2026-09-02"), e("2026-09-06")];
  const u = usageFor(viejos, "2026-09-09");
  assertEquals(u.used, 0, "todos son de la semana pasada");
  assert(u.allowed);
});

Deno.test("el domingo todavía cuenta, el lunes ya no", () => {
  const dosEstaSemana = [e("2026-09-07"), e("2026-09-08")];
  assertEquals(usageFor(dosEstaSemana, "2026-09-13").allowed, false, "domingo: sigue bloqueado");
  assertEquals(usageFor(dosEstaSemana, "2026-09-14").allowed, true, "lunes: se repone");
  assertEquals(usageFor(dosEstaSemana, "2026-09-14").remaining, ANALYSES_PER_WEEK);
});

Deno.test("nunca queda un negativo aunque haya de más", () => {
  const muchos = [e("2026-09-07"), e("2026-09-08"), e("2026-09-09"), e("2026-09-10")];
  const u = usageFor(muchos, "2026-09-09");
  assertEquals(u.used, 4);
  assertEquals(u.remaining, 0, "se corta en cero, no en -2");
});

Deno.test("entradas rotas no rompen el conteo", () => {
  const sucias = [
    e("2026-09-08"),
    null as unknown as AnalysisEntry,
    { at: 12345 } as unknown as AnalysisEntry,
    {} as AnalysisEntry,
  ];
  const u = usageFor(sucias, "2026-09-09");
  assertEquals(u.used, 1, "solo la buena");
});

Deno.test("trimHistory ordena de más nuevo a más viejo y acota", () => {
  const muchas = Array.from({ length: HISTORY_MAX + 15 }, (_, i) =>
    e(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)));
  const out = trimHistory(muchas);
  assertEquals(out.length, HISTORY_MAX, "no crece sin fin");
  assert(out[0].at > out[out.length - 1].at, "el más nuevo primero");
});

/* El límite es el número que se va a querer tocar; que quede fijado por una
   prueba, para que un cambio sea deliberado y no un descuido. */
Deno.test("hoy el límite son 2 por semana", () => {
  assertEquals(ANALYSES_PER_WEEK, 2);
});
