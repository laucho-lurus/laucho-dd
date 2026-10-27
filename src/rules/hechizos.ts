// Hechizos del SRD 5.1 (trucos y nivel 1) en español, y qué puede elegir cada clase al crear el personaje.
import type { Caracteristicas } from '../server/repositorio.ts';
import { claseBase } from './rasgos.ts';
import { modificador } from './habilidades.ts';

type Car = keyof Caracteristicas;

export type Efecto =
  | { tipo: 'ataque'; dano: string; tipo_dano: string } // tirada de ataque contra la CA
  | { tipo: 'salvacion'; car: Car; dano: string; tipo_dano: string; mitad: boolean } // el objetivo salva contra tu CD
  | { tipo: 'automatico'; dano: string; tipo_dano: string } // impacta siempre
  | { tipo: 'curacion'; curacion: string } // + modificador de lanzamiento
  | { tipo: 'utilidad' };

export interface Hechizo {
  id: string;
  nombre: string;
  nivel: 0 | 1; // 0 = truco
  clases: string[];
  alcance: string;
  descripcion: string;
  efecto: Efecto;
}

const B = 'Bardo', C = 'Clérigo', D = 'Druida', H = 'Hechicero', W = 'Brujo', M = 'Mago', P = 'Paladín', E = 'Explorador';

const h = (id: string, nombre: string, nivel: 0 | 1, clases: string[], alcance: string, descripcion: string, efecto: Efecto = { tipo: 'utilidad' }): Hechizo =>
  ({ id, nombre, nivel, clases, alcance, descripcion, efecto });
const ataque = (dano: string, tipo_dano: string): Efecto => ({ tipo: 'ataque', dano, tipo_dano });
const salva = (car: Car, dano: string, tipo_dano: string, mitad = false): Efecto => ({ tipo: 'salvacion', car, dano, tipo_dano, mitad });

