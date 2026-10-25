// Panel lateral del editor: campos del nodo según su tipo, de la flecha seleccionada y variables.
import { CD_PRESETS, CHEQUEOS, leerValor, TIPOS } from './tipos.js';

const el = (etiqueta, atributos = {}, ...hijos) => {
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...hijos);
  return e;
};

const campo = (etiqueta, control) => el('label', { className: 'campo' }, etiqueta, control);
const opcion = (valor, texto, elegido) => el('option', { value: valor, selected: valor === elegido }, texto);
const lista = (opciones, valor, onchange) => el('select', { onchange }, ...opciones.map(([v, t]) => opcion(v, t, valor)));

/**
 * Pinta el panel de la selección. `cambiar(fn)` aplica `fn` a una copia del estado y lo guarda en el historial.
 * Los campos guardan al salir del control (evento change) para no llenar el historial de pulsaciones.
 */
export function pintarPanel(contenedor, estado, seleccion, { cambiar, criaturas }) {
  const d = estado.diagrama;
  if (seleccion?.tipo === 'nodo') {
    const n = d.nodos.find((x) => x.id === seleccion.id);
    if (n) return contenedor.replaceChildren(...panelNodo(n, estado, cambiar, criaturas));
  }
  if (seleccion?.tipo === 'flecha' && d.flechas[seleccion.indice]) {
    return contenedor.replaceChildren(...panelFlecha(seleccion.indice, estado, cambiar));
  }
  contenedor.replaceChildren(el('p', { className: 'ayuda' }, 'Selecciona un nodo o una flecha. Arrastra desde el punto de la derecha de un nodo hasta otro para conectarlos.'));
}

function panelNodo(n, estado, cambiar, criaturas) {
  // Modifica el nodo `n.id` en la copia del estado.
  const editar = (fn) => cambiar((e) => fn(e.diagrama.nodos.find((x) => x.id === n.id)));
  const texto = (prop, filas = 0) => {
    const atributos = { value: n[prop] ?? '', onchange: (ev) => editar((x) => { x[prop] = ev.target.value; }) };
    return filas ? el('textarea', { ...atributos, rows: filas }) : el('input', atributos);
  };
  const partes = [
    el('h2', {}, `${TIPOS[n.tipo]?.icono ?? ''} Nodo ${n.id}`),
    campo('Tipo', lista(Object.entries(TIPOS).map(([k, t]) => [k, t.nombre]), n.tipo, (ev) => editar((x) => { x.tipo = ev.target.value; }))),
    campo('Título', texto('titulo')),
    campo('Texto para leer en voz alta', texto('texto', 4)),
    campo('Notas secretas del GM', texto('notas', 3)),
  ];
  if (n.tipo === 'tirada') {
    const preset = CD_PRESETS.some(([v]) => Number(v) === n.cd) ? String(n.cd) : n.cd ? 'libre' : '';
    partes.push(
      campo('Habilidad o salvación', lista([['', '—'], ...CHEQUEOS], n.chequeo ?? '', (ev) => editar((x) => { x.chequeo = ev.target.value || undefined; }))),
      campo('CD', lista([['', 'Sin CD'], ...CD_PRESETS, ['libre', 'Personalizada…']], preset, (ev) => editar((x) => { x.cd = ev.target.value === 'libre' ? x.cd ?? 12 : Number(ev.target.value) || undefined; }))),
    );
    if (preset === 'libre') partes.push(campo('CD personalizada', el('input', { type: 'number', min: 1, max: 40, value: n.cd, onchange: (ev) => editar((x) => { x.cd = Number(ev.target.value) || undefined; }) })));
    partes.push(el('p', { className: 'ayuda' }, 'Salidas: la primera flecha es «Éxito» y la segunda «Fracaso».'));
  }
  if (n.tipo === 'combate') {
    const monstruos = n.monstruos ?? [];
    partes.push(el('h3', {}, 'Monstruos'), ...monstruos.map((m, i) => el('div', { className: 'fila' },
      lista(criaturas.map((c) => [c.srd_clave, c.nombre]), m.srd_clave, (ev) => editar((x) => { x.monstruos[i].srd_clave = ev.target.value; })),
      el('input', { type: 'number', min: 1, max: 6, value: m.cantidad, className: 'corto', onchange: (ev) => editar((x) => { x.monstruos[i].cantidad = Math.min(6, Math.max(1, Number(ev.target.value) || 1)); }) }),
      el('button', { className: 'secundario', textContent: '✕', title: 'Quitar', onclick: () => editar((x) => { x.monstruos.splice(i, 1); }) }),
    )), el('button', { className: 'secundario', textContent: '+ Monstruo', onclick: () => editar((x) => { x.monstruos = [...(x.monstruos ?? []), { srd_clave: criaturas[0]?.srd_clave ?? 'kobold', cantidad: 1 }]; }) }),
    el('p', { className: 'ayuda' }, 'Salidas: Victoria, Huida y Derrota, en ese orden.'));
  }
  if (n.tipo === 'decision') {
    partes.push(campo('Opciones (una por línea; una flecha por opción)', el('textarea', {
      rows: 4, value: (n.opciones ?? []).join('\n'),
      onchange: (ev) => editar((x) => { x.opciones = ev.target.value.split('\n').map((o) => o.trim()).filter(Boolean); }),
    })));
  }
  if (n.tipo === 'dialogo') partes.push(campo('PNJ', texto('pnj')), campo('Qué sabe', texto('sabe', 2)), campo('Qué quiere', texto('quiere', 2)));
  if (n.tipo === 'evento') {
    const vars = Object.keys(estado.variables);
    partes.push(
      campo('Se dispara cuando la variable', lista([['', '—'], ...vars.map((v) => [v, v])], n.disparador?.variable ?? '', (ev) => editar((x) => { x.disparador = ev.target.value ? { variable: ev.target.value, valor: x.disparador?.valor ?? true } : undefined; }))),
      campo('vale', el('input', { value: n.disparador ? String(n.disparador.valor) : '', disabled: !n.disparador, onchange: (ev) => editar((x) => { if (x.disparador) x.disparador.valor = leerValor(ev.target.value); }) })),
    );
  }
  if (n.tipo === 'final') {
    partes.push(campo('Recompensas', texto('recompensas', 2)), campo('XP', el('input', { type: 'number', min: 0, value: n.xp ?? '', onchange: (ev) => editar((x) => { x.xp = Number(ev.target.value) || 0; }) })));
  }
  partes.push(el('button', {
    className: 'peligro', textContent: 'Borrar nodo',
    onclick: () => cambiar((e) => {
      e.diagrama.nodos = e.diagrama.nodos.filter((x) => x.id !== n.id);
      e.diagrama.flechas = e.diagrama.flechas.filter((f) => f.desde !== n.id && f.hasta !== n.id);
    }, null),
  }));
  return partes;
}

