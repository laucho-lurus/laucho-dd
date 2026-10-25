// Dibujo de la mesa: retratos, narración y ficha.

const $ = (id) => document.getElementById(id);

const el = (etiqueta, clase, texto) => {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

const iniciales = (nombre) => nombre.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const modificador = (valor) => {
  const m = Math.floor((valor - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
};
const NOMBRES_CAR = { fue: 'FUE', des: 'DES', con: 'CON', int: 'INT', sab: 'SAB', car: 'CAR' };

export function pintarRetratos(estado) {
  const retratos = estado.jugadores.map((j) => {
    const r = el('div', 'retrato');
    r.classList.toggle('turno', j.personaje_id === estado.turno_de);
    r.classList.toggle('desconectado', !j.conectado);
    r.title = `${j.nombre} — ${j.pg_actual}/${j.pg_max} PG`;
    const vida = el('div', 'vida');
    const porcentaje = Math.max(0, Math.min(100, (j.pg_actual / j.pg_max) * 100));
    vida.classList.toggle('baja', porcentaje <= 30);
    const barra = el('span');
    barra.style.width = `${porcentaje}%`;
    vida.append(barra);
    r.append(el('div', 'circulo', iniciales(j.nombre)), el('div', 'nombre', j.nombre), vida);
    return r;
  });
  $('retratos').replaceChildren(...retratos);
  $('titulo-campana').textContent = estado.campana.nombre;
  $('codigo-sala').textContent = estado.codigo;
  $('ronda').textContent = estado.ronda;
}

export function pintarFicha(jugador) {
  const ficha = $('ficha');
  if (!jugador) {
    ficha.replaceChildren(el('p', 'sub', 'Aún no hay jugadores en la mesa.'));
    return;
  }
  const vitales = el('div', 'vitales');
  for (const [etiqueta, valor] of [['PG', `${jugador.pg_actual}/${jugador.pg_max}`], ['CA', jugador.ca ?? '—']]) {
    const d = el('div', '', etiqueta);
    d.prepend(el('b', '', valor));
    vitales.append(d);
  }
  const car = el('div', 'caracteristicas');
  for (const [clave, nombre] of Object.entries(NOMBRES_CAR)) {
    const valor = jugador.caracteristicas[clave];
    const d = el('div', '', `${nombre} ${valor}`);
    d.prepend(el('b', '', modificador(valor)));
    car.append(d);
  }
  const armas = el('ul', 'armas');
  for (const a of jugador.armas) {
    const li = el('li', '', `${a.nombre} `);
    li.append(el('small', '', `${a.ataque} · ${a.dano}`));
    armas.append(li);
  }
  ficha.replaceChildren(
    el('h2', '', jugador.nombre),
    el('div', 'sub', `${jugador.raza} · ${jugador.clase} ${jugador.nivel}`),
    vitales,
    car,
    armas,
  );
}

export function agregarEvento(evento, nombreDe) {
  const d = evento.datos;
  const quien = d.personaje_nombre ?? 'Sistema';
  let p;
  switch (evento.tipo) {
    case 'mensaje':
      p = el('p', 'gm', d.texto);
      break;
    case 'accion':
      p = el('p', 'accion', ` ${d.texto}`);
      p.prepend(el('span', 'quien', `${quien}:`));
      break;
    case 'tirada':
      p = el('p', 'tirada', `🎲 ${quien} tira ${d.notation}${d.motivo ? ` (${d.motivo})` : ''}: ${desglose(d)}`);
      break;
    default:
      p = el('p', 'sistema', textoDeEstado(d, nombreDe));
  }
  const narracion = $('narracion');
  narracion.append(p);
  narracion.scrollTop = narracion.scrollHeight;
}

/** "[4, 2] +3 = 9" */
export function desglose(tirada) {
  const mod = tirada.modifier ? ` ${tirada.modifier > 0 ? '+' : '−'}${Math.abs(tirada.modifier)}` : '';
  return `[${tirada.kept.join(', ')}]${mod} = ${tirada.total}`;
}

function textoDeEstado(d, nombreDe) {
  if (d.cambio === 'entra') return `${d.personaje_nombre} se sienta a la mesa.`;
  if (d.cambio === 'turno') return `— Turno de ${nombreDe(d.turno_de)} · ronda ${d.ronda} —`;
  return '— Nuevo orden de turnos —';
}
