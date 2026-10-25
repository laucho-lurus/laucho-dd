import type { DatosIniciales } from './repositorio-memoria.ts';

// Campaña de ejemplo para `npm run dev` (solo en memoria, nunca se escribe en Neon).
export const CAMPANA_DEMO_ID = '00000000-0000-4000-8000-000000000001';

const personaje = (n: number, nombre: string, raza: string, clase: string) => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  campana_id: CAMPANA_DEMO_ID,
  nombre,
  raza,
  clase,
  nivel: 1,
});

export const DATOS_DEMO: DatosIniciales = {
  campanas: [{ id: CAMPANA_DEMO_ID, nombre: 'La mina perdida (demo)' }],
  personajes: [
    personaje(1, 'Brisa', 'Mediana', 'Pícara'),
    personaje(2, 'Torvald', 'Enano', 'Guerrero'),
    personaje(3, 'Ilyra', 'Elfa', 'Maga'),
    personaje(4, 'Doran', 'Humano', 'Clérigo'),
    personaje(5, 'Kesh', 'Dracónido', 'Paladín'),
    personaje(6, 'Mira', 'Semielfa', 'Barda'),
    personaje(7, 'Grok', 'Semiorco', 'Bárbaro'),
  ],
};
