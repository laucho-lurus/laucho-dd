// Catálogo de objetos (SRD 5.1, en español) y reglas de equipo: CA por armadura, ataque y daño del arma.
import type { Caracteristicas } from '../server/repositorio.ts';
import { modificador } from './habilidades.ts';

export type TipoItem = 'arma' | 'armadura' | 'escudo' | 'pocion' | 'objeto';

export interface DatosArma {
  dano: string; // "1d8"
  tipo_dano: string;
  propiedades: string[];
  distancia?: string; // "80/320" (pies)
  car: 'fue' | 'des' | 'sutil'; // sutil: la mejor de FUE y DES
}

export interface DatosArmadura {
  categoria: 'ligera' | 'intermedia' | 'pesada';
  ca_base: number;
  fue_min?: number;
  sigilo_desventaja?: boolean;
}

export interface ItemCatalogo {
  id: string;
  nombre: string;
  tipo: TipoItem;
  descripcion: string;
  arma?: DatosArma;
  armadura?: DatosArmadura;
  curacion?: string; // pociones: "2d4+2"
  /** Objetos que la IA no puede regalar por su cuenta (mágicos poderosos). */
  restringido?: boolean;
}

const arma = (id: string, nombre: string, dano: string, tipo_dano: string, car: DatosArma['car'], propiedades: string[], distancia?: string): ItemCatalogo =>
  ({ id, nombre, tipo: 'arma', descripcion: `${dano} ${tipo_dano}${propiedades.length ? ` · ${propiedades.join(', ')}` : ''}${distancia ? ` · ${distancia} pies` : ''}`, arma: { dano, tipo_dano, propiedades, car, ...(distancia && { distancia }) } });

const armadura = (id: string, nombre: string, categoria: DatosArmadura['categoria'], ca_base: number, extra: Partial<DatosArmadura> = {}): ItemCatalogo => {
  const des = categoria === 'ligera' ? ' + DES' : categoria === 'intermedia' ? ' + DES (máx. 2)' : '';
  const req = extra.fue_min ? ` · FUE ${extra.fue_min}` : '';
  return { id, nombre, tipo: 'armadura', descripcion: `Armadura ${categoria}: CA ${ca_base}${des}${req}${extra.sigilo_desventaja ? ' · desventaja en Sigilo' : ''}`, armadura: { categoria, ca_base, ...extra } };
};

const pocion = (id: string, nombre: string, curacion: string, restringido = false): ItemCatalogo =>
  ({ id, nombre, tipo: 'pocion', descripcion: `Recupera ${curacion} PG al beberla (una acción).`, curacion, ...(restringido && { restringido }) });

const objeto = (id: string, nombre: string, descripcion: string): ItemCatalogo => ({ id, nombre, tipo: 'objeto', descripcion });

