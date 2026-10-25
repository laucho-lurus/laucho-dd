// Panel de dados: animación mientras se espera la tirada y resultado con desglose.
import { desglose } from './vista.js';

const GIRO_MINIMO_MS = 600;
const dado = () => document.getElementById('dado');
let inicioGiro = 0;

export function empezarGiro() {
  inicioGiro = Date.now();
  dado().classList.add('girando');
  dado().querySelector('.resultado').textContent = '';
}

export function mostrarResultado(tirada) {
  const espera = Math.max(0, GIRO_MINIMO_MS - (Date.now() - inicioGiro));
  setTimeout(() => {
    dado().classList.remove('girando');
    const r = dado().querySelector('.resultado');
    r.replaceChildren(document.createElement('b'), ` ${tirada.personaje_nombre}: ${desglose(tirada)}`);
    r.firstChild.textContent = tirada.total;
  }, espera);
}

export function detenerGiro() {
  dado().classList.remove('girando');
}
