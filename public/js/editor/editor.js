// Editor de campañas: estado, deshacer/rehacer, abrir, guardar, importar y exportar.
import { crearLienzo } from './lienzo.js';
import { pintarPanel, pintarVariables } from './panel.js';
import { autoDisponer, etiquetaSugerida, nuevoId, puedeConectar, TIPOS } from './tipos.js';

const $ = (id) => document.getElementById(id);
const MAX_HISTORIAL = 100;
const vacio = () => ({ id: null, nombre: 'Nueva campaña', resumen: '', diagrama: { nodos: [], flechas: [] }, variables: {} });

let estado = vacio();
let seleccion = null;
let criaturas = [];
let pasado = [];
let futuro = [];
let sinGuardar = false;

const aviso = (texto, clase = 'aviso') => {
  $('aviso').className = clase;
  $('aviso').textContent = texto;
};

const lienzo = crearLienzo($('lienzo'), {
  alSeleccionar: (sel) => {
    seleccion = sel;
    pintar();
  },
  alMover: (id, x, y) => cambiar((e) => Object.assign(e.diagrama.nodos.find((n) => n.id === id), { x, y })),
  alConectar: (desde, hasta) => {
    const motivo = puedeConectar(estado.diagrama, desde, hasta);
    if (motivo) return aviso(motivo);
    const origen = estado.diagrama.nodos.find((n) => n.id === desde);
    cambiar((e) => { e.diagrama.flechas.push({ desde, hasta, etiqueta: etiquetaSugerida(e.diagrama, origen) }); }, { tipo: 'flecha', indice: estado.diagrama.flechas.length });
  },
});

function pintar() {
  lienzo.pintar(estado.diagrama, seleccion);
  pintarPanel($('panel'), estado, seleccion, { cambiar, criaturas });
  pintarVariables($('variables'), estado, cambiar);
  pintarIntroduccion();
  $('nombre').value = estado.nombre;
  $('deshacer').disabled = pasado.length === 0;
  $('rehacer').disabled = futuro.length === 0;
  document.title = `${sinGuardar ? '• ' : ''}Editor: ${estado.nombre}`;
}