const LISTA: Hechizo[] = [
  // Trucos
  h('descarga_de_fuego', 'Descarga de fuego', 0, [H, M], '36 m', 'Lanzas una mota de fuego: ataque de conjuro a distancia, 1d10 de fuego.', ataque('1d10', 'fuego')),
  h('rayo_de_escarcha', 'Rayo de escarcha', 0, [H, M], '18 m', 'Un rayo helado: ataque de conjuro a distancia, 1d8 de frío y la velocidad del objetivo baja 3 m.', ataque('1d8', 'frío')),
  h('toque_helado', 'Toque helado', 0, [W, H, M], '36 m', 'Una mano esquelética: ataque de conjuro a distancia, 1d8 necrótico y el objetivo no recupera PG hasta tu próximo turno.', ataque('1d8', 'necrótico')),
  h('agarre_electrizante', 'Agarre electrizante', 0, [H, M], 'Toque', 'Ataque de conjuro cuerpo a cuerpo, 1d8 de relámpago; el objetivo no puede hacer reacciones.', ataque('1d8', 'relámpago')),
  h('salpicadura_acida', 'Salpicadura ácida', 0, [H, M], '18 m', 'Una burbuja de ácido: salvación de DES o 1d6 de ácido.', salva('des', '1d6', 'ácido')),
  h('rociada_venenosa', 'Rociada venenosa', 0, [D, W, H, M], '3 m', 'Una nube tóxica: salvación de CON o 1d12 de veneno.', salva('con', '1d12', 'veneno')),
  h('descarga_sobrenatural', 'Descarga sobrenatural', 0, [W], '36 m', 'Un haz de energía crepitante: ataque de conjuro a distancia, 1d10 de fuerza.', ataque('1d10', 'fuerza')),
  h('llama_sagrada', 'Llama sagrada', 0, [C], '18 m', 'Un resplandor cae sobre el objetivo: salvación de DES o 1d8 radiante (ignora cobertura).', salva('des', '1d8', 'radiante')),
  h('burla_cruel', 'Burla cruel', 0, [B], '18 m', 'Insultos cargados de magia: salvación de SAB o 1d4 psíquico y desventaja en su próximo ataque.', salva('sab', '1d4', 'psíquico')),
  h('producir_llama', 'Producir llama', 0, [D], '9 m', 'Una llama en tu mano que ilumina; puedes arrojarla: ataque de conjuro a distancia, 1d8 de fuego.', ataque('1d8', 'fuego')),
  h('garrote', 'Garrote', 0, [D], 'Toque', 'Tu bastón o garrote usa tu SAB para atacar y hace 1d8 durante 1 minuto.'),
  h('guia', 'Guía', 0, [C, D], 'Toque', 'El objetivo suma 1d4 a una prueba de característica antes de 1 minuto.'),
  h('luz', 'Luz', 0, [B, C, H, M], 'Toque', 'Un objeto brilla con luz intensa en 6 m durante 1 hora.'),
  h('mano_de_mago', 'Mano de mago', 0, [B, W, H, M], '9 m', 'Una mano espectral manipula objetos ligeros a distancia.'),
  h('prestidigitacion', 'Prestidigitación', 0, [B, W, H, M], '3 m', 'Trucos menores: chispas, limpiar, enfriar, marcar o dar sabor.'),
  h('ilusion_menor', 'Ilusión menor', 0, [B, W, H, M], '9 m', 'Creas un sonido o una imagen inmóvil durante 1 minuto.'),
  h('mensaje', 'Mensaje', 0, [B, H, M], '36 m', 'Susurras un mensaje a una criatura y solo ella puede responderte.'),
  h('taumaturgia', 'Taumaturgia', 0, [C], '9 m', 'Una pequeña maravilla: voz atronadora, temblores, llamas que parpadean.'),
  h('perdonar_a_los_moribundos', 'Perdonar a los moribundos', 0, [C], 'Toque', 'Estabilizas a una criatura viva con 0 PG.'),
  h('druidismo', 'Druidismo', 0, [D], '9 m', 'Pequeños efectos naturales: predecir el tiempo, hacer florecer una planta.'),
  // Nivel 1
  h('curar_heridas', 'Curar heridas', 1, [B, C, D, P, E], 'Toque', 'Una criatura que tocas recupera 1d8 + tu modificador de lanzamiento en PG.', { tipo: 'curacion', curacion: '1d8' }),
  h('palabra_de_curacion', 'Palabra de curación', 1, [B, C, D], '18 m', 'Como acción adicional, una criatura que ves recupera 1d4 + tu modificador en PG.', { tipo: 'curacion', curacion: '1d4' }),
  h('proyectil_magico', 'Proyectil mágico', 1, [H, M], '36 m', 'Tres dardos de fuerza que nunca fallan: 3d4+3 de fuerza en total.', { tipo: 'automatico', dano: '3d4+3', tipo_dano: 'fuerza' }),
  h('manos_ardientes', 'Manos ardientes', 1, [H, M], 'Cono de 4,5 m', 'Una lámina de llamas: salvación de DES, 3d6 de fuego (mitad si salva).', salva('des', '3d6', 'fuego', true)),
  h('ola_atronadora', 'Ola atronadora', 1, [B, D, H, M], 'Cubo de 4,5 m', 'Una onda de fuerza: salvación de CON, 2d8 de trueno y empuja 3 m (mitad si salva).', salva('con', '2d8', 'trueno', true)),
  h('saeta_guia', 'Saeta guía', 1, [C], '36 m', 'Un rayo de luz: ataque de conjuro a distancia, 4d6 radiante; el próximo ataque contra él tiene ventaja.', ataque('4d6', 'radiante')),
  h('infligir_heridas', 'Infligir heridas', 1, [C], 'Toque', 'Ataque de conjuro cuerpo a cuerpo: 3d10 necrótico.', ataque('3d10', 'necrótico')),
  h('rayo_de_enfermedad', 'Rayo de enfermedad', 1, [H, M], '18 m', 'Ataque de conjuro a distancia: 2d8 de veneno (CON o envenenado).', ataque('2d8', 'veneno')),
  h('brazos_de_hadar', 'Brazos de Hadar', 1, [W], '3 m a tu alrededor', 'Tentáculos oscuros: salvación de FUE, 2d6 necrótico (mitad si salva).', salva('fue', '2d6', 'necrótico', true)),
  h('represion_infernal', 'Represión infernal', 1, [W], '18 m', 'Como reacción al recibir daño: salvación de DES, 2d10 de fuego (mitad si salva).', salva('des', '2d10', 'fuego', true)),
  h('dormir', 'Dormir', 1, [B, H, M], '27 m', 'Duermes criaturas con un total de 5d8 PG, empezando por la más débil.'),
  h('escudo', 'Escudo', 1, [H, M], 'Personal', 'Como reacción, +5 a la CA hasta tu próximo turno.'),
  h('armadura_de_mago', 'Armadura de mago', 1, [H, M], 'Toque', 'Sin armadura, la CA base pasa a 13 + DES durante 8 horas.'),
  h('bendicion', 'Bendición', 1, [C, P], '9 m', 'Hasta tres criaturas suman 1d4 a ataques y salvaciones (concentración, 1 minuto).'),
  h('escudo_de_la_fe', 'Escudo de la fe', 1, [C, P], '18 m', '+2 a la CA de una criatura (concentración, 10 minutos).'),
  h('hechizar_persona', 'Hechizar persona', 1, [B, W, D, H, M], '9 m', 'Un humanoide salva SAB o te considera un amigo durante 1 hora.'),
  h('detectar_magia', 'Detectar magia', 1, [B, C, D, P, E, H, M], 'Personal', 'Sientes la magia a 9 m durante 10 minutos (ritual).'),
  h('fuego_feerico', 'Fuego feérico', 1, [B, D], '18 m', 'Las criaturas en un cubo de 6 m salvan DES o brillan: ataques contra ellas con ventaja.'),
  h('enmaranar', 'Enmarañar', 1, [D], '27 m', 'Plantas en un cuadrado de 6 m: salvación de FUE o quedan apresadas.'),
  h('nube_de_oscurecimiento', 'Nube de oscurecimiento', 1, [D, E, H, M], '36 m', 'Una esfera de niebla de 6 m de radio oscurece la zona por completo.'),
  h('marca_del_cazador', 'Marca del cazador', 1, [E], '27 m', 'Marcas a una presa: +1d6 de daño a tus ataques contra ella.'),
  h('heroismo', 'Heroísmo', 1, [B, P], 'Toque', 'Inmune al miedo y PG temporales igual a tu modificador cada turno.'),
];

