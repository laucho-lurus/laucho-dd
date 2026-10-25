// Mesa narrativa: entrada a la sala y juego.
import { conectar } from './conexion.js';
import { agregarEvento, pintarEnemigos, pintarFicha, pintarRetratos } from './vista.js';
import { detenerGiro, empezarGiro, mostrarResultado } from './dados.js';
import { agregarChat, iniciarChat } from './chat.js';

const LARGO_CODIGO = 6;
const claveToken = (codigo) => `gm-token:${codigo}`;

// El token del GM se guarda en este navegador para poder volver a entrar (el servidor solo guarda su hash).
function guardarToken(codigo, token) {
  try {
    localStorage.setItem(claveToken(codigo), token);
  } catch {
    // modo privado o almacenamiento bloqueado: no se podrá volver a entrar como GM desde aquí
  }
}

function tokenGuardado(codigo) {
  try {
    return localStorage.getItem(claveToken(codigo));
  } catch {
    return null;
  }
}
const $ = (id) => document.getElementById(id);

let estado = null;
let miRol = null; // { rol: 'gm' } | { rol: 'jugador', personaje_id }

const servidor = conectar(recibir, () => aviso('Se perdió la conexión. Recarga la página para volver.'));
servidor.enviar({ tipo: 'ver_campanas' });
iniciarChat((m) => servidor.enviar(m));

const nombreDe = (id) => estado?.jugadores.find((j) => j.personaje_id === id)?.nombre ?? '—';
const enMesa = () => miRol !== null;
const aviso = (texto) => {
  $(enMesa() ? 'aviso' : 'aviso-entrada').textContent = texto;
};

