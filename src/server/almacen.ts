// Dónde viven los archivos subidos (retratos, monstruos, escenas, fondos de mapa).
//
// Hoy: disco local (carpeta uploads/, ignorada por git), servido en /uploads/<archivo>.
// Al desplegar se puede cambiar a R2 o S3 sin tocar el resto del código: basta con otra clase
// que implemente `Almacen` (p. ej. con @aws-sdk/client-s3: PutObject en guardar, GetObject en leer,
// DeleteObject en borrar; R2 usa la misma API con su endpoint) y crearla en main.ts en lugar de
// AlmacenDisco. Las rutas guardadas en la tabla imagenes ("uploads/<archivo>") no cambian: el
// servidor sigue sirviendo /uploads/<archivo> leyendo del almacén (o, si se prefiere, redirigiendo
// a una URL firmada del bucket).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export interface Almacen {
  /** Guarda un archivo nuevo. Falla si ya existe (los nombres son UUID). */
  guardar(nombre: string, contenido: Buffer): Promise<void>;
  /** El contenido, o null si no existe. */
  leer(nombre: string): Promise<Buffer | null>;
  /** Borra el archivo; no falla si ya no estaba. */
  borrar(nombre: string): Promise<void>;
}

/** Nombre válido de archivo subido: UUID + extensión de imagen. Evita rutas como "../x". */
export const NOMBRE_SUBIDO = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export class AlmacenDisco implements Almacen {
  private readonly carpeta: URL;

  constructor(carpeta: URL) {
    this.carpeta = carpeta;
  }

  private ruta(nombre: string) {
    if (!NOMBRE_SUBIDO.test(nombre)) throw new Error(`Nombre de archivo inválido: ${nombre}`);
    return new URL(nombre, this.carpeta);
  }

  async guardar(nombre: string, contenido: Buffer) {
    await mkdir(this.carpeta, { recursive: true });
    await writeFile(this.ruta(nombre), contenido, { flag: 'wx' });
  }

  async leer(nombre: string) {
    try {
      return await readFile(this.ruta(nombre));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async borrar(nombre: string) {
    await rm(this.ruta(nombre), { force: true });
  }
}

/** Almacén en memoria para tests. */
export class AlmacenMemoria implements Almacen {
  readonly archivos = new Map<string, Buffer>();

  async guardar(nombre: string, contenido: Buffer) {
    if (!NOMBRE_SUBIDO.test(nombre) || this.archivos.has(nombre)) throw new Error(`No se puede guardar ${nombre}`);
    this.archivos.set(nombre, contenido);
  }

  async leer(nombre: string) {
    return this.archivos.get(nombre) ?? null;
  }

  async borrar(nombre: string) {
    this.archivos.delete(nombre);
  }
}
