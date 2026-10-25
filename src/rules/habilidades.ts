// Habilidades y salvaciones de 5e (SRD) y la tirada que les corresponde.
import type { Caracteristicas } from '../server/repositorio.ts';

type Car = keyof Caracteristicas;

export const HABILIDADES: Readonly<Record<string, { nombre: string; car: Car }>> = {
  acrobacias: { nombre: 'Acrobacias', car: 'des' },
  arcanos: { nombre: 'Arcanos', car: 'int' },
  atletismo: { nombre: 'Atletismo', car: 'fue' },
  engano: { nombre: 'Engaño', car: 'car' },
  historia: { nombre: 'Historia', car: 'int' },
  interpretacion: { nombre: 'Interpretación', car: 'car' },
  intimidacion: { nombre: 'Intimidación', car: 'car' },
  investigacion: { nombre: 'Investigación', car: 'int' },
  juego_de_manos: { nombre: 'Juego de manos', car: 'des' },
  medicina: { nombre: 'Medicina', car: 'sab' },
  naturaleza: { nombre: 'Naturaleza', car: 'int' },
  percepcion: { nombre: 'Percepción', car: 'sab' },
  perspicacia: { nombre: 'Perspicacia', car: 'sab' },
  persuasion: { nombre: 'Persuasión', car: 'car' },
  religion: { nombre: 'Religión', car: 'int' },
  sigilo: { nombre: 'Sigilo', car: 'des' },
  supervivencia: { nombre: 'Supervivencia', car: 'sab' },
  trato_con_animales: { nombre: 'Trato con animales', car: 'sab' },
};

const NOMBRE_CAR: Readonly<Record<Car, string>> = {
  fue: 'Fuerza',
  des: 'Destreza',
  con: 'Constitución',
  int: 'Inteligencia',
  sab: 'Sabiduría',
  car: 'Carisma',
};

export const modificador = (valor: number) => Math.floor((valor - 10) / 2);

/**
 * Notación y motivo de un chequeo: "percepcion" o "salvacion_des".
 * Sin competencias en los datos, solo suma el modificador de la característica.
 */
export function tiradaDeChequeo(clave: string, car: Caracteristicas): { notacion: string; motivo: string } | null {
  const habilidad = Object.hasOwn(HABILIDADES, clave) ? HABILIDADES[clave] : undefined;
  const salvacion = clave.startsWith('salvacion_') ? (clave.slice('salvacion_'.length) as Car) : null;
  const caracteristica = habilidad?.car ?? (salvacion && Object.hasOwn(NOMBRE_CAR, salvacion) ? salvacion : null);
  if (!caracteristica) return null;
  const mod = modificador(car[caracteristica]);
  return {
    notacion: mod === 0 ? '1d20' : `1d20${mod > 0 ? '+' : ''}${mod}`,
    motivo: habilidad ? habilidad.nombre : `Salvación de ${NOMBRE_CAR[caracteristica]}`,
  };
}
