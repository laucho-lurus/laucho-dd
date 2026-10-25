// Formulario de creación de personaje. El servidor vuelve a validar todo.

const $ = (id) => document.getElementById(id);
const CARS = [['fue', 'Fuerza'], ['des', 'Destreza'], ['con', 'Constitución'], ['int', 'Inteligencia'], ['sab', 'Sabiduría'], ['car', 'Carisma']];
const ESTANDAR = [15, 14, 13, 12, 10, 8];
const COSTE = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const MAX_FOTO = 2 * 1024 * 1024;

let opciones = null;
let pool = []; // valores a repartir (estándar o tirados)
let tokenTiradas = null;
let foto = null; // data URL

const mod = (v) => Math.floor((v - 10) / 2);
const conSigno = (n) => (n >= 0 ? `+${n}` : `${n}`);
const aviso = (texto, clase = 'aviso') => {
  $('aviso').className = clase;
  $('aviso').textContent = texto;
};

const llenar = (select, items) => select.replaceChildren(...items.map(([valor, texto]) => new Option(texto, valor)));

async function iniciar() {
  try {
    const r = await fetch('/api/opciones');
    opciones = await r.json();
  } catch {
    return aviso('No se pudieron cargar las opciones. ¿Está corriendo el servidor?');
  }
  llenar($('campana'), opciones.campanas.map((c) => [c.id, c.nombre]));
  llenar($('raza'), opciones.razas.map((r) => [r.clave, r.nombre]));
  llenar($('clase'), opciones.clases.map((c) => [c.clave, `${c.nombre} (d${c.dado_golpe})`]));
  llenar($('alineamiento'), opciones.alineamientos.map((a) => [a, a]));
  cambiarMetodo();
}

function cambiarMetodo() {
  const metodo = $('metodo').value;
  $('tirar').hidden = metodo !== 'aleatorio';
  tokenTiradas = null;
  pool = metodo === 'estandar' ? [...ESTANDAR] : [];
  $('pool').textContent = metodo === 'aleatorio' ? 'Tira para obtener tus valores.' : '';
  dibujarFilas();
}

/** Estándar y aleatorio: cada característica elige un valor del pool sin repetir. */
function dibujarFilas() {
  const metodo = $('metodo').value;
  const filas = CARS.map(([clave, nombre], i) => {
    const tr = document.createElement('tr');
    const celda = document.createElement('td');
    let control;
    if (metodo === 'estandar' || metodo === 'aleatorio') {
      control = document.createElement('select');
      control.append(new Option('—', ''), ...pool.map((v, idx) => new Option(v, idx)));
      if (pool.length) control.value = String(i); // reparto inicial en orden
    } else {
      control = document.createElement('input');
      control.type = 'number';
      [control.min, control.max] = metodo === 'compra' ? [8, 15] : [3, 20];
      control.value = metodo === 'compra' ? 8 : 10;
    }
    control.dataset.car = clave;
    control.addEventListener('input', actualizar);
    celda.append(control);
    tr.innerHTML = `<td>${nombre}</td>`;
    tr.append(celda, ...['raza', 'total', 'mod'].map((c) => Object.assign(document.createElement('td'), { className: c })));
    return tr;
  });
  $('filas-car').replaceChildren(...filas);
  actualizar();
}

/** Valores base según los controles (null si falta alguno). */
function valoresBase() {
  const base = {};
  for (const control of document.querySelectorAll('[data-car]')) {
    const v = control.tagName === 'SELECT' ? pool[parseInt(control.value, 10)] : parseInt(control.value, 10);
    base[control.dataset.car] = Number.isInteger(v) ? v : null;
  }
  return base;
}

