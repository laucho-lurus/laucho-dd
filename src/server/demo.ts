import type { DatosIniciales } from './repositorio-memoria.ts';
import type { Arma, Caracteristicas, Personaje } from './repositorio.ts';

// Campaña de ejemplo para `npm run dev` (solo en memoria, nunca se escribe en Neon).
export const CAMPANA_DEMO_ID = '00000000-0000-4000-8000-000000000001';

type Ficha = [fue: number, des: number, con: number, int: number, sab: number, car: number];

const personaje = (
  n: number,
  nombre: string,
  raza: string,
  clase: string,
  [fue, des, con, int, sab, car]: Ficha,
  pg: number,
  ca: number,
  armas: Arma[],
): Personaje => {
  const caracteristicas: Caracteristicas = { fue, des, con, int, sab, car };
  return {
    id: `00000000-0000-4000-8000-00000000010${n}`,
    campana_id: CAMPANA_DEMO_ID,
    nombre,
    raza,
    clase,
    nivel: 1,
    caracteristicas,
    pg_max: pg,
    pg_actual: pg,
    datos: { ca, armas },
  };
};

const arma = (nombre: string, ataque: string, dano: string): Arma => ({ nombre, ataque, dano });

export const DATOS_DEMO: DatosIniciales = {
  campanas: [
    {
      id: CAMPANA_DEMO_ID,
      nombre: 'La mina perdida (demo)',
      resumen: 'Demo corta: unos kobolds ocupan la entrada de una mina abandonada.',
      variables: { antorchas_encendidas: false },
      diagrama: {
        introduccion: '{heroes} esperan en la plaza de Piedragris, un pueblo minero a los pies de las montañas. El alcalde os ha contratado para limpiar la vieja mina de plata, ocupada por kobolds desde la primavera. Os entrega una lámpara, un mapa garabateado y la promesa de 30 monedas de oro para cada uno.',
        nodos: [
          { id: '1', tipo: 'escena', titulo: 'La boca de la mina', texto: 'Un túnel oscuro huele a humo y a kobold.', notas: 'Percepción CD 10 para ver huellas recientes.' },
          { id: '2', tipo: 'combate', titulo: 'La emboscada', texto: 'Tres kobolds atacan desde las vagonetas.', notas: '3 kobolds (CA 12, PG 5, daga +4 1d4+2).' },
          { id: '3', tipo: 'final', titulo: 'El filón', texto: 'Tras los kobolds brilla una veta de plata.', notas: 'Recompensa: 30 po cada uno.' },
        ],
        flechas: [
          { desde: '1', hasta: '2', etiqueta: 'Entran al túnel' },
          { desde: '2', hasta: '3', etiqueta: 'Vencen a los kobolds' },
        ],
      },
    },
  ],
  personajes: [
    personaje(1, 'Brisa', 'Mediana', 'Pícara', [8, 17, 12, 13, 12, 14], 9, 14, [arma('Estoque', '+5', '1d8+3 perforante'), arma('Arco corto', '+5', '1d6+3 perforante')]),
    personaje(2, 'Torvald', 'Enano', 'Guerrero', [16, 12, 16, 10, 11, 8], 13, 18, [arma('Hacha de batalla', '+5', '1d8+3 cortante'), arma('Hacha de mano', '+5', '1d6+3 cortante')]),
    personaje(3, 'Ilyra', 'Elfa', 'Maga', [8, 14, 12, 17, 13, 10], 7, 12, [arma('Daga', '+4', '1d4+2 perforante'), arma('Rayo de escarcha', '+5', '1d8 frío')]),
    personaje(4, 'Doran', 'Humano', 'Clérigo', [14, 10, 14, 10, 16, 12], 10, 18, [arma('Maza', '+4', '1d6+2 contundente')]),
    personaje(5, 'Kesh', 'Dracónido', 'Paladín', [17, 10, 14, 8, 10, 15], 12, 18, [arma('Espada larga', '+5', '1d8+3 cortante'), arma('Jabalina', '+5', '1d6+3 perforante')]),
    personaje(6, 'Mira', 'Semielfa', 'Barda', [8, 14, 12, 12, 10, 17], 9, 13, [arma('Estoque', '+4', '1d8+2 perforante')]),
    personaje(7, 'Grok', 'Semiorco', 'Bárbaro', [17, 13, 16, 8, 12, 10], 15, 14, [arma('Gran hacha', '+5', '1d12+3 cortante')]),
  ],
};