const EJEMPLO_HEROES = ['Aria', 'Borin', 'Cael'];
const listaNombres = (n) => (n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`);

/** Introducción con vista previa de la sustitución (mismo formato que el servidor). */
function pintarIntroduccion(texto = estado.diagrama.introduccion ?? '') {
  if (document.activeElement !== $('introduccion')) $('introduccion').value = texto;
  const vista = texto
    .replace(/\{h[eé]roes\}/gi, listaNombres(EJEMPLO_HEROES))
    .replace(/\{h[eé]roe_(\d+)\}/gi, (_, n) => EJEMPLO_HEROES[Number(n) - 1] ?? 'un aventurero');
  $('introduccion-vista').textContent = !texto.trim()
    ? '⚠ Falta la introducción: se lee al empezar la partida.'
    : /\{h[eé]roe(s|_\d+)\}/i.test(texto) ? `Vista previa: ${vista}` : `⚠ No nombra a los héroes (usa {heroes}). Vista previa: ${vista}`;
}

/** Aplica `fn` sobre una copia del estado y guarda el anterior para deshacer. */
function cambiar(fn, nuevaSeleccion = seleccion) {
  const copia = structuredClone(estado);
  fn(copia);
  pasado = [...pasado.slice(-MAX_HISTORIAL + 1), estado];
  futuro = [];
  estado = copia;
  seleccion = nuevaSeleccion;
  sinGuardar = true;
  pintar();
}

function moverHistorial(desde, hacia) {
  if (!desde.length) return;
  hacia.push(estado);
  estado = desde.pop();
  seleccion = null;
  sinGuardar = true;
  pintar();
}
const deshacer = () => moverHistorial(pasado, futuro);
const rehacer = () => moverHistorial(futuro, pasado);

function cargar(campana) {
  estado = { ...vacio(), ...campana, diagrama: autoDisponer(campana.diagrama ?? { nodos: [], flechas: [] }) };
  pasado = [];
  futuro = [];
  seleccion = null;
  sinGuardar = false;
  pintar();
  lienzo.encuadrar();
}

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error ?? 'Error del servidor');
  return datos;
}

async function listarCampanas(elegida) {
  const { campanas } = await pedir('/api/campanas');
  $('campana').replaceChildren(new Option('— elige —', ''), ...campanas.map((c) => new Option(c.nombre, c.id)));
  if (elegida) $('campana').value = elegida;
}

async function abrir(id) {
  if (sinGuardar && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return void ($('campana').value = estado.id ?? '');
  try {
    const [{ campana }, lista] = await Promise.all([pedir(`/api/campanas/${encodeURIComponent(id)}`), pedir(`/api/criaturas?campana=${encodeURIComponent(id)}`)]);
    criaturas = lista.criaturas;
    cargar(campana);
    aviso('');
  } catch (err) {
    aviso(`No se pudo abrir: ${err.message}`);
  }
}

const cuerpo = () => JSON.stringify({ id: estado.id ?? undefined, nombre: estado.nombre, resumen: estado.resumen, diagrama: estado.diagrama, variables: estado.variables });

async function guardar() {
  try {
    const { campana, avisos } = await pedir('/api/campanas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo() });
    estado = { ...estado, id: campana.id };
    sinGuardar = false;
    await listarCampanas(campana.id);
    pintar();
    mostrarAvisos(avisos, `Guardada ✓ ${campana.nombre}`);
  } catch (err) {
    aviso(`No se pudo guardar: ${err.message}`);
  }
}

async function validar() {
  try {
    const { avisos } = await pedir('/api/campanas/validar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo() });
    mostrarAvisos(avisos, 'Sin avisos ✓');
  } catch (err) {
    aviso(err.message);
  }
}

function mostrarAvisos(avisos, siNoHay) {
  if (!avisos.length) return aviso(siNoHay, 'exito-creacion');
  $('aviso').className = 'aviso';
  $('aviso').replaceChildren(`${siNoHay.startsWith('Guardada') ? `${siNoHay}, con avisos:` : 'Avisos:'}`, ...avisos.map((a) => Object.assign(document.createElement('div'), { textContent: `· ${a}` })));
}

function agregarNodo(tipo) {
  const id = nuevoId(estado.diagrama);
  const centro = { x: 80 + (estado.diagrama.nodos.length % 5) * 40, y: 80 + (estado.diagrama.nodos.length % 7) * 30 };
  cambiar((e) => { e.diagrama.nodos.push({ id, tipo, titulo: TIPOS[tipo].nombre, texto: '', notas: '', ...centro }); }, { tipo: 'nodo', id });
}

function exportar() {
  const blob = new Blob([JSON.stringify({ nombre: estado.nombre, resumen: estado.resumen, variables: estado.variables, diagrama: estado.diagrama }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${estado.nombre.replace(/[^\w-]+/g, '_') || 'campana'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importar(archivo) {
  try {
    const datos = JSON.parse(await archivo.text());
    if (!Array.isArray(datos?.diagrama?.nodos) || !Array.isArray(datos?.diagrama?.flechas)) throw new Error('falta "diagrama" con "nodos" y "flechas"');
    cargar({ ...datos, id: null }); // se guarda como campaña nueva
    sinGuardar = true;
    pintar();
    aviso('Importada. Pulsa Guardar para crearla como campaña nueva.', 'exito-creacion');
  } catch (err) {
    aviso(`No se pudo importar: ${err.message}`);
  }
}

$('campana').addEventListener('change', () => $('campana').value && abrir($('campana').value));
$('nueva').addEventListener('click', () => {
  if (sinGuardar && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
  cargar(vacio());
  $('campana').value = '';
});
$('nombre').addEventListener('change', () => cambiar((e) => { e.nombre = $('nombre').value.trim() || 'Sin nombre'; }));
$('introduccion').addEventListener('change', () => cambiar((e) => { e.diagrama.introduccion = $('introduccion').value.trim() || undefined; }));
$('introduccion').addEventListener('input', () => pintarIntroduccion($('introduccion').value)); // vista previa en vivo, sin historial
$('guardar').addEventListener('click', guardar);
$('validar').addEventListener('click', validar);
$('exportar').addEventListener('click', exportar);
$('importar').addEventListener('change', () => $('importar').files[0] && importar($('importar').files[0]));
$('deshacer').addEventListener('click', deshacer);
$('rehacer').addEventListener('click', rehacer);
$('centrar').addEventListener('click', () => lienzo.encuadrar());
$('nuevos').replaceChildren(...Object.entries(TIPOS).map(([tipo, t]) => {
  const b = Object.assign(document.createElement('button'), { className: 'secundario', textContent: `${t.icono} ${t.nombre}`, title: `Añadir ${t.nombre.toLowerCase()}` });
  b.addEventListener('click', () => agregarNodo(tipo));
  return b;
}));
document.addEventListener('keydown', (ev) => {
  const escribiendo = ev.target instanceof Element && ev.target.closest('input, textarea');
  if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z' || escribiendo) return;
  ev.preventDefault();
  (ev.shiftKey ? rehacer : deshacer)();
});
window.addEventListener('beforeunload', (ev) => {
  if (sinGuardar) ev.preventDefault();
});

listarCampanas()
  .then(() => pedir('/api/criaturas'))
  .then((r) => { criaturas = r.criaturas; })
  .catch((err) => aviso(`No se pudieron cargar las campañas: ${err.message}`));
pintar();
