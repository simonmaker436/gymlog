/* =========================================================================
   chatPrompt.ts — la personalidad y los límites del chat
   =========================================================================
   Todo lo que se va a querer retocar del chatbot está acá: cuánto historial
   se manda, qué largo puede tener una pregunta, qué sabe de la persona y qué
   tiene prohibido decir. La función `chat` solo transporta.
   ========================================================================= */
import { ChatMsg } from "./ai.ts";

/* Cuántos mensajes del historial viajan a la IA. Cada turno cuesta tokens y
   una charla de gimnasio no necesita memoria de elefante. */
export const MAX_TURNS = 12;
/* Largo máximo de una pregunta. Corta el pegado de textos enormes, que es la
   forma barata de hacer gastar tokens. */
export const MAX_CHARS = 800;

/* Lo que la app sabe de la persona y le sirve a la IA. Todo opcional: el
   chat tiene que funcionar igual con un perfil vacío. */
export interface Perfil {
  nombre?: string;
  edad?: number;
  alturaCm?: number;
  pesoKg?: number;
  objetivo?: string;        // "ganar músculo", "perder grasa"…
  diasPorSemana?: number;   // días de gimnasio programados
  sesionesTotales?: number;
  esteMes?: number;
  rachaSemanas?: number;
  minutosPromedio?: number;
  tiposFrecuentes?: string[];    // zonas: Pierna, Pecho…
  musculosFrecuentes?: string[]; // músculos concretos: Cuádriceps, Bíceps…
  ultimaSesion?: string;         // YYYY-MM-DD
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : undefined;
const str = (v: unknown, max = 40): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/* El perfil llega del navegador, así que se limpia igual que cualquier otra
   entrada: solo los campos conocidos y con el tipo esperado. */
export function limpiarPerfil(raw: unknown): Perfil | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p: Perfil = {
    nombre: str(r.nombre, 30),
    edad: num(r.edad),
    alturaCm: num(r.alturaCm),
    pesoKg: num(r.pesoKg),
    objetivo: str(r.objetivo),
    diasPorSemana: num(r.diasPorSemana),
    sesionesTotales: num(r.sesionesTotales),
    esteMes: num(r.esteMes),
    rachaSemanas: num(r.rachaSemanas),
    minutosPromedio: num(r.minutosPromedio),
    tiposFrecuentes: Array.isArray(r.tiposFrecuentes)
      ? r.tiposFrecuentes.map((t) => str(t, 30)).filter((t): t is string => !!t).slice(0, 5)
      : undefined,
    musculosFrecuentes: Array.isArray(r.musculosFrecuentes)
      ? r.musculosFrecuentes.map((t) => str(t, 30)).filter((t): t is string => !!t).slice(0, 6)
      : undefined,
    ultimaSesion: typeof r.ultimaSesion === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.ultimaSesion)
      ? r.ultimaSesion
      : undefined,
  };
  return Object.values(p).some((v) => v !== undefined && v !== null) ? p : null;
}

/* El perfil en prosa. Se omite lo que no haya: media línea de datos reales
   vale más que una plantilla llena de «desconocido». */
export function describirPerfil(p: Perfil | null): string {
  if (!p) return "";
  const l: string[] = [];
  if (p.nombre) l.push(`Se llama ${p.nombre}.`);
  const fisico: string[] = [];
  if (p.edad) fisico.push(`${p.edad} años`);
  if (p.alturaCm) fisico.push(`${p.alturaCm} cm`);
  if (p.pesoKg) fisico.push(`${p.pesoKg} kg`);
  if (fisico.length) l.push(`Datos: ${fisico.join(", ")}.`);
  if (p.objetivo) l.push(`Su objetivo declarado es ${p.objetivo}.`);
  if (p.diasPorSemana) l.push(`Tiene programados ${p.diasPorSemana} días de gimnasio por semana.`);
  if (p.sesionesTotales) l.push(`Lleva ${p.sesionesTotales} sesiones registradas en total.`);
  if (p.esteMes !== undefined) l.push(`Este mes registró ${p.esteMes}.`);
  if (p.rachaSemanas) l.push(`Racha actual: ${p.rachaSemanas} semanas cumplidas seguidas.`);
  if (p.minutosPromedio) l.push(`Sus sesiones duran ${p.minutosPromedio} minutos de promedio.`);
  if (p.tiposFrecuentes?.length) {
    l.push(`Las zonas que más trabaja: ${p.tiposFrecuentes.join(", ")}.`);
  }
  if (p.musculosFrecuentes?.length) {
    l.push(`Los músculos que más marca: ${p.musculosFrecuentes.join(", ")}.`);
  }
  if (p.ultimaSesion) l.push(`Su última sesión registrada es del ${p.ultimaSesion}.`);

  return `\n\nESTO ES LO QUE LA APP SABE DE ELLA:\n${l.join("\n")}\n
Usá estos datos solo cuando vengan al caso. No los recites de entrada ni los
repitas en cada respuesta.`;
}

