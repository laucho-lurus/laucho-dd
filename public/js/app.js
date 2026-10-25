// Mesa narrativa: entrada a la sala y juego.
import { conectar } from './conexion.js';
import { agregarEvento, pintarFicha, pintarRetratos } from './vista.js';
import { detenerGiro, empezarGiro, mostrarResultado } from './dados.js';

const LARGO_CODIGO = 6;
const $ = (id) => document.getElementById(id);

let estado = null;
let miRol = null; // { rol: 'gm' } | { rol: 'jugador', personaje_id }

const servidor = conectar(recibir, () => aviso('Se perdió la conexión. Recarga la página para volver.'));
servidor.enviar({ tipo: 'ver_campanas' });

const nombreDe = (id) => estado?.jugadores.find((j) => j.personaje_id === id)?.nombre ?? '—';
const enMesa = () => miRol !== null;
const aviso = (texto) => {
  $(enMesa() ? 'aviso' : 'aviso-entrada').textContent = texto;
};

function recibir(m) {
  switch (m.tipo) {
    case 'campanas':
      $('campana').replaceChildren(...m.campanas.map((c) => new Option(c.nombre, c.id)));
      return;
    case 'personajes':
      return mostrarPersonajes(m.personajes);
    case 'sesion_creada':
      entrar({ rol: 'gm' }, m.estado, []);
      return aviso(`Sala creada. Comparte el código ${m.codigo} con tus jugadores.`);
    case 'bienvenida':
      return entrar(m.rol === 'gm' ? { rol: 'gm' } : { rol: 'jugador', personaje_id: m.personaje_id }, m.estado, m.historial);
    case 'evento':
      actualizar(m.estado);
      agregarEvento(m.evento, nombreDe);
      if (m.evento.tipo === 'tirada') mostrarResultado(m.evento.datos);
      return;
    case 'estado':
      return actualizar(m.estado);
    case 'error':
      detenerGiro();
      return aviso(m.mensaje);
  }
}

function mostrarPersonajes(personajes) {
  aviso('');
  const ninguno = personajes.length === 0;
  $('sin-personajes').hidden = !ninguno;
  if (ninguno) return;
  $('personaje').replaceChildren(...personajes.map((p) => {
    const o = new Option(`${p.nombre} — ${p.raza} ${p.clase} ${p.nivel}${p.ocupado ? ' (ocupado)' : ''}`, p.id);
    o.disabled = p.ocupado;
    return o;
  }));
  $('etiqueta-personaje').hidden = $('unirse').hidden = false;
}

function entrar(rol, nuevoEstado, historial) {
  miRol = rol;
  $('entrada').hidden = true;
  $('mesa').hidden = false;
  const esGm = rol.rol === 'gm';
  $('turno').hidden = $('pedir').hidden = $('dados-libres').hidden = !esGm;
  $('texto').placeholder = rol.rol === 'gm' ? 'Narra la escena…' : '¿Qué haces?';
  actualizar(nuevoEstado);
  historial.forEach((e) => agregarEvento(e, nombreDe));
}

function actualizar(nuevoEstado) {
  estado = nuevoEstado;
  const esGm = miRol?.rol === 'gm';
  pintarRetratos(estado, esGm ? (personaje_id, cantidad) => servidor.enviar({ tipo: 'aplicar_pg', personaje_id, cantidad }) : null);
  if (esGm) actualizarSelectorPedir();
  else mostrarPeticion(estado.jugadores.find((j) => j.personaje_id === miRol?.personaje_id)?.tirada_pendiente);
  const id = estado.turno_de ?? miRol?.personaje_id;
  pintarFicha(estado.jugadores.find((j) => j.personaje_id === id) ?? estado.jugadores[0]);
}

function actualizarSelectorPedir() {
  const sel = $('pedir-a');
  const elegido = sel.value;
  sel.replaceChildren(...estado.jugadores.map((j) => new Option(j.nombre, j.personaje_id)));
  if (elegido) sel.value = elegido;
}

let peticion = null;
function mostrarPeticion(p) {
  peticion = p ?? null;
  $('peticion').hidden = !peticion;
  if (peticion) $('texto-peticion').textContent = `El GM te pide una tirada${peticion.motivo ? ` de ${peticion.motivo}` : ''} (${peticion.notacion})`;
}

const codigoEscrito = () => $('codigo').value.replace(/\s/g, '').toUpperCase();

$('codigo').addEventListener('input', () => {
  $('etiqueta-personaje').hidden = $('unirse').hidden = $('sin-personajes').hidden = true;
  if (codigoEscrito().length === LARGO_CODIGO) servidor.enviar({ tipo: 'ver_personajes', codigo: codigoEscrito() });
});
$('unirse').addEventListener('click', () =>
  servidor.enviar({ tipo: 'unirse', codigo: codigoEscrito(), personaje_id: $('personaje').value }));
$('crear').addEventListener('click', () => servidor.enviar({ tipo: 'crear_sesion', campana_id: $('campana').value }));

function enviarTexto() {
  const texto = $('texto').value.trim();
  if (!texto) return;
  aviso('');
  servidor.enviar({ tipo: miRol.rol === 'gm' ? 'narracion' : 'accion', texto });
  $('texto').value = '';
}
$('enviar').addEventListener('click', enviarTexto);
$('texto').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarTexto();
  }
});

function tirar(notacion) {
  if (!notacion) return;
  aviso('');
  empezarGiro();
  servidor.enviar({ tipo: 'tirar', notacion });
}
document.querySelectorAll('[data-dado]').forEach((b) => b.addEventListener('click', () => tirar(b.dataset.dado)));
$('tirar').addEventListener('click', () => tirar($('notacion').value.trim()));
$('tirar-peticion').addEventListener('click', () => peticion && tirar(peticion.notacion));
$('pedir-tipo').addEventListener('change', () => {
  const tipo = $('pedir-tipo').value;
  $('pedir-notacion').hidden = tipo !== 'libre';
  $('pedir-motivo').hidden = tipo.startsWith('chequeo:');
});
$('pedir-cd-tipo').addEventListener('change', () => {
  $('pedir-cd').hidden = $('pedir-cd-tipo').value !== 'libre';
});

/** Mensaje pedir_tirada según los dropdowns: chequeo (el servidor calcula la notación), dado suelto o libre. */
function peticionElegida() {
  const tipo = $('pedir-tipo').value;
  const cdElegida = $('pedir-cd-tipo').value;
  const cd = parseInt(cdElegida === 'libre' ? $('pedir-cd').value : cdElegida, 10);
  const base = { tipo: 'pedir_tirada', personaje_id: $('pedir-a').value, cd: Number.isNaN(cd) ? undefined : cd };
  if (tipo.startsWith('chequeo:')) return { ...base, chequeo: tipo.slice('chequeo:'.length) };
  const notacion = tipo === 'libre' ? $('pedir-notacion').value.trim() : tipo.slice('dado:'.length);
  return { ...base, notacion, motivo: $('pedir-motivo').value.trim() || undefined };
}
$('pedir-enviar').addEventListener('click', () => servidor.enviar(peticionElegida()));
$('turno').addEventListener('click', () => servidor.enviar({ tipo: 'siguiente_turno' }));
