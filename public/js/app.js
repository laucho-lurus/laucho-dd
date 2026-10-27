// Mesa narrativa: entrada a la sala y juego.
import { conectar } from './conexion.js';
import { agregarEvento, pintarEnemigos, pintarFicha, pintarRetratos } from './vista.js';
import { detenerGiro, empezarGiro, mostrarResultado } from './dados.js';
import { agregarChat, iniciarChat } from './chat.js';
import { crearLienzo } from './editor/lienzo.js';
import { crearMapaTactico } from './mapa.js';
import { autoDisponer } from './editor/tipos.js';
import { actualizarSelectorDar, iniciarPanelObjetos, pintarInventario } from './inventario.js';
import { pintarMagia } from './magia.js';
import { pintarCombateGm, pintarMuerte } from './combate.js';

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
let iaEnSala = false; // la sala tiene GM IA (los enemigos atacan solos)

const servidor = conectar(recibir, () => aviso('Se perdió la conexión. Recarga la página para volver.'));
// Modo GM: la misma página servida en la ruta del GM (/gm o GM_RUTA) con <body data-modo="gm">.
const MODO_GM = document.body.dataset.modo === 'gm';
$('tarjeta-gm').hidden = !MODO_GM;
if (MODO_GM) servidor.enviar({ tipo: 'ver_campanas' });
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
    case 'mapa_gm':
      mapaGm = m.mapa;
      return pintarMapa();
    case 'diagrama':
      return mostrarDiagrama(m);
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

let panelObjetosListo = false;

function entrar(rol, nuevoEstado, historial) {
  miRol = rol;
  $('entrada').hidden = true;
  $('mesa').hidden = false;
  const esGm = rol.rol === 'gm';
  if (esGm && !panelObjetosListo) {
    panelObjetosListo = true;
    void iniciarPanelObjetos((m) => servidor.enviar(m), aviso);
  }
  $('turno').hidden = $('pedir').hidden = $('dados-libres').hidden = !esGm;
  $('texto').placeholder = rol.rol === 'gm' ? 'Narra la escena…' : '¿Qué haces?';
  actualizar(nuevoEstado);
  historial.forEach((e) => (e.tipo === 'chat' ? agregarChat(e, true) : agregarEvento(e, nombreDe)));
}

function actualizar(nuevoEstado) {
  estado = nuevoEstado;
  pintarMapa();
  $('que-sigue').textContent = estado.que_sigue ?? '';
  pintarEnemigos(estado.monstruos);
  const esGm = miRol?.rol === 'gm';
  pintarRetratos(estado, esGm ? (personaje_id, cantidad) => servidor.enviar({ tipo: 'aplicar_pg', personaje_id, cantidad }) : null);
  if (esGm) {
    actualizarSelectorPedir();
    actualizarSelectorDar(estado.jugadores);
    pintarCombateGm(estado, (m) => servidor.enviar(m), iaEnSala);
  } else mostrarPeticion(estado.jugadores.find((j) => j.personaje_id === miRol?.personaje_id)?.tirada_pendiente);
  // El jugador ve siempre su ficha (su inventario); el GM, la de quien tiene el turno.
  const id = esGm ? estado.turno_de : miRol?.personaje_id;
  const jugador = estado.jugadores.find((j) => j.personaje_id === id) ?? estado.jugadores[0];
  pintarFicha(jugador);
  if (jugador) {
    const propio = esGm || jugador.personaje_id === miRol?.personaje_id;
    pintarInventario($('ficha'), jugador, { propio, esGm, enviar: (m) => servidor.enviar(m) });
    // Lanzar es cosa del jugador: el GM ve los hechizos pero no los lanza.
    pintarMuerte($('ficha'), jugador);
    pintarMagia($('ficha'), jugador, { propio: !esGm && propio, monstruos: estado.monstruos, jugadores: estado.jugadores, enviar: (m) => servidor.enviar(m) });
  }
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
  iaEnSala = Boolean(ia);
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
  pintarImagenesNodo(p.imagenes_nodo ?? []);
  pintarIntroduccionGm(p.introduccion);
  const fondoActual = (mapaGm ?? estado?.mapa)?.fondo_url ?? '';
  $('mapa-fondos').replaceChildren(new Option('— sin fondo —', ''), ...(p.fondos ?? []).map((f) => new Option(f.nombre, f.url)));
  $('mapa-fondos').value = fondoActual;
  monstruosGm = p.monstruos ?? [];
  if (p.mapa !== undefined) mapaGm = p.mapa;
  pintarMapa();
  const elegida = $('criatura').value;
  $('criatura').replaceChildren(...(p.criaturas ?? []).map((c) => new Option(c.nombre, c.srd_clave)));
  if (elegida) $('criatura').value = elegida;
  $('avisos-base').hidden = !p.avisos?.length;
  $('avisos-base').textContent = (p.avisos ?? []).join(' · ');
  $('nodo').replaceChildren(...p.nodos.map((n) => new Option(`${n.id}. ${n.titulo}`, n.id)));
  if (p.nodo) $('nodo').value = p.nodo.id;
  $('notas-nodo').textContent = p.nodo ? `Notas: ${p.nodo.notas || '—'} · Salidas: ${p.salidas.map((s) => `${s.hasta} (${s.etiqueta})`).join(', ') || 'ninguna'}` : '';
}

