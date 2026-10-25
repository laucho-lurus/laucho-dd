// Página /imagenes: subir, reemplazar y borrar imágenes de criaturas, PNJ, escenas, fondos y retratos.
const $ = (id) => document.getElementById(id);
const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
const NOMBRES = { nodo: 'Escena', criatura: 'Criatura', pnj: 'PNJ', fondo: 'Fondo', personaje: 'Retrato' };

let datos = null;
let archivoElegido = null; // data URL

const aviso = (texto, clase = 'aviso') => {
  $('aviso').className = clase;
  $('aviso').textContent = texto;
};

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'Error del servidor');
  return j;
}

/** Opciones del desplegable "Cuál" según el tipo; PNJ y fondo se escriben a mano. */
function pintarClaves(preseleccion) {
  const tipo = $('tipo').value;
  const libre = tipo === 'pnj' || tipo === 'fondo';
  $('clave').hidden = libre;
  $('clave-texto').hidden = !libre;
  if (libre) {
    $('clave-texto').value = preseleccion ?? '';
    return;
  }
  const o = datos?.opciones ?? { nodos: [], criaturas: [], personajes: [] };
  const lista = tipo === 'nodo' ? o.nodos.map((n) => [n.id, `${n.id}. ${n.titulo}`])
    : tipo === 'criatura' ? o.criaturas.map((c) => [c.srd_clave, c.nombre])
      : o.personajes.map((p) => [p.id, p.nombre]);
  $('clave').replaceChildren(...lista.map(([v, t]) => new Option(t, v)));
  if (preseleccion) $('clave').value = preseleccion;
}

function nombreDe(perteneceA) {
  const [tipo, a, b] = perteneceA.split(':');
  const o = datos.opciones;
  if (tipo === 'nodo') return `Escena: ${o.nodos.find((n) => n.id === b)?.titulo ?? b}`;
  if (tipo === 'criatura') return `Criatura: ${o.criaturas.find((c) => c.srd_clave === a)?.nombre ?? a}`;
  if (tipo === 'personaje') return `Retrato: ${o.personajes.find((p) => p.id === a)?.nombre ?? a}`;
  return `${NOMBRES[tipo] ?? tipo}: ${b}`;
}

const boton = (texto, alHacer, clase = 'secundario') => {
  const b = Object.assign(document.createElement('button'), { textContent: texto, className: clase });
  b.addEventListener('click', alHacer);
  return b;
};
const miniatura = (url) => Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' });

/** Elige en el formulario el dueño de una imagen (para subirla o reemplazarla). */
function elegir(perteneceA) {
  const [tipo, a, b] = perteneceA.split(':');
  $('tipo').value = tipo;
  pintarClaves(tipo === 'criatura' || tipo === 'personaje' ? a : b);
  $('zona').scrollIntoView({ behavior: 'smooth', block: 'center' });
  aviso(`Elige la imagen para «${nombreDe(perteneceA)}».`, 'ayuda');
}

async function borrar(id) {
  if (!confirm('¿Borrar esta imagen?')) return;
  try {
    await pedir(`/api/imagenes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await cargar();
  } catch (err) {
    aviso(`No se pudo borrar: ${err.message}`);
  }
}

function pintar() {
  const hechas = datos.pendientes.filter((p) => p.url).length;
  $('progreso').textContent = `${hechas} de ${datos.pendientes.length}`;
  $('checklist').replaceChildren(...datos.pendientes.map((p) => {
    const li = document.createElement('li');
    const estado = Object.assign(document.createElement('span'), { className: `estado ${p.url ? 'hecho' : 'falta'}`, textContent: p.url ? '✓' : '✗' });
    li.append(estado, ...(p.url ? [miniatura(p.url)] : []), p.nombre, boton(p.url ? 'Reemplazar' : 'Subir', () => elegir(p.pertenece_a)));
    if (p.id) li.append(boton('Borrar', () => borrar(p.id)));
    return li;
  }));
  $('galeria').replaceChildren(...datos.imagenes.map((i) => {
    const f = document.createElement('figure');
    f.append(miniatura(i.url), nombreDe(i.pertenece_a), boton('Reemplazar', () => elegir(i.pertenece_a)), boton('Borrar', () => borrar(i.id)));
    return f;
  }));
}

async function cargar() {
  const id = $('campana').value;
  if (!id) return;
  try {
    datos = await pedir(`/api/imagenes?campana=${encodeURIComponent(id)}`);
    pintarClaves();
    pintar();
  } catch (err) {
    aviso(`No se pudieron cargar las imágenes: ${err.message}`);
  }
}

function tomarArchivo(archivo) {
  archivoElegido = null;
  $('subir').disabled = true;
  if (!archivo) return;
  if (!TIPOS.includes(archivo.type)) return aviso('La imagen debe ser PNG, JPG o WEBP.');
  if (archivo.size > MAX_BYTES) return aviso('La imagen supera 5 MB.');
  const lector = new FileReader();
  lector.onload = () => {
    archivoElegido = lector.result;
    $('vista-previa').replaceChildren(miniatura(archivoElegido));
    $('subir').disabled = false;
    aviso('');
  };
  lector.readAsDataURL(archivo);
}

async function subir() {
  const tipo = $('tipo').value;
  const clave = tipo === 'pnj' || tipo === 'fondo' ? $('clave-texto').value.trim() : $('clave').value;
  if (!clave) return aviso('Indica a qué pertenece la imagen.');
  $('subir').disabled = true;
  try {
    const { imagen } = await pedir('/api/imagenes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pertenece: { tipo, clave, campana_id: $('campana').value }, imagen: archivoElegido }),
    });
    aviso(`Imagen guardada ✓ ${nombreDe(imagen.pertenece_a)}`, 'exito-creacion');
    archivoElegido = null;
    $('vista-previa').innerHTML = 'Arrastra aquí otra imagen o haz clic para elegirla<br><small>PNG, JPG o WEBP · máx. 5 MB</small>';
    await cargar();
  } catch (err) {
    aviso(`No se pudo subir: ${err.message}`);
    $('subir').disabled = false;
  }
}

$('zona').addEventListener('click', () => $('archivo').click());
$('zona').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && $('archivo').click());
$('zona').addEventListener('dragover', (e) => { e.preventDefault(); $('zona').classList.add('encima'); });
$('zona').addEventListener('dragleave', () => $('zona').classList.remove('encima'));
$('zona').addEventListener('drop', (e) => { e.preventDefault(); $('zona').classList.remove('encima'); tomarArchivo(e.dataTransfer.files[0]); });
$('archivo').addEventListener('change', () => tomarArchivo($('archivo').files[0]));
$('tipo').addEventListener('change', () => pintarClaves());
$('campana').addEventListener('change', cargar);
$('subir').addEventListener('click', subir);

pedir('/api/campanas')
  .then(({ campanas }) => {
    $('campana').replaceChildren(...campanas.map((c) => new Option(c.nombre, c.id)));
    return cargar();
  })
  .catch((err) => aviso(`No se pudieron cargar las campañas: ${err.message}`));
