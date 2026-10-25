// Datos de la aventura "El Molino Silencioso" (los usa el script de carga y los tests).

export const NOMBRE_CAMPANA = 'El Molino Silencioso';

export const variables = { llave_palomar: false, goblins_alerta: false, snik_aliado: false, mila_rescatada: false };

export const resumen =
  'Aventura corta nivel 1 (1-2 h): los goblins del osgo Grak tomaron el molino de Robleda y retienen a la molinera Mila.';

// Campos del editor para cada nodo (habilidad y CD, monstruos, opciones, PNJ, recompensas).
const EXTRAS: Record<string, Record<string, unknown>> = {
  '2': { opciones: ['Sí, salen ya', 'No / mañana'] },
  '2b': { monstruos: [{ srd_clave: 'goblin', cantidad: 3 }] },
  '3': { chequeo: 'supervivencia', cd: 12 },
  '3c': { monstruos: [{ srd_clave: 'wolf', cantidad: 2 }] },
  '5': { monstruos: [{ srd_clave: 'goblin', cantidad: 2 }] },
  '6': { pnj: 'Snik', sabe: 'Que Grak le teme al fuego y cuántos goblins quedan.', quiere: 'Salir vivo del molino.' },
  '8': { monstruos: [{ srd_clave: 'bugbear', cantidad: 1 }, { srd_clave: 'goblin', cantidad: 1 }] },
  '9': { recompensas: '50 po (+25 si Mila vuelve viva), lucero del alba de Grak, poción de curación', xp: 450 },
};

const nodo = (id: string, tipo: string, titulo: string, texto: string, notas = '') => ({ id, tipo, titulo, texto, notas, ...EXTRAS[id] });
const flecha = (desde: string, hasta: string, etiqueta: string, condicion?: string) =>
  ({ desde, hasta, etiqueta, ...(condicion && { condicion }) });

export const diagrama = {
  nodos: [
    nodo('1', 'escena', 'La posada del Roble Partido',
      'El alcalde Bertram ofrece 50 po (+25 si traen viva a Mila). El niño Tobías cuenta que su madre guarda una llave del molino en el palomar.',
      'Si hablan con Tobías: activa llave_palomar.'),
    nodo('2', 'decision', '¿Aceptan el trabajo?', 'Bertram espera una respuesta.'),
    nodo('2b', 'evento', 'Asalto al granero', 'Esa noche, 3 goblins asaltan el granero.',
      'Combate: 3 goblins. Si huye uno: activa goblins_alerta.'),
    nodo('3', 'tirada', 'El camino del río', 'Siguen el río hacia el molino.',
      'Supervivencia o Percepción CD 12 (grupal).'),
    nodo('3c', 'combate', 'Los lobos guardianes', 'Dos lobos salen del bosque.',
      'Combate: 2 lobos. Activa goblins_alerta.'),
    nodo('4', 'escena', 'El molino por fuera', 'Tres entradas posibles: la puerta, el palomar y la rueda.',
      'Puerta: Sigilo CD 12 vs 2 goblins. Palomar: Atletismo CD 10; con llave_palomar hay llave de la trampilla. Rueda: Atletismo CD 13.'),
    nodo('5', 'combate', 'La planta baja', 'Goblins entre sacos de harina.',
      '2 goblins (3 si goblins_alerta). Snik se rinde si cae el otro o queda con ≤3 PG.'),
    nodo('6', 'dialogo', 'Snik, el cobarde', 'El goblin Snik suplica por su vida.',
      'Persuasión o Intimidación CD 10. Éxito: dice que Grak le teme al fuego (activa snik_aliado). Fracaso: miente, dice que hay cinco goblins.'),
    nodo('7', 'escena', 'El sótano y la cueva', 'El osgo Grak exige 100 po de tributo al mes.',
      'Negociar: Persuasión CD 15 (se va por 20 po) o Engaño CD 14. Si no, pelea.'),
    nodo('8', 'combate', 'Grak y su goblin', 'Grak alza su lucero del alba.',
      'Osgo Grak + 1 goblin. Con snik_aliado y fuego, Grak tiene desventaja en su siguiente ataque. Huye con ≤8 PG. Al terminar: activa mila_rescatada.'),
    nodo('9', 'final', 'La rueda vuelve a girar', 'El molino vuelve a moler y Robleda celebra.',
      'Recompensa: 50 po (+25 si mila_rescatada), lucero del alba de Grak, poción de curación. XP: goblin 50, lobo 50, osgo 200. Gancho: túnel al norte con un puño rojo.'),
  ],
  flechas: [
    flecha('1', '2', 'Continuar'),
    flecha('2', '3', 'Sí, salen ya'),
    flecha('2', '2b', 'No / mañana'),
    flecha('2b', '3', 'Al amanecer'),
    flecha('3', '4', 'Éxito'),
    flecha('3', '3c', 'Fracaso'),
    flecha('3c', '4', 'Tras el combate'),
    flecha('4', '5', 'Puerta (Sigilo CD 12)'),
    flecha('4', '5', 'Palomar (Atletismo CD 10)'),
    flecha('4', '7', 'Rueda (Atletismo CD 13)'),
    flecha('5', '6', 'Snik se rinde', 'Snik cae a ≤3 PG o cae el otro goblin'),
    flecha('5', '7', 'Sin rendición'),
    flecha('6', '7', 'Bajan al sótano'),
    flecha('7', '9', 'Negociación exitosa'),
    flecha('7', '8', 'Pelean'),
    flecha('8', '9', 'Grak vencido o huye', 'mila_rescatada'),
  ],
};

export const criaturas = [
  {
    nombre: 'Goblin', srd_clave: 'goblin',
    stats: { ca: 15, pg: 7, ataques: [{ nombre: 'Cimitarra', ataque: '+4', dano: '1d6+2 cortante' }], rasgo: 'Huida ágil: puede retirarse o esconderse como acción adicional.' },
  },
  {
    nombre: 'Lobo', srd_clave: 'wolf',
    stats: { ca: 13, pg: 11, ataques: [{ nombre: 'Mordisco', ataque: '+4', dano: '2d4+2 perforante' }], rasgo: 'Derribo: si el mordisco impacta, salvación de FUE CD 11 o queda derribado.' },
  },
  {
    nombre: 'Grak', srd_clave: 'bugbear',
    stats: { ca: 16, pg: 27, ataques: [{ nombre: 'Lucero del alba', ataque: '+4', dano: '2d8+2 perforante' }], rasgo: 'Ataque por sorpresa: +2d6 de daño si sorprende al objetivo en la primera ronda.' },
  },
];
