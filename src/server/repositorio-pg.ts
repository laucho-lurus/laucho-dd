import pg from 'pg';
import type { Campana, Evento, NuevoEvento, Personaje, Repositorio, Sesion } from './repositorio.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_DUPLICADO = '23505'; // unique_violation

interface FilaEvento {
  id: string; // bigint llega como texto
  sesion_id: string;
  tipo: Evento['tipo'];
  autor: string;
  datos: Record<string, unknown>;
  creado_en: Date;
}

const aEvento = (f: FilaEvento): Evento => ({ ...f, id: Number(f.id), creado_en: f.creado_en.toISOString() });

/** Repositorio sobre Postgres/Neon con las tablas de db/schema.sql. */
export class RepositorioPg implements Repositorio {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
    // Sin esto, un corte de conexión inactiva tumba el proceso.
    this.pool.on('error', (err) => console.error('[pg] error en conexión inactiva:', err.message));
  }

  async listarCampanas() {
    const r = await this.pool.query<Campana>('select id, nombre from campanas order by nombre');
    return r.rows;
  }

  async buscarCampana(id: string) {
    if (!UUID.test(id)) return null;
    const r = await this.pool.query<Campana>('select id, nombre from campanas where id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async personajesDeCampana(campanaId: string) {
    const r = await this.pool.query<Personaje>(
      'select id, campana_id, nombre, raza, clase, nivel, caracteristicas, pg_max, pg_actual, datos from personajes where campana_id = $1 order by creado_en',
      [campanaId],
    );
    return r.rows;
  }

  async crearSesion(campanaId: string, codigo: string) {
    try {
      const r = await this.pool.query<Sesion>(
        'insert into sesiones (campana_id, codigo) values ($1, $2) returning id, codigo, campana_id, estado',
        [campanaId, codigo],
      );
      return r.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === CODIGO_DUPLICADO) return null;
      throw err;
    }
  }

  async buscarSesionPorCodigo(codigo: string) {
    const r = await this.pool.query<Sesion>(
      'select id, codigo, campana_id, estado from sesiones where codigo = $1',
      [codigo],
    );
    return r.rows[0] ?? null;
  }

  async registrarEvento(e: NuevoEvento) {
    const r = await this.pool.query<FilaEvento>(
      `insert into eventos (sesion_id, tipo, autor, datos) values ($1, $2, $3, $4)
       returning id, sesion_id, tipo, autor, datos, creado_en`,
      [e.sesion_id, e.tipo, e.autor, JSON.stringify(e.datos)],
    );
    return aEvento(r.rows[0]);
  }

  async ultimosEventos(sesionId: string, limite: number) {
    const r = await this.pool.query<FilaEvento>(
      `select * from (
         select id, sesion_id, tipo, autor, datos, creado_en from eventos
         where sesion_id = $1 order by id desc limit $2
       ) t order by id`,
      [sesionId, limite],
    );
    return r.rows.map(aEvento);
  }

  /** Comprobación de solo lectura: conecta y lista las tablas públicas. */
  async verificar(): Promise<string[]> {
    await this.pool.query('select 1');
    const r = await this.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    return r.rows.map((f) => f.table_name);
  }

  cerrar() {
    return this.pool.end();
  }
}
