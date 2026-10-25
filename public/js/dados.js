// Dado 3D (CSS): gira mientras se espera al servidor y se detiene mostrando el total que él calculó.
// La lógica de tiradas no cambia; con prefers-reduced-motion no hay animación.
import { desglose } from './vista.js';

const GIRO_MINIMO_MS = 700;
const dado = () => document.getElementById('dado');
let inicioGiro = 0;

/** Seis caras: la frontal muestra el resultado; las demás, números al azar del dado. */
function prepararCubo(caras = 20, total = null) {
  const cubo = dado().querySelector('.cubo');
  cubo.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
    const cara = document.createElement('div');
    cara.className = 'cara-3d';
    cara.textContent = i === 0 && total !== null ? total : 1 + Math.floor(Math.random() * caras);
    if (i === 0) cara.append(Object.assign(document.createElement('small'), { textContent: `d${caras}` }));
    return cara;
  }));
}

const carasDe = (notacion) => Number(/d(\d+)/i.exec(notacion ?? '')?.[1]) || 20;

export function empezarGiro(notacion) {
  inicioGiro = Date.now();
  prepararCubo(carasDe(notacion));
  dado().classList.add('girando');
  dado().querySelector('.resultado').textContent = '';
}

export function mostrarResultado(tirada) {
  const espera = Math.max(0, GIRO_MINIMO_MS - (Date.now() - inicioGiro));
  setTimeout(() => {
    prepararCubo(carasDe(tirada.notation), tirada.total);
    dado().classList.remove('girando');
    const r = dado().querySelector('.resultado');
    r.replaceChildren(document.createElement('b'), ` ${tirada.personaje_nombre}: ${desglose(tirada)}`);
    r.firstChild.textContent = tirada.total;
  }, espera);
}

export function detenerGiro() {
  dado().classList.remove('girando');
}

prepararCubo();