/** Introducción: el GM la ve con los nombres, la edita para esta sesión y la muestra (o vuelve a mostrar). */
let plantillaIntro = null;
function pintarIntroduccionGm(intro) {
  if (!intro) return;
  const editando = document.activeElement === $('intro-texto');
  if (!editando && intro.plantilla !== plantillaIntro) $('intro-texto').value = intro.plantilla ?? '';
  plantillaIntro = intro.plantilla;
  $('intro-vista').textContent = intro.vista ? `Se verá así: ${intro.vista}` : 'Esta campaña no tiene introducción: escríbela aquí (con {heroes}).';
  $('intro-estado').textContent = intro.mostrada ? '· ya mostrada' : '· sin mostrar';
  $('intro-mostrar').textContent = intro.mostrada ? 'Volver a mostrar' : 'Mostrar a los jugadores';
}
$('intro-mostrar').addEventListener('click', () => {
  const texto = $('intro-texto').value.trim();
  servidor.enviar(texto && texto !== plantillaIntro ? { tipo: 'mostrar_introduccion', texto } : { tipo: 'mostrar_introduccion' });
});

/** Imágenes de la escena actual (y su PNJ): el GM decide cuándo enseñarlas. */
function pintarImagenesNodo(imagenes) {
  $('imagenes-nodo').replaceChildren(...imagenes.map((i) => {
    const f = document.createElement('figure');
    const img = Object.assign(document.createElement('img'), { src: i.url, alt: i.nombre });
    const b = Object.assign(document.createElement('button'), { className: 'secundario', textContent: 'Mostrar a los jugadores' });
    b.addEventListener('click', () => servidor.enviar({ tipo: 'mostrar_imagen', url: i.url, titulo: i.nombre.replace(/^(Escena|PNJ): /, '') }));
    f.append(img, i.nombre, b);
    return f;
  }));
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
      ...(m.imagen_url ? [Object.assign(document.createElement('img'), { src: m.imagen_url, alt: '' })] : []),
      `${m.nombre} ${m.pg_actual}/${m.pg_max} PG · CA ${m.ca}`,
      boton('−', 'Daño', pg(-1)), cantidad, boton('+', 'Curación', pg(1)),
      boton('✕', 'Quitar del encuentro', () => servidor.enviar({ tipo: 'quitar_monstruo', monstruo_id: m.id })),
    );
    return caja;
  }));
}

$('agregar-monstruos').addEventListener('click', () =>
  servidor.enviar({ tipo: 'agregar_monstruos', srd_clave: $('criatura').value, cantidad: parseInt($('criatura-cantidad').value, 10) || 1 }));
