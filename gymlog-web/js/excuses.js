/* =========================================================================
   excuses.js — motivos de una falta y qué se le dice a la persona
   =========================================================================
   ESTO es lo que se va a querer editar: los motivos y las frases. Todo es
   texto fijo, escrito acá a mano y a propósito.

   NADA de esto pasa por la IA. Faltar a un día programado es algo que ocurre
   seguido, y gastar una llamada a Gemini o a Groq para devolver una frase de
   ánimo sería tirar cuota (y tiempo de espera) en algo que no lo necesita.
   Mismo criterio que los mensajes del recordatorio push.

   Para añadir un motivo alcanza con sumarlo a REASONS y darle su lista en
   PHRASES. Los datos ya guardados con otros motivos siguen funcionando.
   ========================================================================= */
(function (GL) {
  'use strict';

  /* justified: true  → la falta NO rompe la racha
     justified: false → la falta SÍ la rompe                                */
  var REASONS = [
    { key: 'evento', label: 'Evento', justified: true },
    { key: 'salud', label: 'Salud', justified: true },
    { key: 'imprevisto', label: 'Imprevisto', justified: true },

    { key: 'pereza', label: 'Pereza', justified: false },
    { key: 'sueno', label: 'Sueño', justified: false },
    { key: 'olvido', label: 'Se me olvidó', justified: false }
  ];

  /* Varias por motivo para que no se sienta siempre lo mismo.

     Las justificadas acompañan; las no justificadas son firmes pero no
     culpan: el objetivo es que la persona vuelva mañana, no que cierre la
     app sintiéndose mal. */
  var PHRASES = {
    evento: [
      'Tenías un compromiso y lo cumpliste. El gimnasio te espera mañana.',
      'La vida también pasa fuera del gimnasio. Volvés y seguimos.',
      'Un día ocupado no borra lo que venís construyendo.',
      'Estuviste donde tenías que estar. Mañana, acá.'
    ],
    salud: [
      'La salud es lo más importante: cuidate hoy para volver fuerte mañana.',
      'Entrenar con el cuerpo roto no suma, resta. Recuperate tranquilo.',
      'Descansar también es parte del entrenamiento. Primero estar bien.',
      'El cuerpo avisa. Hacerle caso hoy es lo que te deja seguir mañana.'
    ],
    imprevisto: [
      'Pasan cosas que no se eligen. Mañana retomás donde lo dejaste.',
      'No todo se puede planear. Lo que importa es volver.',
      'Un imprevisto no es una recaída. Seguí.',
      'Se cruzó algo que no dependía de vos. Tu racha sigue en pie.'
    ],

    pereza: [
      'No es solo cuestión de motivación, es de disciplina.',
      'Las ganas no siempre llegan. La rutina no depende de ellas.',
      'Hoy ganó la comodidad. Mañana te toca a vos.',
      'Nadie tiene ganas siempre. Los que siguen, van igual.'
    ],
    sueno: [
      'El cansancio es real, pero la mayoría de los días se entrena igual.',
      'Dormir poco explica el día, no lo resuelve. Acomodá los horarios.',
      'Si el sueño te gana seguido, el problema está en la noche anterior.',
      'Descansar es importante. Que no se vuelva la excusa de siempre.'
    ],
    olvido: [
      'Lo que no se agenda, no pasa. Ponete un aviso.',
      'Olvidarse una vez es normal. Que no sea el patrón.',
      'Una rutina que hay que recordar todavía no es rutina.',
      'Dejalo escrito y sacale la decisión al olvido.'
    ]
  };

  function byKey(key) {
    for (var i = 0; i < REASONS.length; i++) {
      if (REASONS[i].key === key) return REASONS[i];
    }
    return null;
  }

  function forBranch(justified) {
    return REASONS.filter(function (r) { return r.justified === !!justified; });
  }

  /* Rota por fecha en vez de sortear con Math.random(): así la frase de un
     día es siempre la misma. Con azar puro cambiaría en cada repintado, que
     se ve como un parpadeo y hace que el mensaje pierda peso. */
  function dayNumber(iso) {
    var d = new Date((iso || '') + 'T00:00:00');
    if (isNaN(d)) return 0;
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  function phraseFor(key, iso) {
    var list = PHRASES[key];
    if (!list || !list.length) return '';
    return list[dayNumber(iso) % list.length];
  }

  /* Lo que se guarda en el registro del día. Devuelve null si el motivo no
     existe, así una versión vieja o un archivo importado a mano no meten
     basura. `justified` NO se acepta de fuera: sale del motivo, para que no
     puedan quedar incoherentes entre sí. */
  function normalize(v) {
    if (!v || typeof v !== 'object') return null;
    var r = byKey(typeof v.reason === 'string' ? v.reason : '');
    if (!r) return null;
    return { reason: r.key, justified: r.justified };
  }

  function isJustified(w) {
    return !!(w && w.went === false && w.excuse && w.excuse.justified === true);
  }

  function label(w) {
    var r = w && w.excuse ? byKey(w.excuse.reason) : null;
    return r ? r.label : null;
  }

  GL.excuses = {
    REASONS: REASONS,
    PHRASES: PHRASES,
    byKey: byKey,
    forBranch: forBranch,
    phraseFor: phraseFor,
    normalize: normalize,
    isJustified: isJustified,
    label: label
  };
})(window.GL = window.GL || {});
