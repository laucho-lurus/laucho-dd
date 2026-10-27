// Ficha: barras de maná y experiencia, y hechizos con su botón "Lanzar" (el servidor valida y tira).

const el = (etiqueta, clase, texto) => {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

function barra(etiqueta, valor, max, clase) {
  const d = el('div', `barra ${clase}`);
  const relleno = el('span');
  relleno.style.width = `${max ? Math.min(100, (valor / max) * 100) : 100}%`;
  d.append(relleno, el('small', '', `${etiqueta} ${valor}${max ? `/${max}` : ''}`));
  return d;
}

/** Pinta PM, XP y hechizos. `propio`: el dueño puede lanzar (si es su turno; el servidor lo comprueba). */
export function pintarMagia(ficha, jugador, { propio, monstruos = [], jugadores = [], enviar }) {
  const partes = [];
  if (jugador.pm_max) partes.push(barra('PM', jugador.pm, jugador.pm_max, 'pm'));
  partes.push(barra('XP', jugador.xp, jugador.xp_siguiente, 'xp'));
  if (jugador.hechizos?.length) {
    partes.push(el('h3', '', 'Hechizos'));
    const lista = el('ul', 'inventario');
    for (const h of jugador.hechizos) {
      const li = el('li');
      const linea = el('div', 'linea');
      linea.append(el('span', '', `${h.nombre} `), el('small', '', h.costo ? `${h.costo} PM` : 'truco'));
      if (propio) {
        let objetivo = null;
        if (h.efecto === 'curacion') {
          objetivo = el('select', 'mini');
          objetivo.append(...jugadores.map((j) => new Option(j.personaje_id === jugador.personaje_id ? 'A mí' : j.nombre, j.personaje_id)));
        } else if (h.efecto !== 'utilidad') {
          const vivos = monstruos.filter((m) => m.estado !== 'caído');
          if (vivos.length) {
            objetivo = el('select', 'mini');
            objetivo.append(...vivos.map((m) => new Option(m.nombre, m.id)), new Option('— sin objetivo —', ''));
          }
        }
        objetivo?.setAttribute('aria-label', `Objetivo de ${h.nombre}`);
        const boton = el('button', 'mini', 'Lanzar');
        boton.type = 'button';
        boton.disabled = h.costo > jugador.pm;
        boton.addEventListener('click', () => {
          const pedido = { tipo: 'lanzar', hechizo_id: h.id };
          if (objetivo?.value) pedido[h.efecto === 'curacion' ? 'objetivo_personaje' : 'objetivo_monstruo'] = objetivo.value;
          enviar(pedido);
        });
        if (objetivo) linea.append(objetivo);
        linea.append(boton);
      }
      li.append(linea, el('small', '', `${h.alcance} · ${h.descripcion}`));
      lista.append(li);
    }
    partes.push(lista);
  }
  // Justo después de los vitales (PG/CA), antes de las características.
  const vitales = ficha.querySelector('.vitales');
  if (vitales) vitales.after(...partes);
  else ficha.append(...partes);
}
