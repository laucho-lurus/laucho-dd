// Mapa táctico en canvas 2D: fichas con retrato, arrastre (el servidor valida), regla de medir y niebla.
const PIES = 5;
const MIN_CELDA = 18;
const NIEBLA_JUGADOR = '#0d0907';
const NIEBLA_GM = 'rgba(13, 9, 7, .55)';
const BARRA = { sano: 1, herido: 0.7, malherido: 0.3, 'caído': 0 };

const imagenes = new Map(); // url → Image (cargada una vez)
function imagen(url, alCargar) {
  if (!url) return null;
  let img = imagenes.get(url);
  if (!img) {
    img = new Image();
    img.onload = alCargar;
    img.src = url;
    imagenes.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const iniciales = (nombre) => nombre.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const distancia = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const medida = (d) => `${d} casilla${d === 1 ? '' : 's'} · ${d * PIES} pies`;

/**
 * @param {{ canvas: HTMLCanvasElement, info: HTMLElement, bandeja: HTMLElement, enviar: (m: object) => void,
 *           esGm: () => boolean, miId: () => string|null, modoNiebla: () => 'no'|'ocultar'|'revelar' }} o
 */
export function crearMapaTactico(o) {
  const ctx = o.canvas.getContext('2d');
  let mapa = null;
  let entidades = new Map(); // id → { nombre, imagen_url, tipo: 'pj'|'monstruo', fraccion }
  let celda = 32;
  let gesto = null; // { tipo: 'ficha'|'medir'|'niebla', ... }
  let colocando = null; // id elegido en la bandeja para colocar con un clic

  const puedeMover = (id) => o.esGm() || id === o.miId();
  const fichaEn = (p) => Object.entries(mapa.fichas).find(([, f]) => f.x === p.x && f.y === p.y)?.[0];
  const oculta = (p) => mapa.ocultas.includes(p.y * mapa.ancho + p.x);

  function casilla(ev) {
    const r = o.canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / celda);
    const y = Math.floor((ev.clientY - r.top) / celda);
    return { x, y, dentro: x >= 0 && y >= 0 && x < mapa.ancho && y < mapa.alto };
  }

  function dibujarFicha(id, x, y, fantasma = false) {
    const e = entidades.get(id);
    if (!e) return;
    const cx = x * celda + celda / 2;
    const cy = y * celda + celda / 2;
    const radio = celda * 0.42;
    ctx.save();
    ctx.globalAlpha = fantasma ? 0.6 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = e.tipo === 'pj' ? '#3b2b1f' : '#4a1f18';
    ctx.fill();
    const img = imagen(e.imagen_url, pintar);
    if (img) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, cx - radio, cy - radio, radio * 2, radio * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = e.tipo === 'pj' ? '#d9a441' : '#e0a090';
      ctx.font = `700 ${Math.round(radio * 0.8)}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iniciales(e.nombre), cx, cy + 1);
    }
    ctx.lineWidth = id === o.miId() ? 3 : 2;
    ctx.strokeStyle = e.tipo === 'pj' ? '#d9a441' : '#b4483a';
    ctx.stroke();
    // Barra de estado sin números.
    const ancho = celda * 0.8;
    ctx.fillStyle = '#00000099';
    ctx.fillRect(cx - ancho / 2, y * celda + celda - 5, ancho, 4);
    ctx.fillStyle = e.fraccion > 0.3 ? '#7fae5a' : '#b4483a';
    ctx.fillRect(cx - ancho / 2, y * celda + celda - 5, ancho * e.fraccion, 4);
    if (celda >= 28) {
      ctx.fillStyle = '#e9dcc3';
      ctx.font = `${Math.max(9, Math.round(celda * 0.26))}px Lora, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(e.nombre, cx, y * celda - 2 > 8 ? y * celda + 1 : cy + radio + 10, celda * 1.6);
    }
    ctx.restore();
  }

  function pintar() {
    if (!mapa) return;
    const r = o.canvas.parentElement.getBoundingClientRect();
    celda = Math.max(MIN_CELDA, Math.floor(Math.min(r.width / mapa.ancho, (window.innerHeight * 0.6) / mapa.alto)));
    o.canvas.width = mapa.ancho * celda;
    o.canvas.height = mapa.alto * celda;
    ctx.fillStyle = '#1a130e';
    ctx.fillRect(0, 0, o.canvas.width, o.canvas.height);
    const fondo = imagen(mapa.fondo_url, pintar);
    if (fondo) ctx.drawImage(fondo, 0, 0, o.canvas.width, o.canvas.height);
    ctx.strokeStyle = 'rgba(233, 220, 195, .15)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= mapa.ancho; x++) ctx.strokeRect(x * celda, 0, 0, o.canvas.height);
    for (let y = 0; y <= mapa.alto; y++) ctx.strokeRect(0, y * celda, o.canvas.width, 0);
    for (const [id, f] of Object.entries(mapa.fichas)) if (!(gesto?.tipo === 'ficha' && gesto.id === id)) dibujarFicha(id, f.x, f.y);
    for (const i of mapa.ocultas) {
      ctx.fillStyle = o.esGm() ? NIEBLA_GM : NIEBLA_JUGADOR;
      ctx.fillRect((i % mapa.ancho) * celda, Math.floor(i / mapa.ancho) * celda, celda, celda);
    }
    if (gesto?.tipo === 'ficha') dibujarFicha(gesto.id, gesto.hasta.x, gesto.hasta.y, true);
    if (gesto?.tipo === 'medir' || gesto?.tipo === 'ficha') {
      const a = gesto.desde;
      const b = gesto.hasta;
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x * celda + celda / 2, a.y * celda + celda / 2);
      ctx.lineTo(b.x * celda + celda / 2, b.y * celda + celda / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (gesto?.tipo === 'niebla') {
      ctx.fillStyle = gesto.oculta ? 'rgba(0,0,0,.5)' : 'rgba(217,164,65,.3)';
      for (const k of gesto.celdas) {
        const [x, y] = k.split(',').map(Number);
        ctx.fillRect(x * celda, y * celda, celda, celda);
      }
    }
  }

  function pintarBandeja() {
    const sinColocar = [...entidades.keys()].filter((id) => !(id in mapa.fichas) && puedeMover(id));
    o.bandeja.replaceChildren(...(sinColocar.length ? [document.createTextNode('Sin colocar (elige y haz clic en una casilla): ')] : []),
      ...sinColocar.map((id) => {
        const b = Object.assign(document.createElement('button'), { className: `secundario${colocando === id ? ' activo' : ''}`, textContent: entidades.get(id).nombre });
        b.addEventListener('click', () => { colocando = colocando === id ? null : id; pintarBandeja(); });
        return b;
      }));
  }

  o.canvas.addEventListener('pointerdown', (ev) => {
    if (!mapa) return;
    const p = casilla(ev);
    if (!p.dentro) return;
    o.canvas.setPointerCapture(ev.pointerId);
    if (colocando) {
      o.enviar({ tipo: 'mover_ficha', id: colocando, x: p.x, y: p.y });
      colocando = null;
      return pintarBandeja();
    }
    if (o.esGm() && o.modoNiebla() !== 'no') {
      gesto = { tipo: 'niebla', oculta: o.modoNiebla() === 'ocultar', celdas: new Set([`${p.x},${p.y}`]) };
    } else {
      const id = fichaEn(p);
      gesto = id && puedeMover(id) ? { tipo: 'ficha', id, desde: p, hasta: p } : { tipo: 'medir', desde: p, hasta: p };
    }
    pintar();
  });

  o.canvas.addEventListener('pointermove', (ev) => {
    if (!gesto || !mapa) return;
    const p = casilla(ev);
    if (!p.dentro) return;
    if (gesto.tipo === 'niebla') gesto.celdas.add(`${p.x},${p.y}`);
    else {
      gesto.hasta = { x: p.x, y: p.y };
      const d = distancia(gesto.desde, gesto.hasta);
      const limite = gesto.tipo === 'ficha' && !o.esGm() && d > mapa.velocidad ? ` (tu velocidad: ${medida(mapa.velocidad)})` : '';
      o.info.textContent = `${gesto.tipo === 'ficha' ? 'Mover' : 'Medir'}: ${medida(d)}${limite}`;
    }
    pintar();
  });

  o.canvas.addEventListener('pointerup', () => {
    const g = gesto;
    gesto = null;
    if (g?.tipo === 'ficha' && (g.hasta.x !== g.desde.x || g.hasta.y !== g.desde.y)) o.enviar({ tipo: 'mover_ficha', id: g.id, x: g.hasta.x, y: g.hasta.y });
    if (g?.tipo === 'niebla') o.enviar({ tipo: 'niebla', oculta: g.oculta, celdas: [...g.celdas].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }) });
    pintar(); // el servidor confirma y vuelve a pintar; si rechaza, la ficha vuelve a su sitio
  });

  window.addEventListener('resize', pintar);

  return {
    /** `vista`: el mapa (para el GM, el completo). `jugadores` y `monstruos` del estado de la sala. */
    actualizar(vista, jugadores, monstruos) {
      mapa = vista;
      entidades = new Map([
        ...jugadores.map((j) => [j.personaje_id, { nombre: j.nombre, imagen_url: j.imagen_url, tipo: 'pj', fraccion: Math.max(0, j.pg_actual / j.pg_max) }]),
        ...monstruos.map((m) => [m.id, { nombre: m.nombre, imagen_url: m.imagen_url ?? null, tipo: 'monstruo', fraccion: m.pg_max ? m.pg_actual / m.pg_max : BARRA[m.estado] ?? 0 }]),
      ]);
      if (mapa && !gesto) {
        pintar();
        pintarBandeja();
      }
      return Boolean(mapa);
    },
    oculta: (p) => mapa && oculta(p),
  };
}
