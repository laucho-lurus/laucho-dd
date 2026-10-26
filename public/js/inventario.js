// Inventario y habilidades: lista en la ficha (equipar, beber, usar) y sección del GM para otorgar.

const $ = (id) => document.getElementById(id);

const el = (etiqueta, clase, texto) => {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

const boton = (texto, alPulsar, clase = 'mini') => {
  const b = el('button', clase, texto);
  b.type = 'button';
  b.addEventListener('click', alPulsar);
  return b;
};

const EQUIPABLE = ['arma', 'armadura', 'escudo'];
const ETIQUETA_TIPO = { arma: 'Armas', armadura: 'Armaduras', escudo: 'Escudos', pocion: 'Pociones', objeto: 'Objetos' };
const RECARGA = { corto: 'descanso corto', largo: 'descanso largo' };

function textoUso(h) {
  if (h.uso === 'a_voluntad') return 'A voluntad';
  const cuando = h.uso === 'una_vez' ? 'una vez' : `por ${RECARGA[h.recarga ?? 'largo']}`;
  return `${h.usos_restantes}/${h.usos_max} · ${cuando}`;
}

/**
 * Añade inventario y habilidades a la ficha. `propio`: el jugador dueño (o el GM) puede equipar y usar.
 * `esGm`: muestra ✕ para quitar.
 */
export function pintarInventario(ficha, jugador, { propio, esGm, enviar }) {
  const id = esGm ? { personaje_id: jugador.personaje_id } : {};
  const equipado = new Set(Object.values(jugador.equipo ?? {}));

  const items = el('ul', 'inventario');
  for (const i of jugador.inventario ?? []) {
    const li = el('li', equipado.has(i.instancia) ? 'equipado' : '');
    const cabeza = el('div', 'linea');
    cabeza.append(el('span', '', `${i.nombre}${i.cantidad > 1 ? ` ×${i.cantidad}` : ''}${equipado.has(i.instancia) ? ' · equipado' : ''}`));
    if (propio && EQUIPABLE.includes(i.tipo)) {
      cabeza.append(equipado.has(i.instancia)
        ? boton('Quitarse', () => enviar({ tipo: 'desequipar', ranura: i.tipo, ...id }))
        : boton('Equipar', () => enviar({ tipo: 'equipar', instancia: i.instancia, ...id })));
    }
    if (propio && i.tipo === 'pocion') cabeza.append(boton('Beber', () => enviar({ tipo: 'usar_item', instancia: i.instancia, ...id })));
    if (esGm) cabeza.append(boton('✕', () => enviar({ tipo: 'quitar', personaje_id: jugador.personaje_id, instancia: i.instancia, es: 'item' }), 'mini quitar'));
    li.append(cabeza, el('small', '', i.descripcion));
    items.append(li);
  }

  const habilidades = el('ul', 'inventario');
  for (const h of jugador.habilidades ?? []) {
    const li = el('li', h.uso !== 'a_voluntad' && h.usos_restantes === 0 ? 'gastada' : '');
    const cabeza = el('div', 'linea');
    cabeza.append(el('span', '', `${h.nombre} `), el('small', '', textoUso(h)));
    if (propio) {
      const usar = boton('Usar', () => enviar({ tipo: 'usar_habilidad', instancia: h.instancia, ...id }));
      usar.disabled = h.uso !== 'a_voluntad' && h.usos_restantes === 0;
      cabeza.append(usar);
    }
    if (esGm) cabeza.append(boton('✕', () => enviar({ tipo: 'quitar', personaje_id: jugador.personaje_id, instancia: h.instancia, es: 'habilidad' }), 'mini quitar'));
    li.append(cabeza, el('small', '', h.descripcion));
    habilidades.append(li);
  }

  ficha.append(
    el('h3', '', 'Inventario'),
    items.children.length ? items : el('p', 'sub', 'Sin objetos.'),
    el('h3', '', 'Habilidades'),
    habilidades.children.length ? habilidades : el('p', 'sub', 'Sin habilidades.'),
  );
}

let catalogo = null;

/** Opciones de objetos agrupadas por tipo (también las usa el editor). */
export function opcionesItems(items) {
  const grupos = {};
  for (const i of items) (grupos[i.tipo] ??= []).push(i);
  return Object.entries(grupos).map(([tipo, lista]) => {
    const g = document.createElement('optgroup');
    g.label = ETIQUETA_TIPO[tipo] ?? tipo;
    g.append(...lista.map((i) => new Option(i.restringido ? `${i.nombre} (poderoso)` : i.nombre, i.id)));
    return g;
  });
}

export async function cargarCatalogo() {
  if (!catalogo) {
    const r = await fetch('/api/catalogo');
    if (!r.ok) throw new Error('No se pudo cargar el catálogo');
    catalogo = await r.json();
  }
  return catalogo;
}

/** Sección "Objetos y habilidades" del panel del GM. */
export async function iniciarPanelObjetos(enviar, avisar) {
  try {
    const { items, rasgos } = await cargarCatalogo();
    $('dar-item').replaceChildren(...opcionesItems(items));
    const porClase = {};
    for (const r of Object.values(rasgos)) (porClase[r.clase] ??= []).push(r);
    $('dar-habilidad').replaceChildren(...Object.entries(porClase).map(([clase, lista]) => {
      const g = document.createElement('optgroup');
      g.label = clase;
      g.append(...lista.map((r) => new Option(r.nombre, r.id)));
      return g;
    }));
  } catch (err) {
    avisar(err.message);
  }
  const para = () => $('dar-a').value;
  const cantidad = (input) => Math.max(1, Math.min(99, Number(input.value) || 1));

  $('dar-item-boton').addEventListener('click', () =>
    enviar({ tipo: 'otorgar', personaje_id: para(), item: { item_id: $('dar-item').value, cantidad: cantidad($('dar-item-cantidad')) } }));
  $('dar-custom-boton').addEventListener('click', () => {
    const nombre = $('dar-custom-nombre').value.trim();
    if (!nombre) return avisar('Ponle nombre al objeto');
    enviar({ tipo: 'otorgar', personaje_id: para(), item: { custom: { nombre, descripcion: $('dar-custom-desc').value.trim() } } });
    $('dar-custom-nombre').value = '';
    $('dar-custom-desc').value = '';
  });
  $('dar-habilidad-boton').addEventListener('click', () =>
    enviar({ tipo: 'otorgar', personaje_id: para(), habilidad: { rasgo_id: $('dar-habilidad').value } }));
  $('dar-mov-boton').addEventListener('click', () => {
    const nombre = $('dar-mov-nombre').value.trim();
    if (!nombre) return avisar('Ponle nombre al movimiento');
    const [uso, recarga] = $('dar-mov-uso').value.split(':');
    const valor = Number($('dar-mov-valor').value) || 0;
    enviar({
      tipo: 'otorgar',
      personaje_id: para(),
      habilidad: {
        custom: {
          nombre,
          descripcion: $('dar-mov-desc').value.trim(),
          uso,
          ...(recarga && { recarga }),
          usos_max: uso === 'a_voluntad' ? 0 : cantidad($('dar-mov-usos')),
          ...(valor && { modificador: { a: $('dar-mov-a').value, valor } }),
        },
      },
    });
    $('dar-mov-nombre').value = '';
    $('dar-mov-desc').value = '';
  });
  $('descanso-corto').addEventListener('click', () => enviar({ tipo: 'descanso', descanso: 'corto' }));
  $('descanso-largo').addEventListener('click', () => enviar({ tipo: 'descanso', descanso: 'largo' }));
}

export function actualizarSelectorDar(jugadores) {
  const sel = $('dar-a');
  const elegido = sel.value;
  sel.replaceChildren(...jugadores.map((j) => new Option(j.nombre, j.personaje_id)));
  if (elegido) sel.value = elegido;
}
