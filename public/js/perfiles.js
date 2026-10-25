// Editor de perfiles del GM IA.

const $ = (id) => document.getElementById(id);
const NUEVO = '';
let perfiles = [];

const aviso = (texto, clase = 'aviso') => {
  $('aviso').className = clase;
  $('aviso').textContent = texto;
};

function mostrar() {
  const p = perfiles.find((x) => x.id === $('lista').value);
  $('nombre').value = p?.nombre ?? '';
  $('descripcion').value = p?.descripcion ?? '';
  $('tono').value = p?.tono ?? '';
  $('dificultad').value = p?.dificultad ?? 'normal';
}

async function cargar(elegido) {
  try {
    const r = await (await fetch('/api/perfiles')).json();
    perfiles = r.perfiles;
    $('dificultad').replaceChildren(...r.dificultades.map((d) => new Option(d, d)));
    $('lista').replaceChildren(...perfiles.map((p) => new Option(p.nombre, p.id)), new Option('+ Nuevo perfil', NUEVO));
    if (elegido !== undefined) $('lista').value = elegido;
    mostrar();
  } catch {
    aviso('No se pudieron cargar los perfiles.');
  }
}

$('lista').addEventListener('change', () => {
  aviso('');
  mostrar();
});

$('guardar').addEventListener('click', async () => {
  const id = $('lista').value;
  try {
    const r = await fetch('/api/perfiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id || undefined, nombre: $('nombre').value, descripcion: $('descripcion').value, tono: $('tono').value, dificultad: $('dificultad').value }),
    });
    const datos = await r.json();
    if (!r.ok) return aviso(datos.error ?? 'No se pudo guardar.');
    await cargar(datos.perfil.id);
    aviso(`Perfil guardado ✓ ${datos.perfil.nombre}`, 'exito-creacion');
  } catch {
    aviso('No se pudo conectar con el servidor.');
  }
});

cargar();