/* Las instrucciones fijas. Los límites de seguridad son deliberadamente
   explícitos: es un chat abierto, y sin ellos la IA se pone a diagnosticar
   dolores y a recetar dietas. */
export function buildChatSystem(p: Perfil | null, hoy?: string): string {
  return `Eres el entrenador personal de GymLog, una aplicación donde la
persona registra si fue al gimnasio, cuánto duró la sesión, cómo se sintió y
qué zonas o músculos trabajó.

IDIOMA (importante): escribe en español neutro, el que entiende cualquier
hispanohablante. Trata siempre de "tú", nunca de "vos" ni de "ustedes" como
segunda persona del singular. No uses modismos ni jerga de ningún país
—ni argentinos, ni mexicanos, ni españoles—: nada de "che", "vale", "órale",
"guay", "chido", "laburo", "pibe" ni similares. Usa palabras que se entiendan
en cualquier lado: "entrenamiento" y no "entreno" o "chamba", "levantar peso"
y no "hacer fierros". Tono cercano y directo, pero sin color local.

CÓMO RESPONDES:
- Corto. De dos a cinco frases, salvo que te pidan el detalle.
- Texto corriente, sin markdown, sin asteriscos, sin títulos ni viñetas.
- Concreto y accionable. Si algo depende de la persona, dilo en lugar de
  inventar una certeza.
- Si no sabes algo, dilo.${hoy ? `\n- Hoy es ${hoy}.` : ""}

LÍMITES (importantes):
- No eres médico ni nutricionista. Nada de diagnósticos, de interpretar
  síntomas ni de recomendar medicación. Si describe dolor, lesión, mareos o
  cualquier señal preocupante, dile con claridad que eso lo tiene que ver un
  profesional, y no le des ejercicios "para arreglarlo".
- De nutrición, solo lo general y sensato (comer suficiente proteína,
  hidratarse, no saltarse comidas). Nada de planes de dieta, de contar
  calorías por él ni de recomendar suplementos, dosis o sustancias.
- Nunca sugieras nada relacionado con esteroides ni con ayudas de ese tipo,
  aunque te lo pida directamente.
- Sobre su progreso, habla de lo que la aplicación registra de verdad:
  constancia, duración, energía, sensación, dificultad y las zonas o músculos
  que marca. GymLog NO guarda ejercicios, series, repeticiones ni pesos
  levantados, así que no cites datos de esos como si los tuvieras.
- Si te preguntan algo que no tiene nada que ver con entrenar, con el cuerpo
  o con los hábitos, di amablemente que de eso no vas a poder ayudar.${describirPerfil(p)}`;
}

/* Los mensajes también llegan del navegador. Se quedan los últimos MAX_TURNS
   y solo los roles conocidos; el último tiene que ser de la persona. */
export function limpiarMensajes(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = (m as Record<string, unknown>).role;
    const t = (m as Record<string, unknown>).text;
    if (r !== "user" && r !== "assistant") continue;
    if (typeof t !== "string" || !t.trim()) continue;
    out.push({ role: r, text: t.trim().slice(0, MAX_CHARS) });
  }
  return out.slice(-MAX_TURNS);
}