function actualizar() {
  if (!opciones) return;
  const raza = opciones.razas.find((r) => r.clave === $('raza').value);
  const clase = opciones.clases.find((c) => c.clave === $('clase').value);
  const selects = [...document.querySelectorAll('select[data-car]')];
  const usados = new Set(selects.map((s) => s.value).filter(Boolean));
  for (const s of selects) for (const o of s.options) o.disabled = o.value !== '' && o.value !== s.value && usados.has(o.value);

  const base = valoresBase();
  const total = {};
  for (const tr of $('filas-car').children) {
    const clave = tr.querySelector('[data-car]').dataset.car;
    const bono = raza?.bonos[clave] ?? 0;
    total[clave] = base[clave] === null ? null : Math.min(20, base[clave] + bono);
    tr.querySelector('.raza').textContent = bono ? conSigno(bono) : '';
    tr.querySelector('.total').textContent = total[clave] ?? '—';
    tr.querySelector('.mod').textContent = total[clave] === null ? '' : conSigno(mod(total[clave]));
  }
  $('pg').textContent = clase && total.con !== null ? Math.max(1, clase.dado_golpe + mod(total.con)) : '—';
  $('ca').textContent = total.des !== null ? 10 + mod(total.des) : '—';
  if ($('metodo').value === 'compra') {
    const gasto = Object.values(base).reduce((s, v) => s + (COSTE[v] ?? 99), 0);
    $('puntos').textContent = `Puntos: ${27 - gasto} de 27`;
  } else $('puntos').textContent = '';
}

async function tirar() {
  const pozo = $('pool');
  pozo.classList.add('girando');
  pozo.innerHTML = '<b>🎲</b><b>🎲</b><b>🎲</b><b>🎲</b><b>🎲</b><b>🎲</b>';
  try {
    const [r] = await Promise.all([fetch('/api/caracteristicas/tirar', { method: 'POST' }), new Promise((ok) => setTimeout(ok, 700))]);
    const { token, valores } = await r.json();
    tokenTiradas = token;
    pool = valores;
    pozo.replaceChildren('Tiraste:', ...valores.map((v) => Object.assign(document.createElement('b'), { textContent: v })));
    dibujarFilas();
  } catch {
    aviso('No se pudo tirar. Inténtalo de nuevo.');
  } finally {
    pozo.classList.remove('girando');
  }
}

function elegirFoto() {
  const archivo = $('foto').files[0];
  foto = null;
  $('vista-previa').textContent = '?';
  if (!archivo) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) return aviso('La imagen debe ser PNG, JPG o WEBP.');
  if (archivo.size > MAX_FOTO) return aviso('La imagen supera 2 MB.');
  const lector = new FileReader();
  lector.onload = () => {
    foto = lector.result;
    const img = document.createElement('img');
    img.src = foto;
    img.alt = 'Vista previa del retrato';
    $('vista-previa').replaceChildren(img);
    aviso('');
  };
  lector.readAsDataURL(archivo);
}

async function crear() {
  const caracteristicas = valoresBase();
  if (Object.values(caracteristicas).some((v) => v === null)) return aviso('Asigna un valor a cada característica.');
  $('crear').disabled = true;
  try {
    const r = await fetch('/api/personajes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campana_id: $('campana').value,
        nombre: $('nombre').value,
        raza: $('raza').value,
        clase: $('clase').value,
        trasfondo: $('trasfondo').value,
        alineamiento: $('alineamiento').value,
        descripcion: $('descripcion').value,
        metodo: $('metodo').value,
        caracteristicas,
        token_tiradas: tokenTiradas ?? undefined,
        imagen: foto ?? undefined,
      }),
    });
    const datos = await r.json();
    if (!r.ok) return aviso(datos.error ?? 'No se pudo crear el personaje.');
    const p = datos.personaje;
    aviso(`¡${p.nombre} está listo! ${p.raza} ${p.clase}, ${p.pg_max} PG, CA ${p.datos.ca}. Ya puedes elegirlo al unirte a una sala.`, 'exito-creacion');
    if ($('metodo').value === 'aleatorio') cambiarMetodo(); // la tirada ya se usó
  } catch {
    aviso('No se pudo conectar con el servidor.');
  } finally {
    $('crear').disabled = false;
  }
}

$('metodo').addEventListener('change', cambiarMetodo);
$('raza').addEventListener('change', actualizar);
$('clase').addEventListener('change', actualizar);
$('tirar').addEventListener('click', tirar);
$('foto').addEventListener('change', elegirFoto);
$('crear').addEventListener('click', crear);
iniciar();
