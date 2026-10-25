import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivoPorDefecto, motivoValido, textoPeticion, textoTirada } from './tiradas.ts';

test('motivo: obligatorio, no genérico y con al menos 8 caracteres', () => {
  assert.ok(motivoValido('Daño del estoque al kobold'));
  for (const malo of [undefined, null, '', 'daño', 'Tirada', 'dado', 'corto']) assert.equal(motivoValido(malo), false, String(malo));
  assert.equal(motivoPorDefecto('1d20+5'), 'Tirada de d20');
  assert.equal(motivoPorDefecto('1d8+3'), 'Daño');
});

test('textos de petición y resultado', () => {
  assert.equal(textoPeticion('Brisa', 'Daño del estoque al kobold', '1d8+3'), 'El GM pide a Brisa: Daño del estoque al kobold (1d8+3).');
  const r = { notation: '1d8+3', rolls: [2], kept: [2], modifier: 3, total: 5 };
  assert.equal(textoTirada('Brisa', r, 'Daño del estoque al kobold', null), '🎲 Brisa tira 1d8+3 · Daño del estoque al kobold: [2] +3 = 5');
  assert.equal(textoTirada('Brisa', { ...r, notation: '1d20+5', total: 17 }, 'Ataque con arco', true), '🎲 Brisa tira 1d20+5 · Ataque con arco: [2] +3 = 17 — ¡Éxito!');
});
