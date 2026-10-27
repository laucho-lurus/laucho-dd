// Combate en la mesa: casillas del GM, ataque del monstruo que tiene el turno, caídos y salvaciones de muerte.

const $ = (id) => document.getElementById(id);

const el = (etiqueta, clase, texto) => {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

const boton = (texto, alPulsar) => {
  const b = el('button', 'secundario', texto);
  b.type = 'button';
  b.addEventListener('click', alPulsar);
  return b;
};

function casilla(texto, marcada, alCambiar) {
  const label = el('label', 'casilla');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = marcada;
  input.addEventListener('change', () => alCambiar(input.checked));
  label.append(input, ` ${texto}`);
  return label;
}

/** Panel del GM: opciones, el ataque del monstruo en su turno y los caídos. */
export function pintarCombateGm(estado, enviar, conIa) {
  const filas = [];
  const opciones = el('div', 'fila');
  if (!conIa) opciones.append(casilla('Enemigos automáticos', estado.opciones.enemigos_auto, (v) => enviar({ tipo: 'opciones_combate', enemigos_auto: v })));
  opciones.append(casilla('Pifias con consecuencia', estado.opciones.pifias, (v) => enviar({ tipo: 'opciones_combate', pifias: v })));
  filas.push(opciones);

  const monstruo = estado.monstruos.find((m) => m.id === estado.turno_de);
  if (monstruo) {
    const fila = el('div', 'fila turno-enemigo');
    const objetivo = el('select');
    objetivo.setAttribute('aria-label', 'Objetivo del ataque');
    objetivo.append(new Option('Objetivo: el más cercano / al azar', ''), ...estado.jugadores.filter((j) => j.pg_actual > 0).map((j) => new Option(j.nombre, j.personaje_id)));
    fila.append(el('b', '', `Turno de ${monstruo.nombre}`), objetivo, boton('Atacar con este monstruo', () => {
      enviar({ tipo: 'atacar_monstruo', monstruo_id: monstruo.id, ...(objetivo.value && { objetivo_personaje: objetivo.value }) });
    }));
    filas.push(fila);
  }

  const caidos = estado.jugadores.filter((j) => j.pg_actual === 0);
  if (caidos.length) {
    const fila = el('div', 'fila');
    for (const j of caidos) {
      const m = j.muerte;
      fila.append(el('span', '', `${j.nombre}: ${m?.muerto ? 'muerto' : m?.estable ? 'estable' : `${m?.exitos ?? 0}✓ ${m?.fallos ?? 0}✗`}`));
      if (m && !m.estable && !m.muerto) fila.append(boton('Estabilizar', () => enviar({ tipo: 'estabilizar', personaje_id: j.personaje_id })));
    }
    if (caidos.length === estado.jugadores.length) fila.append(boton('Revivir al grupo (1 PG)', () => enviar({ tipo: 'revivir_grupo' })));
    filas.push(fila);
  }
  $('gm-combate').replaceChildren(...filas);
}

/** En la ficha: salvaciones de muerte del personaje a 0 PG. */
export function pintarMuerte(ficha, jugador) {
  const m = jugador.muerte;
  if (!m) return;
  const texto = m.muerto ? 'Ha muerto.' : m.estable ? 'Inconsciente, estable.' : `Inconsciente · salvaciones de muerte: ${'●'.repeat(m.exitos)}${'○'.repeat(3 - m.exitos)} éxitos, ${'●'.repeat(m.fallos)}${'○'.repeat(3 - m.fallos)} fallos (se tiran solas al empezar tu turno)`;
  const aviso = el('p', `muerte${m.muerto ? ' muerto' : ''}`, texto);
  const vitales = ficha.querySelector('.vitales');
  if (vitales) vitales.after(aviso);
  else ficha.append(aviso);
}
