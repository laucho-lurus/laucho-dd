// Tipos de nodo, listas de los desplegables y reglas de conexión del editor.
// Las reglas son el espejo de src/rules/diagrama.ts (el servidor vuelve a validar al guardar).

export const TIPOS = {
  escena: { nombre: 'Escena', icono: '🏞', color: '#4a6b8a' },
  decision: { nombre: 'Decisión', icono: '⑂', color: '#8a6d3b' },
  tirada: { nombre: 'Tirada', icono: '🎲', color: '#5b7f3a' },
  combate: { nombre: 'Combate', icono: '⚔', color: '#8a3b2e' },
  dialogo: { nombre: 'Diálogo', icono: '💬', color: '#6a4a8a' },
  evento: { nombre: 'Evento', icono: '⚡', color: '#a0782a' },
  final: { nombre: 'Final', icono: '🏁', color: '#2f6b5e' },
};

/** Etiquetas automáticas de las salidas, en orden. */
export const SALIDAS = { tirada: ['Éxito', 'Fracaso'], combate: ['Victoria', 'Huida', 'Derrota'] };
const MAX_SALIDAS = { final: 0, tirada: 2, combate: 3 };

const HAB = [
  ['acrobacias', 'Acrobacias'], ['arcanos', 'Arcanos'], ['atletismo', 'Atletismo'], ['engano', 'Engaño'], ['historia', 'Historia'],
  ['interpretacion', 'Interpretación'], ['intimidacion', 'Intimidación'], ['investigacion', 'Investigación'], ['juego_de_manos', 'Juego de manos'],
  ['medicina', 'Medicina'], ['naturaleza', 'Naturaleza'], ['percepcion', 'Percepción'], ['perspicacia', 'Perspicacia'], ['persuasion', 'Persuasión'],
  ['religion', 'Religión'], ['sigilo', 'Sigilo'], ['supervivencia', 'Supervivencia'], ['trato_con_animales', 'Trato con animales'],
];
const SAL = [['fue', 'Fuerza'], ['des', 'Destreza'], ['con', 'Constitución'], ['int', 'Inteligencia'], ['sab', 'Sabiduría'], ['car', 'Carisma']];
export const CHEQUEOS = [...HAB, ...SAL.map(([k, n]) => [`salvacion_${k}`, `Salvación de ${n}`])];
export const CD_PRESETS = [['10', 'Fácil (10)'], ['15', 'Media (15)'], ['20', 'Difícil (20)'], ['25', 'Muy difícil (25)']];

/** ¿Se puede conectar desde → hasta? Devuelve el motivo si no. */
export function puedeConectar(d, desde, hasta) {
  const origen = d.nodos.find((n) => n.id === desde);
  if (!origen || !d.nodos.some((n) => n.id === hasta)) return 'El nodo no existe';
  if (desde === hasta) return 'Un nodo no puede conectarse consigo mismo';
  if (d.flechas.some((f) => f.desde === desde && f.hasta === hasta)) return 'Esa flecha ya existe';
  const max = origen.tipo === 'decision' ? Math.max(1, origen.opciones?.length ?? 0) : MAX_SALIDAS[origen.tipo];
  if (max !== undefined && d.flechas.filter((f) => f.desde === desde).length >= max) {
    return max === 0 ? 'Un final no tiene salidas' : `Un nodo de tipo ${origen.tipo} admite como máximo ${max} salida${max === 1 ? '' : 's'}`;
  }
  return null;
}

/** Etiqueta sugerida para la próxima salida de un nodo. */
export function etiquetaSugerida(d, nodo) {
  const usadas = d.flechas.filter((f) => f.desde === nodo.id).map((f) => f.etiqueta);
  const lista = nodo.tipo === 'decision' ? nodo.opciones ?? [] : SALIDAS[nodo.tipo] ?? [];
  return lista.find((e) => !usadas.includes(e)) ?? '';
}

export const nuevoId = (d) => {
  let i = 1;
  while (d.nodos.some((n) => n.id === String(i))) i++;
  return String(i);
};

/** Posiciona por niveles (desde el primer nodo) los nodos que no tienen x/y, como los de campañas antiguas. */
export function autoDisponer(d) {
  if (d.nodos.every((n) => Number.isFinite(n.x))) return d;
  const nivel = new Map();
  const cola = d.nodos.length ? [[d.nodos[0].id, 0]] : [];
  while (cola.length) {
    const [id, n] = cola.shift();
    if (nivel.has(id)) continue;
    nivel.set(id, n);
    for (const f of d.flechas) if (f.desde === id) cola.push([f.hasta, n + 1]);
  }
  const porNivel = new Map();
  const nodos = d.nodos.map((nodo) => {
    if (Number.isFinite(nodo.x)) return nodo;
    const n = nivel.get(nodo.id) ?? Math.max(0, ...nivel.values()) + 1;
    const fila = porNivel.get(n) ?? 0;
    porNivel.set(n, fila + 1);
    return { ...nodo, x: 40 + n * 240, y: 40 + fila * 110 };
  });
  return { ...d, nodos };
}

/** "true" → true, "3" → 3, otro texto → texto. */
export function leerValor(texto) {
  const t = String(texto).trim();
  if (t === 'true' || t === 'false') return t === 'true';
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t;
}