export const HECHIZOS: Readonly<Record<string, Hechizo>> = Object.fromEntries(LISTA.map((x) => [x.id, x]));

/** Lanzadores: característica de lanzamiento y cuántos trucos y hechizos de nivel 1 eligen al crear el personaje. */
export interface Lanzador {
  car: Car;
  trucos: number;
  nivel1: number | 'preparados'; // preparados: modificador + nivel (mínimo 1)
  desde_nivel: number; // paladín y explorador lanzan desde nivel 2
}

export const LANZADORES: Readonly<Record<string, Lanzador>> = {
  [B]: { car: 'car', trucos: 2, nivel1: 4, desde_nivel: 1 },
  [C]: { car: 'sab', trucos: 3, nivel1: 'preparados', desde_nivel: 1 },
  [D]: { car: 'sab', trucos: 2, nivel1: 'preparados', desde_nivel: 1 },
  [H]: { car: 'car', trucos: 4, nivel1: 2, desde_nivel: 1 },
  [W]: { car: 'car', trucos: 2, nivel1: 2, desde_nivel: 1 },
  [M]: { car: 'int', trucos: 3, nivel1: 6, desde_nivel: 1 }, // su libro: 6 de nivel 1
  [P]: { car: 'car', trucos: 0, nivel1: 0, desde_nivel: 2 },
  [E]: { car: 'sab', trucos: 0, nivel1: 0, desde_nivel: 2 },
};

export const lanzadorDe = (clase: string): Lanzador | null => LANZADORES[claseBase(clase)] ?? null;

export const hechizosDeClase = (clase: string) => LISTA.filter((x) => x.clases.includes(claseBase(clase)));

/** Cuántos trucos y hechizos de nivel 1 elige la clase al crear el personaje. */
export function cupos(clase: string, car: Caracteristicas, nivel = 1): { trucos: number; nivel1: number } {
  const l = lanzadorDe(clase);
  if (!l || nivel < l.desde_nivel) return { trucos: 0, nivel1: 0 };
  return { trucos: l.trucos, nivel1: l.nivel1 === 'preparados' ? Math.max(1, modificador(car[l.car]) + nivel) : l.nivel1 };
}

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Valida la elección de la creación: hechizos de la clase, sin repetir y en la cantidad exacta. */
export function validarEleccion(clase: string, car: Caracteristicas, ids: unknown): Res<string[]> {
  const { trucos, nivel1 } = cupos(clase, car);
  const lista = ids === undefined ? [] : ids;
  if (!Array.isArray(lista) || !lista.every((x) => typeof x === 'string')) return { ok: false, error: 'Los hechizos no son válidos' };
  if (new Set(lista).size !== lista.length) return { ok: false, error: 'Hay hechizos repetidos' };
  const deClase = new Set(hechizosDeClase(clase).map((x) => x.id));
  const ajeno = lista.find((id) => !deClase.has(id));
  if (ajeno) return { ok: false, error: `${HECHIZOS[ajeno]?.nombre ?? ajeno} no es un hechizo de tu clase` };
  const elegidos = lista.map((id) => HECHIZOS[id]);
  const t = elegidos.filter((x) => x.nivel === 0).length;
  const n = elegidos.filter((x) => x.nivel === 1).length;
  if (t !== trucos || n !== nivel1) return { ok: false, error: `Tu clase elige ${trucos} trucos y ${nivel1} hechizos de nivel 1 (elegiste ${t} y ${n})` };
  return { ok: true, valor: lista };
}
