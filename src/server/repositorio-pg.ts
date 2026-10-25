import pg from 'pg';
import type { Campana, Evento, NuevaImagen, NuevoEvento, Personaje, Repositorio, Sesion } from './repositorio.ts';

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

  async crearPersonaje(p: Personaje, imagen: NuevaImagen | null) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      let imagenId: string | null = null;
      if (imagen) {
        const r = await cliente.query<{ id: string }>(
          "insert into imagenes (ruta, origen, pertenece_a) values ($1, 'subida', $2) returning id",
          [imagen.ruta, `personaje:${p.id}`],
        );
        imagenId = r.rows[0].id;
      }
      await cliente.query(
        `insert into personajes (id, campana_id, nombre, descripcion, raza, clase, nivel, caracteristicas, pg_max, pg_actual, datos, imagen_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [p.id, p.campana_id, p.nombre, p.descripcion ?? '', p.raza, p.clase, p.nivel,
          JSON.stringify(p.caracteristicas), p.pg_max, p.pg_actual, JSON.stringify(p.datos), imagenId],
      );
      await cliente.query('commit');
      return { ...p, imagen_url: imagen ? `/${imagen.ruta}` : null };
    } catch (err) {
      await cliente.query('rollback');
      throw err;
    } finally {
      cliente.release();
    }
  }

  async guardarPg(personajeId: string, pgActual: number) {
    await this.pool.query('update personajes set pg_actual = $2 where id = $1', [personajeId, pgActual]);
  }

  async buscarCampana(id: string) {
    if (!UUID.test(id)) return null;
    const r = await this.pool.query<Campana>('select id, nombre, diagrama, variables, resumen from campanas where id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async personajesDeCampana(campanaId: string) {
    const r = await this.pool.query<Personaje>(
      `select p.id, p.campana_id, p.nombre, p.descripcion, p.raza, p.clase, p.nivel, p.caracteristicas,
              p.pg_max, p.pg_actual, p.datos, '/' || i.ruta as imagen_url
         from personajes p left join imagenes i on i.id = p.imagen_id
        where p.campana_id = $1 order by p.creado_en`,
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
