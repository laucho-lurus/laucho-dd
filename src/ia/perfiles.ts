// Perfiles del GM IA, guardados en data/gm-perfiles.json (luego irán a la tabla gm_perfiles).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DIFICULTADES = ['relajada', 'normal', 'dura'] as const;
export type Dificultad = (typeof DIFICULTADES)[number];

export interface PerfilGm {
  id: string;
  nombre: string;
  descripcion: string;
  tono: string;
  dificultad: Dificultad;
}

const LIMITES = { nombre: 40, descripcion: 200, tono: 1000 };

export const PERFILES_INICIALES: PerfilGm[] = [
  {
    id: 'cronista',
    nombre: 'El Cronista',
    descripcion: 'Narrador épico de ritmo pausado.',
    tono: 'Voz solemne de cronista antiguo. Frases largas y evocadoras, descripciones sensoriales, deja respirar cada escena. Trata los momentos importantes como leyenda.',
    dificultad: 'normal',
  },
  {
    id: 'tabernera',
    nombre: 'La Tabernera',
    descripcion: 'Cálida y con humor; PNJ memorables.',
    tono: 'Cercana y con humor amable, como quien cuenta historias junto al fuego. Da a cada PNJ una voz, un gesto o una manía reconocible. Ritmo ágil.',
    dificultad: 'relajada',
  },
];

/** Valida los campos de un perfil enviado por el cliente. */
export function validarPerfil(datos: unknown): { ok: true; perfil: Omit<PerfilGm, 'id'> } | { ok: false; error: string } {
  if (typeof datos !== 'object' || datos === null) return { ok: false, error: 'Perfil inválido' };
  const d = datos as Record<string, unknown>;
  const campos: Record<string, string> = {};
  for (const [campo, max] of Object.entries(LIMITES)) {
    const v = typeof d[campo] === 'string' ? (d[campo] as string).trim() : '';
    if (!v) return { ok: false, error: `Falta "${campo}"` };
    if (v.length > max) return { ok: false, error: `"${campo}" admite hasta ${max} caracteres` };
    campos[campo] = v;
  }
  if (!(DIFICULTADES as readonly unknown[]).includes(d.dificultad)) return { ok: false, error: 'Dificultad inválida' };
  return { ok: true, perfil: { nombre: campos.nombre, descripcion: campos.descripcion, tono: campos.tono, dificultad: d.dificultad as Dificultad } };
}

export class Perfiles {
  private readonly archivo: string;
  private lista: PerfilGm[] | null = null;

  constructor(archivo: string) {
    this.archivo = archivo;
  }

  async listar(): Promise<PerfilGm[]> {
    if (this.lista) return this.lista;
    try {
      this.lista = JSON.parse(await readFile(this.archivo, 'utf8')) as PerfilGm[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.lista = PERFILES_INICIALES;
      await this.guardar();
    }
    return this.lista;
  }

  async buscar(id: string) {
    return (await this.listar()).find((p) => p.id === id) ?? null;
  }

  /** Crea (sin id) o reemplaza (con id existente) un perfil. */
  async guardarPerfil(id: string | null, datos: Omit<PerfilGm, 'id'>): Promise<PerfilGm> {
    const lista = await this.listar();
    if (id && !lista.some((p) => p.id === id)) throw new Error('No existe ese perfil');
    const perfil = { id: id ?? randomUUID(), ...datos };
    this.lista = id ? lista.map((p) => (p.id === id ? perfil : p)) : [...lista, perfil];
    await this.guardar();
    return perfil;
  }

  private async guardar() {
    await mkdir(dirname(this.archivo), { recursive: true });
    await writeFile(this.archivo, JSON.stringify(this.lista, null, 2));
  }
}
