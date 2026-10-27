// Elección de trucos y hechizos de nivel 1 al crear el personaje (el servidor valida las cantidades).

const $ = (id) => document.getElementById(id);
const mod = (v) => Math.floor((v - 10) / 2);
const COSTO = ['gratis', '2 PM'];

let catalogo = null;
const elegidos = new Set();

export async function cargarHechizos() {
  const r = await fetch('/api/catalogo');
  if (!r.ok) throw new Error('No se pudieron cargar los hechizos');
  catalogo = await r.json();
}

/** Cuántos trucos y de nivel 1 elige la clase (mismo cálculo que el servidor). */
function cupos(clase, total) {
  const l = catalogo?.lanzadores[clase];
  if (!l || l.desde_nivel > 1) return { trucos: 0, nivel1: 0, car: null };
  const valor = total[l.car];
  const nivel1 = l.nivel1 === 'preparados' ? (valor === null ? 1 : Math.max(1, mod(valor) + 1)) : l.nivel1;
  return { trucos: l.trucos, nivel1, car: l.car };
}

export function hechizosElegidos() {
  return [...elegidos];
}

/** Pinta las casillas según la clase y las características (`total`: valores finales o null). */
export function pintarHechizos(clase, total) {
  if (!catalogo) return;
  const { trucos, nivel1, car } = cupos(clase, total);
  const seccion = $('seccion-hechizos');
  seccion.hidden = trucos + nivel1 === 0;
  if (seccion.hidden) {
    elegidos.clear();
    return;
  }
  const deClase = catalogo.hechizos.filter((h) => h.clases.includes(clase));
  for (const id of [...elegidos]) if (!deClase.some((h) => h.id === id)) elegidos.delete(id);
  const pmMax = car && total[car] !== null ? Math.max(1, 1 + mod(total[car]) + 2) : '—';
  $('ayuda-hechizos').textContent = `Elige ${trucos} trucos y ${nivel1} hechizos de nivel 1. Maná: ${pmMax} PM (nivel + mod. de ${car?.toUpperCase()} + 2). Los trucos no cuestan; los de nivel 1 cuestan 2 PM. Descanso largo: recuperas todo; corto: la mitad, una vez.`;
  const grupo = (nivel, cupo, destino) => {
    const lista = deClase.filter((h) => h.nivel === nivel);
    const marcados = lista.filter((h) => elegidos.has(h.id)).length;
    $(`cuenta-${destino}`).textContent = `${marcados}/${cupo}`;
    $(destino).replaceChildren(...lista.map((h) => {
      const label = document.createElement('label');
      label.className = 'hechizo';
      const caja = document.createElement('input');
      caja.type = 'checkbox';
      caja.checked = elegidos.has(h.id);
      caja.disabled = !caja.checked && marcados >= cupo;
      caja.addEventListener('change', () => {
        if (caja.checked) elegidos.add(h.id);
        else elegidos.delete(h.id);
        pintarHechizos(clase, total);
      });
      const texto = document.createElement('span');
      texto.innerHTML = '<b></b> <small></small><br><small class="desc"></small>';
      texto.querySelector('b').textContent = h.nombre;
      texto.querySelector('small').textContent = `${h.alcance} · ${COSTO[h.nivel]}`;
      texto.querySelector('.desc').textContent = h.descripcion;
      label.append(caja, texto);
      return label;
    }));
  };
  grupo(0, trucos, 'trucos');
  grupo(1, nivel1, 'nivel1');
}
