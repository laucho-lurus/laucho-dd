// Tope de gasto mensual de la IA, guardado en un archivo JSON local (data/gasto-ia.json).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const AVISO_FRACCION = 0.8;

export type NivelGasto = 'ok' | 'aviso' | 'agotado';

export interface EstadoGasto {
  gastado: number;
  tope: number;
  nivel: NivelGasto;
}

interface Registro {
  mes: string; // "2026-10"
  usd: number;
}

const mesDe = (fecha: Date) => fecha.toISOString().slice(0, 7);

export class Presupuesto {
  private readonly archivo: string;
  private readonly tope: number;
  private readonly ahora: () => Date;
  private registro: Registro | null = null;

  constructor(archivo: string, tope: number, ahora: () => Date = () => new Date()) {
    this.archivo = archivo;
    this.tope = tope;
    this.ahora = ahora;
  }

  private async cargar(): Promise<Registro> {
    const mes = mesDe(this.ahora());
    if (this.registro?.mes === mes) return this.registro;
    try {
      const leido = JSON.parse(await readFile(this.archivo, 'utf8')) as Registro;
      this.registro = leido.mes === mes && typeof leido.usd === 'number' ? leido : { mes, usd: 0 };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[ia] gasto-ia.json ilegible; empiezo en 0:', (err as Error).message);
      this.registro = { mes, usd: 0 };
    }
    return this.registro;
  }

  async estado(): Promise<EstadoGasto> {
    const { usd } = await this.cargar();
    const nivel: NivelGasto = usd >= this.tope ? 'agotado' : usd >= this.tope * AVISO_FRACCION ? 'aviso' : 'ok';
    return { gastado: usd, tope: this.tope, nivel };
  }

  /** Suma un gasto y devuelve el estado nuevo. */
  async registrar(usd: number): Promise<EstadoGasto> {
    const actual = await this.cargar();
    this.registro = { ...actual, usd: actual.usd + usd };
    await mkdir(dirname(this.archivo), { recursive: true });
    await writeFile(this.archivo, JSON.stringify(this.registro, null, 2));
    return this.estado();
  }
}