// Mapa táctico: el GM usa el mapa completo (con monstruos bajo la niebla); los jugadores, el del estado.
let mapaGm = null;
let monstruosGm = [];
const mapaTactico = crearMapaTactico({
  canvas: $('mapa'),
  info: $('mapa-info'),
  bandeja: $('mapa-bandeja'),
  enviar: (m) => servidor.enviar(m),
  esGm: () => miRol?.rol === 'gm',
  miId: () => miRol?.personaje_id ?? null,
  modoNiebla: () => $('mapa-niebla').value,
});

function pintarMapa() {
  if (!estado) return;
  const esGm = miRol?.rol === 'gm';
  $('mapa-gm').hidden = !esGm;
  const hay = mapaTactico.actualizar(esGm ? mapaGm ?? estado.mapa : estado.mapa, estado.jugadores, esGm && monstruosGm.length ? monstruosGm : estado.monstruos);
  $('mapa-vacio').hidden = hay;
  $('mapa').hidden = !hay;
}

$('mapa-aplicar').addEventListener('click', () => servidor.enviar({
  tipo: 'mapa_configurar',
  ancho: parseInt($('mapa-ancho').value, 10),
  alto: parseInt($('mapa-alto').value, 10),
  velocidad: parseInt($('mapa-velocidad').value, 10),
}));
$('mapa-fondo').addEventListener('change', async () => {
  const archivo = $('mapa-fondo').files[0];
  if (!archivo) return;
  if (archivo.size > 2 * 1024 * 1024) return aviso('La imagen del mapa supera 2 MB.');
  const lector = new FileReader();
  lector.onload = async () => {
    try {
      // Con la campaña, el fondo queda guardado y se puede volver a elegir en el desplegable.
      const cuerpo = { imagen: lector.result, campana_id: estado?.campana.id, nombre: archivo.name.replace(/\.[^.]+$/, '') };
      const r = await fetch('/api/mapas/fondo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const datos = await r.json();
      if (!r.ok) return aviso(datos.error ?? 'No se pudo subir la imagen.');
      servidor.enviar({ tipo: 'mapa_fondo', url: datos.url });
    } catch {
      aviso('No se pudo subir la imagen.');
    }
  };
  lector.readAsDataURL(archivo);
});
$('mapa-fondos').addEventListener('change', () => servidor.enviar({ tipo: 'mapa_fondo', url: $('mapa-fondos').value || null }));
for (const b of document.querySelectorAll('[data-centro]')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('[data-centro]')) x.classList.toggle('activa', x === b);
    $('narracion').hidden = b.dataset.centro !== 'narracion';
    $('mapa-zona').hidden = b.dataset.centro !== 'mapa-zona';
    pintarMapa();
  });
}

// Diagrama en solo lectura: el GM ve dónde está la partida y salta a otro nodo con un clic.
let lienzoGm = null;
function mostrarDiagrama({ diagrama, nodo_actual }) {
  $('diagrama-gm').hidden = false;
  lienzoGm ??= crearLienzo($('lienzo-gm'), {
    soloLectura: true,
    alSeleccionar: (sel) => {
      if (sel?.tipo !== 'nodo') return;
      servidor.enviar({ tipo: 'cambiar_nodo', nodo_id: sel.id });
      $('diagrama-gm').hidden = true;
    },
  });
  lienzoGm.pintar(autoDisponer(diagrama), null, nodo_actual);
  lienzoGm.encuadrar();
}
$('ver-diagrama').addEventListener('click', () => servidor.enviar({ tipo: 'ver_diagrama' }));
$('cerrar-diagrama').addEventListener('click', () => { $('diagrama-gm').hidden = true; });

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
const codigoGm = () => $('gm-codigo').value.replace(/\s/g, '').toUpperCase();
$('gm-codigo').addEventListener('input', () => {
  if (codigoGm().length === LARGO_CODIGO && !$('gm-token').value) $('gm-token').value = tokenGuardado(codigoGm()) ?? '';
});
$('gm-entrar').addEventListener('click', () => {
  const token = $('gm-token').value.trim() || tokenGuardado(codigoGm());
  if (!token) return aviso('Falta el token de GM de esa sala.');
  servidor.enviar({ tipo: 'retomar_gm', codigo: codigoGm(), token_gm: token });
});
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
  empezarGiro(notacion);
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