function panelFlecha(i, estado, cambiar) {
  const f = estado.diagrama.flechas[i];
  const editar = (fn) => cambiar((e) => fn(e.diagrama.flechas[i]));
  const vars = Object.keys(estado.variables);
  const efectos = f.efectos ?? [];
  return [
    el('h2', {}, `Flecha ${f.desde} → ${f.hasta}`),
    campo('Etiqueta', el('input', { value: f.etiqueta, onchange: (ev) => editar((x) => { x.etiqueta = ev.target.value; }) })),
    campo('Condición (texto libre o «variable = valor»)', el('input', { value: f.condicion ?? '', onchange: (ev) => editar((x) => { x.condicion = ev.target.value.trim() || undefined; }) })),
    vars.length ? campo('…o elige una variable', lista([['', '—'], ...vars.map((v) => [v, v])], '', (ev) => ev.target.value && editar((x) => { x.condicion = `${ev.target.value} = true`; }))) : '',
    el('h3', {}, 'Al recorrerla, fijar variable'),
    ...efectos.map((ef, j) => el('div', { className: 'fila' },
      lista(vars.map((v) => [v, v]), ef.variable, (ev) => editar((x) => { x.efectos[j].variable = ev.target.value; })),
      el('input', { value: String(ef.valor), className: 'corto', onchange: (ev) => editar((x) => { x.efectos[j].valor = leerValor(ev.target.value); }) }),
      el('button', { className: 'secundario', textContent: '✕', onclick: () => editar((x) => { x.efectos.splice(j, 1); }) }),
    )),
    vars.length
      ? el('button', { className: 'secundario', textContent: '+ Efecto', onclick: () => editar((x) => { x.efectos = [...(x.efectos ?? []), { variable: vars[0], valor: true }]; }) })
      : el('p', { className: 'ayuda' }, 'Crea variables abajo para usar condiciones y efectos.'),
    el('button', { className: 'peligro', textContent: 'Borrar flecha', onclick: () => cambiar((e) => { e.diagrama.flechas.splice(i, 1); }, null) }),
  ];
}

/** Lista de variables de la campaña: nombre y valor inicial. */
export function pintarVariables(contenedor, estado, cambiar) {
  const nombre = el('input', { placeholder: 'nombre_variable', className: 'medio' });
  const valor = el('input', { placeholder: 'false', className: 'corto' });
  contenedor.replaceChildren(
    ...Object.entries(estado.variables).map(([k, v]) => el('div', { className: 'fila' },
      el('code', {}, k),
      el('input', { value: String(v), className: 'corto', onchange: (ev) => cambiar((e) => { e.variables[k] = leerValor(ev.target.value); }) }),
      el('button', { className: 'secundario', textContent: '✕', title: 'Borrar variable', onclick: () => cambiar((e) => { delete e.variables[k]; }) }),
    )),
    el('div', { className: 'fila' }, nombre, valor, el('button', {
      className: 'secundario', textContent: '+ Variable',
      onclick: () => {
        const k = nombre.value.trim();
        if (/^[a-z_][a-z0-9_]{0,40}$/i.test(k)) cambiar((e) => { e.variables[k] = leerValor(valor.value || 'false'); });
      },
    })),
  );
}
