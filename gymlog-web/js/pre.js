(function () {
    /* Se lee antes de pintar nada: si la intro está desactivada, no arranca. */
    try {
      if (localStorage.getItem('gymlog:intro') === '0') {
        document.documentElement.classList.add('no-intro');
      }
    } catch (e) { }
  })();