function recibir(m) {
  switch (m.tipo) {
    case 'campanas':
      $('campana').replaceChildren(...m.campanas.map((c) => new Option(c.nombre, c.id)));
      $('gm-tipo').replaceChildren(
        new Option('GM: humano', ''),
        ...(m.ia_disponible ? m.perfiles.map((p) => new Option(`GM IA: ${p.nombre} — ${p.descripcion}`, p.id)) : []),
      );
      $('ia-info').textContent = m.ia_disponible ? 'Con GM IA tú sigues al mando: puedes pausarla o corregirla.' : 'GM IA no disponible (falta la clave de Anthropic en el servidor).';
      return;
    case 'panel_gm':
      return pintarPanel(m);
    case 'personajes':
      return mostrarPersonajes(m.personajes);
    case 'sesion_creada':
      guardarToken(m.codigo, m.token_gm);
      entrar({ rol: 'gm' }, m.estado, []);
      return aviso(`Sala creada. Comparte el código ${m.codigo} con tus jugadores.`);
    case 'bienvenida':
      return entrar(m.rol === 'gm' ? { rol: 'gm' } : { rol: 'jugador', personaje_id: m.personaje_id }, m.estado, m.historial);
    case 'evento':
      actualizar(m.estado);
      if (m.evento.tipo === 'chat') return agregarChat(m.evento);
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
  historial.forEach((e) => (e.tipo === 'chat' ? agregarChat(e, true) : agregarEvento(e, nombreDe)));
}

function actualizar(nuevoEstado) {
  estado = nuevoEstado;
  $('que-sigue').textContent = estado.que_sigue ?? '';
  pintarEnemigos(estado.monstruos);
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

/** Panel privado del GM: gasto y estado de la IA, nodo actual y sus notas. */
const ESPERA_IA_MS = 45_000;
let relojIa = null;

function pintarPanel(p) {
  // Red de seguridad en el navegador: si no llega respuesta, no quedarse en "pensando…".
  clearTimeout(relojIa);
  if (p.ia?.pensando) relojIa = setTimeout(() => pintarPanel({ ...p, ia: { ...p.ia, pensando: false } }), ESPERA_IA_MS);
  $('panel-gm').hidden = false;
  const ia = p.ia;
  const estado = $('ia-estado');
  estado.className = `ia-estado${p.gasto?.nivel === 'aviso' ? ' aviso-gasto' : p.gasto?.nivel === 'agotado' ? ' agotado' : ''}`;
  const usd = (n) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  const gasto = p.gasto ? `IA: ${usd(p.gasto.gastado)} de $${p.gasto.tope.toFixed(2)}` : 'IA no disponible';
  estado.textContent = ia ? `${gasto} · ${ia.perfil} · ${ia.pensando ? 'pensando…' : ia.pausada ? 'pausada' : 'activa'}` : `${gasto} · GM humano`;
  $('narrar-escena').hidden = $('pausar-ia').hidden = $('deshacer-ia').hidden = $('etiqueta-ia-pg').hidden = !ia;
  if (ia) {
    $('pausar-ia').textContent = ia.pausada ? 'Reanudar IA' : 'Pausar IA';
    $('pausar-ia').dataset.pausada = ia.pausada;
    $('narrar-escena').disabled = ia.pausada || ia.pensando;
    $('deshacer-ia').disabled = !ia.puede_deshacer;
    $('ia-pg').checked = ia.puede_pg;
  }
  pintarMonstruosGm(p.monstruos ?? []);
  const elegida = $('criatura').value;
  $('criatura').replaceChildren(...(p.criaturas ?? []).map((c) => new Option(c.nombre, c.srd_clave)));
  if (elegida) $('criatura').value = elegida;
  $('avisos-base').hidden = !p.avisos?.length;
  $('avisos-base').textContent = (p.avisos ?? []).join(' · ');
  $('nodo').replaceChildren(...p.nodos.map((n) => new Option(`${n.id}. ${n.titulo}`, n.id)));
  if (p.nodo) $('nodo').value = p.nodo.id;
  $('notas-nodo').textContent = p.nodo ? `Notas: ${p.nodo.notas || '—'} · Salidas: ${p.salidas.map((s) => `${s.hasta} (${s.etiqueta})`).join(', ') || 'ninguna'}` : '';
}

/** Solo el GM ve los PG exactos de los monstruos y puede tocarlos. */
function pintarMonstruosGm(monstruos) {
  $('gm-monstruos').replaceChildren(...monstruos.map((m) => {
    const caja = document.createElement('span');
    caja.className = 'gm-monstruo';
    const cantidad = Object.assign(document.createElement('input'), { type: 'number', min: 1, value: 1 });
    cantidad.setAttribute('aria-label', `Cantidad para ${m.nombre}`);
    const boton = (texto, titulo, alHacer) => {
      const b = Object.assign(document.createElement('button'), { textContent: texto, title: titulo, className: 'secundario' });
      b.addEventListener('click', alHacer);
      return b;
    };
    const pg = (signo) => () => {
      const n = Math.abs(parseInt(cantidad.value, 10));
      if (n) servidor.enviar({ tipo: 'monstruo_pg', monstruo_id: m.id, cantidad: signo * n });
    };
    caja.append(
      `${m.nombre} ${m.pg_actual}/${m.pg_max} PG · CA ${m.ca}`,
      boton('−', 'Daño', pg(-1)), cantidad, boton('+', 'Curación', pg(1)),
      boton('✕', 'Quitar del encuentro', () => servidor.enviar({ tipo: 'quitar_monstruo', monstruo_id: m.id })),
    );
    return caja;
  }));
}

$('agregar-monstruos').addEventListener('click', () =>
  servidor.enviar({ tipo: 'agregar_monstruos', srd_clave: $('criatura').value, cantidad: parseInt($('criatura-cantidad').value, 10) || 1 }));
$('narrar-escena').addEventListener('click', () => servidor.enviar({ tipo: 'narrar_escena' }));
$('pausar-ia').addEventListener('click', () => servidor.enviar({ tipo: 'pausar_ia', pausada: $('pausar-ia').dataset.pausada !== 'true' }));
$('ia-pg').addEventListener('change', () => servidor.enviar({ tipo: 'ia_permitir_pg', permitido: $('ia-pg').checked }));
$('deshacer-ia').addEventListener('click', () => servidor.enviar({ tipo: 'deshacer_ia' }));
$('nodo').addEventListener('change', () => servidor.enviar({ tipo: 'cambiar_nodo', nodo_id: $('nodo').value }));

const codigoEscrito = () => $('codigo').value.replace(/\s/g, '').toUpperCase();

$('codigo').addEventListener('input', () => {
  $('etiqueta-personaje').hidden = $('unirse').hidden = $('sin-personajes').hidden = true;
  $('entrar-gm').hidden = !(codigoEscrito().length === LARGO_CODIGO && tokenGuardado(codigoEscrito()));
  if (codigoEscrito().length === LARGO_CODIGO) servidor.enviar({ tipo: 'ver_personajes', codigo: codigoEscrito() });
});
$('unirse').addEventListener('click', () =>
  servidor.enviar({ tipo: 'unirse', codigo: codigoEscrito(), personaje_id: $('personaje').value }));
$('entrar-gm').addEventListener('click', () =>
  servidor.enviar({ tipo: 'retomar_gm', codigo: codigoEscrito(), token_gm: tokenGuardado(codigoEscrito()) }));
$('crear').addEventListener('click', () =>
  servidor.enviar({ tipo: 'crear_sesion', campana_id: $('campana').value, gm_perfil_id: $('gm-tipo').value || undefined }));

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
  $('pedir-motivo').placeholder = tipo === 'libre' ? 'Para qué es (obligatorio)' : 'Motivo (opcional)';
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
  const motivo = $('pedir-motivo').value.trim();
  // En "Personalizada" el GM debe decir para qué es; en los dados sueltos se rellena solo.
  if (tipo === 'libre' && motivo.length < 8) return null;
  return { ...base, notacion, motivo: motivo || (notacion.includes('d20') ? 'Tirada de d20' : `Tirada de ${notacion}`) };
}
$('pedir-enviar').addEventListener('click', () => {
  const peticion = peticionElegida();
  if (!peticion) return aviso('Escribe para qué es la tirada (mín. 8 caracteres), p. ej. "Daño del estoque al kobold".');
  servidor.enviar(peticion);
});
$('turno').addEventListener('click', () => servidor.enviar({ tipo: 'siguiente_turno' }));
