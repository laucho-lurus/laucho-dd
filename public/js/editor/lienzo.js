// Lienzo SVG del diagrama: zoom con la rueda, arrastre del fondo y de los nodos, y conexiones
// arrastrando desde el punto de salida. En modo lectura solo permite elegir un nodo.
import { TIPOS } from './tipos.js';

const NS = 'http://www.w3.org/2000/svg';
const ANCHO = 180;
const ALTO = 64;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;

const svgEl = (etiqueta, atributos = {}, texto) => {
  const e = document.createElementNS(NS, etiqueta);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
};

const recortar = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * @param {SVGSVGElement} svg
 * @param {{ soloLectura?: boolean, alSeleccionar: (sel: {tipo:'nodo'|'flecha', id?:string, indice?:number}|null) => void,
 *           alMover?: (id: string, x: number, y: number) => void, alConectar?: (desde: string, hasta: string) => void }} opciones
 */
export function crearLienzo(svg, opciones) {
  const vista = { x: 20, y: 20, k: 1 };
  const defs = svgEl('defs');
  const punta = svgEl('marker', { id: `punta-${Math.random().toString(36).slice(2)}`, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
  punta.append(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: 'punta' }));
  defs.append(punta);
  const grupo = svgEl('g');
  const capaFlechas = svgEl('g');
  const capaNodos = svgEl('g');
  const guia = svgEl('path', { class: 'flecha guia', 'marker-end': `url(#${punta.id})` });
  guia.style.display = 'none';
  grupo.append(capaFlechas, capaNodos, guia);
  svg.replaceChildren(defs, grupo);

  let diagrama = { nodos: [], flechas: [] };
  let gesto = null; // { tipo: 'fondo'|'nodo'|'conexion', ... }

  const aplicarVista = () => grupo.setAttribute('transform', `translate(${vista.x},${vista.y}) scale(${vista.k})`);
  const aMundo = (ev) => {
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - vista.x) / vista.k, y: (ev.clientY - r.top - vista.y) / vista.k };
  };
  const nodoPorId = (id) => diagrama.nodos.find((n) => n.id === id);
  const curva = (a, b) => `M${a.x},${a.y} C${a.x + 60},${a.y} ${b.x - 60},${b.y} ${b.x},${b.y}`;

  function pintar(d, seleccion = null, resaltado = null) {
    diagrama = d;
    capaFlechas.replaceChildren(...d.flechas.map((f, i) => {
      const a = nodoPorId(f.desde);
      const b = nodoPorId(f.hasta);
      if (!a || !b) return svgEl('g');
      const desde = { x: a.x + ANCHO, y: a.y + ALTO / 2 };
      const hasta = { x: b.x, y: b.y + ALTO / 2 };
      const g = svgEl('g', { class: `flecha-grupo${seleccion?.tipo === 'flecha' && seleccion.indice === i ? ' seleccionada' : ''}`, 'data-flecha': i });
      g.append(
        svgEl('path', { d: curva(desde, hasta), class: 'flecha-zona' }),
        svgEl('path', { d: curva(desde, hasta), class: `flecha${f.condicion ? ' condicional' : ''}`, 'marker-end': `url(#${punta.id})` }),
      );
      if (f.etiqueta) g.append(svgEl('text', { x: (desde.x + hasta.x) / 2, y: (desde.y + hasta.y) / 2 - 6, class: 'etiqueta-flecha' }, recortar(f.etiqueta, 28)));
      return g;
    }));
    capaNodos.replaceChildren(...d.nodos.map((n) => {
      const t = TIPOS[n.tipo] ?? TIPOS.escena;
      const clases = ['nodo', seleccion?.tipo === 'nodo' && seleccion.id === n.id && 'seleccionado', resaltado === n.id && 'actual'].filter(Boolean).join(' ');
      const g = svgEl('g', { class: clases, transform: `translate(${n.x},${n.y})`, 'data-nodo': n.id });
      g.append(
        svgEl('rect', { width: ANCHO, height: ALTO, rx: 8, fill: t.color }),
        svgEl('text', { x: 10, y: 22, class: 'tipo-nodo' }, `${t.icono} ${t.nombre} · ${n.id}`),
        svgEl('text', { x: 10, y: 44, class: 'titulo-nodo' }, recortar(n.titulo || '(sin título)', 22)),
      );
      if (!opciones.soloLectura && n.tipo !== 'final') g.append(svgEl('circle', { cx: ANCHO, cy: ALTO / 2, r: 7, class: 'puerto', 'data-puerto': n.id }));
      return g;
    }));
    aplicarVista();
  }

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vista.k * (ev.deltaY < 0 ? 1.1 : 0.9)));
    vista.x = px - ((px - vista.x) * k) / vista.k;
    vista.y = py - ((py - vista.y) * k) / vista.k;
    vista.k = k;
    aplicarVista();
  }, { passive: false });

  svg.addEventListener('pointerdown', (ev) => {
    const puerto = ev.target.closest('[data-puerto]');
    const nodo = ev.target.closest('[data-nodo]');
    const flecha = ev.target.closest('[data-flecha]');
    svg.setPointerCapture(ev.pointerId);
    if (puerto && !opciones.soloLectura) {
      gesto = { tipo: 'conexion', desde: puerto.dataset.puerto };
    } else if (nodo) {
      const n = nodoPorId(nodo.dataset.nodo);
      const p = aMundo(ev);
      gesto = { tipo: 'nodo', id: n.id, dx: p.x - n.x, dy: p.y - n.y, elemento: nodo, movido: false, x: n.x, y: n.y };
    } else if (flecha) {
      gesto = null;
      opciones.alSeleccionar({ tipo: 'flecha', indice: Number(flecha.dataset.flecha) });
    } else {
      gesto = { tipo: 'fondo', x: ev.clientX - vista.x, y: ev.clientY - vista.y, movido: false };
    }
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!gesto) return;
    if (gesto.tipo === 'fondo') {
      vista.x = ev.clientX - gesto.x;
      vista.y = ev.clientY - gesto.y;
      gesto.movido = true;
      aplicarVista();
    } else if (gesto.tipo === 'nodo' && !opciones.soloLectura) {
      const p = aMundo(ev);
      gesto.x = Math.round(p.x - gesto.dx);
      gesto.y = Math.round(p.y - gesto.dy);
      gesto.movido = true;
      gesto.elemento.setAttribute('transform', `translate(${gesto.x},${gesto.y})`);
    } else if (gesto.tipo === 'conexion') {
      const a = nodoPorId(gesto.desde);
      guia.style.display = '';
      guia.setAttribute('d', curva({ x: a.x + ANCHO, y: a.y + ALTO / 2 }, aMundo(ev)));
    }
  });

  svg.addEventListener('pointerup', (ev) => {
    const g = gesto;
    gesto = null;
    guia.style.display = 'none';
    if (!g) return;
    if (g.tipo === 'fondo' && !g.movido) opciones.alSeleccionar(null);
    if (g.tipo === 'nodo') {
      if (g.movido) opciones.alMover?.(g.id, g.x, g.y);
      else opciones.alSeleccionar({ tipo: 'nodo', id: g.id });
    }
    if (g.tipo === 'conexion') {
      const destino = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-nodo]');
      if (destino) opciones.alConectar?.(g.desde, destino.dataset.nodo);
    }
  });

  return {
    pintar,
    /** Ajusta zoom y posición para que se vea todo el diagrama. */
    encuadrar() {
      const r = svg.getBoundingClientRect();
      if (!diagrama.nodos.length || !r.width) return this.centrar();
      const xs = diagrama.nodos.map((n) => n.x);
      const ys = diagrama.nodos.map((n) => n.y);
      const caja = { x: Math.min(...xs) - 40, y: Math.min(...ys) - 40, w: Math.max(...xs) - Math.min(...xs) + ANCHO + 80, h: Math.max(...ys) - Math.min(...ys) + ALTO + 80 };
      vista.k = Math.max(ZOOM_MIN, Math.min(1, r.width / caja.w, r.height / caja.h));
      vista.x = (r.width - caja.w * vista.k) / 2 - caja.x * vista.k;
      vista.y = (r.height - caja.h * vista.k) / 2 - caja.y * vista.k;
      aplicarVista();
    },
    /** Vuelve al zoom 1 y centra en un nodo (o en el origen). */
    centrar(id) {
      const n = id && nodoPorId(id);
      const r = svg.getBoundingClientRect();
      vista.k = 1;
      vista.x = n ? r.width / 2 - n.x - ANCHO / 2 : 20;
      vista.y = n ? r.height / 2 - n.y - ALTO / 2 : 20;
      aplicarVista();
    },
  };
}