const LISTA: ItemCatalogo[] = [
  // Armas sencillas y marciales
  arma('daga', 'Daga', '1d4', 'perforante', 'sutil', ['ligera', 'arrojadiza'], '20/60'),
  arma('baston', 'Bastón', '1d6', 'contundente', 'fue', ['versátil (1d8)']),
  arma('maza', 'Maza', '1d6', 'contundente', 'fue', []),
  arma('lanza', 'Lanza', '1d6', 'perforante', 'fue', ['arrojadiza', 'versátil (1d8)'], '20/60'),
  arma('jabalina', 'Jabalina', '1d6', 'perforante', 'fue', ['arrojadiza'], '30/120'),
  arma('ballesta_ligera', 'Ballesta ligera', '1d8', 'perforante', 'des', ['munición', 'recarga', 'a dos manos'], '80/320'),
  arma('arco_corto', 'Arco corto', '1d6', 'perforante', 'des', ['munición', 'a dos manos'], '80/320'),
  arma('espada_corta', 'Espada corta', '1d6', 'perforante', 'sutil', ['ligera']),
  arma('cimitarra', 'Cimitarra', '1d6', 'cortante', 'sutil', ['ligera']),
  arma('estoque', 'Estoque', '1d8', 'perforante', 'sutil', []),
  arma('espada_larga', 'Espada larga', '1d8', 'cortante', 'fue', ['versátil (1d10)']),
  arma('hacha_de_batalla', 'Hacha de batalla', '1d8', 'cortante', 'fue', ['versátil (1d10)']),
  arma('martillo_de_guerra', 'Martillo de guerra', '1d8', 'contundente', 'fue', ['versátil (1d10)']),
  arma('lucero_del_alba', 'Lucero del alba', '1d8', 'perforante', 'fue', []),
  arma('gran_hacha', 'Gran hacha', '1d12', 'cortante', 'fue', ['pesada', 'a dos manos']),
  arma('gran_espada', 'Gran espada', '2d6', 'cortante', 'fue', ['pesada', 'a dos manos']),
  arma('arco_largo', 'Arco largo', '1d8', 'perforante', 'des', ['munición', 'pesada', 'a dos manos'], '150/600'),
  // Armaduras y escudo
  armadura('acolchada', 'Armadura acolchada', 'ligera', 11, { sigilo_desventaja: true }),
  armadura('cuero', 'Armadura de cuero', 'ligera', 11),
  armadura('cuero_tachonado', 'Cuero tachonado', 'ligera', 12),
  armadura('camisote_de_mallas', 'Camisote de mallas', 'intermedia', 13),
  armadura('cota_de_escamas', 'Cota de escamas', 'intermedia', 14, { sigilo_desventaja: true }),
  armadura('coraza', 'Coraza', 'intermedia', 14),
  armadura('cota_de_malla', 'Cota de malla', 'pesada', 16, { fue_min: 13, sigilo_desventaja: true }),
  armadura('armadura_de_bandas', 'Armadura de bandas', 'pesada', 17, { fue_min: 15, sigilo_desventaja: true }),
  armadura('placas', 'Armadura de placas', 'pesada', 18, { fue_min: 15, sigilo_desventaja: true }),
  { id: 'escudo', nombre: 'Escudo', tipo: 'escudo', descripcion: '+2 a la CA mientras lo empuñas.' },
  // Pociones
  pocion('pocion_curacion', 'Poción de curación', '2d4+2'),
  pocion('pocion_curacion_mayor', 'Poción de curación mayor', '4d4+4'),
  pocion('pocion_curacion_superior', 'Poción de curación superior', '8d4+8', true),
  pocion('pocion_curacion_suprema', 'Poción de curación suprema', '10d4+20', true),
  // Objetos varios
  objeto('monedas_oro', 'Monedas de oro', 'Piezas de oro (po).'),
  objeto('antorcha', 'Antorcha', 'Luz brillante en 6 m durante 1 hora.'),
  objeto('cuerda', 'Cuerda de cáñamo (15 m)', 'Aguanta hasta 4 personas.'),
  objeto('raciones', 'Raciones (1 día)', 'Comida seca para un día.'),
  objeto('kit_sanador', 'Kit de sanador', '10 usos: estabiliza a una criatura a 0 PG sin tirada.'),
  objeto('herramientas_ladron', 'Herramientas de ladrón', 'Para abrir cerraduras y desactivar trampas.'),
  objeto('saco_dormir', 'Saco de dormir', 'Para descansar en el camino.'),
  objeto('linterna', 'Linterna sorda', 'Luz en un cono de 18 m durante 6 horas.'),
  objeto('agua_bendita', 'Agua bendita (frasco)', 'Arrojada: 2d6 de daño radiante a no muertos e infernales.'),
  objeto('frasco_aceite', 'Frasco de aceite', 'Encendido: 5 de daño de fuego en una zona de 1,5 m.'),
];

export const CATALOGO: Readonly<Record<string, ItemCatalogo>> = Object.fromEntries(LISTA.map((i) => [i.id, i]));

/** Un objeto en el inventario de un personaje. `item_id` del catálogo o "custom". */
export interface ItemInventario {
  instancia: string; // id único dentro del inventario
  item_id: string;
  nombre: string;
  tipo: TipoItem;
  cantidad: number;
  descripcion: string;
}

export interface Equipo {
  arma?: string; // instancia
  armadura?: string;
  escudo?: string;
}

export const bonoCompetencia = (nivel: number) => 2 + Math.floor((Math.max(1, nivel) - 1) / 4);

const conSigno = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** CA con lo equipado: armadura (DES según categoría) + escudo + modificadores de habilidades. */
export function claseArmadura(car: Caracteristicas, caSinArmadura: number, inventario: ItemInventario[], equipo: Equipo, extra = 0): number {
  const des = modificador(car.des);
  const puesta = inventario.find((i) => i.instancia === equipo.armadura);
  const datos = puesta && CATALOGO[puesta.item_id]?.armadura;
  let ca = caSinArmadura;
  if (datos) ca = datos.ca_base + (datos.categoria === 'ligera' ? des : datos.categoria === 'intermedia' ? Math.min(2, des) : 0);
  if (inventario.some((i) => i.instancia === equipo.escudo && i.tipo === 'escudo')) ca += 2;
  return ca + extra;
}

/** Ataque y daño del arma equipada: característica (FUE, DES o la mejor si es sutil) + competencia. */
export function ataqueConArma(car: Caracteristicas, nivel: number, item: ItemInventario, extraAtaque = 0) {
  const a = CATALOGO[item.item_id]?.arma;
  if (!a) return null;
  const mod = a.car === 'sutil' ? Math.max(modificador(car.fue), modificador(car.des)) : modificador(car[a.car]);
  return {
    nombre: item.nombre,
    ataque: conSigno(mod + bonoCompetencia(nivel) + extraAtaque),
    dano: `${a.dano}${mod ? conSigno(mod) : ''} ${a.tipo_dano}`,
    equipada: true,
  };
}
