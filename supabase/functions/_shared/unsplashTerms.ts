/* =========================================================================
   unsplashTerms.ts — de categoría de entrenamiento a búsqueda en Unsplash
   =========================================================================
   ESTA es la lista que hay que tocar para cambiar qué foto sale con cada
   zona. Las claves son las de MUSCLE_GROUPS (store.js); los términos van en
   inglés porque el buscador de Unsplash da resultados bastante pobres en
   español.

   Al elegir términos conviene ser concreto («bench press chest workout»
   trae gimnasio; «chest» a secas trae cofres y baúles).
   ========================================================================= */

export const SEARCH_TERMS: Record<string, string> = {
  pierna: "squat leg workout gym",
  brazo: "dumbbell biceps arm workout",
  abdomen: "abs core training gym",
  pecho: "bench press chest workout",
  espalda: "pull up back muscles gym",
  otro: "gym training motivation",

  /* Etiquetas retiradas que siguen en historiales viejos. */
  empuje: "push workout bench press gym",
  tiron: "pull up row back workout",
  fullbody: "full body workout gym",
  cardio: "running treadmill cardio gym",
};

/* Cuando no se manda categoría, o llega una que no conocemos. */
export const DEFAULT_TERM = "gym workout dark";

/* Una sesión puede tener varias zonas marcadas; la tarjeta lleva una sola
   foto, así que manda la primera que conozcamos. */
export function termFor(category: unknown): string {
  if (typeof category === "string") {
    const k = category.trim().toLowerCase();
    if (SEARCH_TERMS[k]) return SEARCH_TERMS[k];
  }
  if (Array.isArray(category)) {
    for (const c of category) {
      if (typeof c === "string" && SEARCH_TERMS[c.trim().toLowerCase()]) {
        return SEARCH_TERMS[c.trim().toLowerCase()];
      }
    }
  }
  return DEFAULT_TERM;
}

/* La categoría tal como se devuelve al cliente, ya normalizada. */
export function normalizeCategory(category: unknown): string {
  if (typeof category === "string" && SEARCH_TERMS[category.trim().toLowerCase()]) {
    return category.trim().toLowerCase();
  }
  if (Array.isArray(category)) {
    for (const c of category) {
      if (typeof c === "string" && SEARCH_TERMS[c.trim().toLowerCase()]) {
        return c.trim().toLowerCase();
      }
    }
  }
  return "otro";
}
