// Comprueba las aventuras incluidas en db/seed/campanas con las mismas reglas que el editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVENTURAS } from '../../db/seed/campanas/index.ts';
import { normalizarCampana, validarDiagrama, MAX_SALIDAS } from './diagrama.ts';
import { esChequeo } from './habilidades.ts';
import { SRD_MONSTRUOS } from './monstruos.ts';
import { imagenesDeCampana } from './imagenes.ts';
import type { Diagrama } from './aventura.ts';

/** Nodos alcanzables desde `inicio` siguiendo las flechas (o al revés). */
function alcanzables(d: Diagrama, inicio: string[], haciaAtras = false): Set<string> {
  const vistos = new Set<string>(inicio);
  const pila = [...inicio];
  while (pila.length) {
    const id = pila.pop()!;
    for (const fl of d.flechas) {
      const [de, a] = haciaAtras ? [fl.hasta, fl.desde] : [fl.desde, fl.hasta];
      if (de === id && !vistos.has(a)) {
        vistos.add(a);
        pila.push(a);
      }
    }
  }
  return vistos;
}

for (const a of Object.values(AVENTURAS)) {
  test(`aventura "${a.nombre}": válida para el editor y jugable de principio a fin`, () => {
    const n = normalizarCampana(JSON.parse(JSON.stringify(a)));
    assert.ok(n.ok, n.ok ? '' : n.error);
    assert.deepEqual(n.valor.diagrama, a.diagrama, 'el editor la guarda sin perder nada');
    assert.deepEqual(validarDiagrama(a.diagrama, a.variables), [], 'sin avisos del editor');

    const { nodos, flechas } = a.diagrama;
    const desdeElInicio = alcanzables(a.diagrama, [nodos[0].id]);
    assert.deepEqual(nodos.filter((x) => !desdeElInicio.has(x.id)).map((x) => x.id), [], 'nodos inalcanzables');
    const finales = nodos.filter((x) => x.tipo === 'final').map((x) => x.id);
    const llevanAUnFinal = alcanzables(a.diagrama, finales, true);
    assert.deepEqual(nodos.filter((x) => !llevanAUnFinal.has(x.id)).map((x) => x.id), [], 'nodos sin camino a un final');

    for (const x of nodos) {
      const salidas = flechas.filter((fl) => fl.desde === x.id);
      const max = x.tipo === 'decision' ? x.opciones!.length : MAX_SALIDAS[x.tipo];
      if (max !== undefined) assert.ok(salidas.length <= max, `${x.id}: demasiadas salidas`);
      if (x.tipo === 'decision') assert.deepEqual(salidas.map((s) => s.etiqueta), x.opciones, `${x.id}: una flecha por opción`);
      if (x.tipo === 'tirada') {
        assert.ok(x.chequeo && esChequeo(x.chequeo) && x.cd, `${x.id}: tirada con habilidad y CD`);
        assert.deepEqual(salidas.map((s) => s.etiqueta), ['Éxito', 'Fracaso'], `${x.id}: salidas de tirada`);
      }
      if (x.tipo === 'combate') {
        assert.ok(x.monstruos?.length, `${x.id}: combate sin monstruos`);
        for (const m of x.monstruos!) assert.ok(SRD_MONSTRUOS[m.srd_clave] || a.criaturas?.some((c) => c.srd_clave === m.srd_clave), `${x.id}: ${m.srd_clave} no está en el SRD local`);
      }
      if (x.tipo === 'dialogo') assert.ok(x.pnj && x.sabe && x.quiere, `${x.id}: diálogo con PNJ, qué sabe y qué quiere`);
      if (x.tipo === 'final') assert.ok(x.recompensas && x.xp !== undefined, `${x.id}: final con recompensas y XP`);
      if (a.id !== 'molino') assert.ok(x.texto.split(/[.!?»]\s/).length >= 2 && x.notas, `${x.id}: texto para leer (2-4 frases) y notas`);
    }
    for (const fl of flechas) {
      const variable = fl.condicion?.split('=')[0].trim();
      if (variable && /^\w+$/.test(variable)) assert.ok(variable in a.variables, `condición sobre variable inexistente: ${fl.condicion}`);
    }
    assert.ok(imagenesDeCampana(a.id, a.diagrama, []).length >= 8, 'lista de imágenes');
  });
}

test('tamaños: cortas de 10 a 14 nodos y largas de 30 a 40', () => {
  for (const id of ['cripta', 'feria']) if (AVENTURAS[id]) assert.ok(AVENTURAS[id].diagrama.nodos.length >= 10 && AVENTURAS[id].diagrama.nodos.length <= 14, id);
  for (const id of ['rey', 'minas', 'mar']) if (AVENTURAS[id]) assert.ok(AVENTURAS[id].diagrama.nodos.length >= 30 && AVENTURAS[id].diagrama.nodos.length <= 40, id);
});
