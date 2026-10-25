import pg from 'pg';
import { plantillaDeCriatura, type Monstruo, type Plantilla } from '../rules/monstruos.ts';
import { MIGRACION_001, MIGRACION_002, type Campana, type EstadoSesion, type Evento, type NuevaImagen, type NuevoEvento, type Personaje, type Repositorio, type Sesion } from './repositorio.ts';

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
  private columnas: Promise<Set<string>> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
    // Sin esto, un corte de conexión inactiva tumba el proceso.
    this.pool.on('error', (err) => console.error('[pg] error en conexión inactiva:', err.message));
  }

  /** Acceso directo a la base para otros almacenes (perfiles de GM). */
  consultor() {
    return this.pool;
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

  async guardarCampana(id: string | null, d: Required<Omit<Campana, 'id'>>) {
    const params = [d.nombre, JSON.stringify(d.diagrama), JSON.stringify(d.variables), d.resumen];
    if (id) {
      if (!UUID.test(id)) throw new Error('No existe esa campaña');
      const r = await this.pool.query<Campana>(
        'update campanas set nombre = $2, diagrama = $3, variables = $4, resumen = $5 where id = $1 returning id, nombre, diagrama, variables, resumen',
        [id, ...params],
      );
      if (!r.rows[0]) throw new Error('No existe esa campaña');
      return r.rows[0];
    }
    // campanas exige un GM (humano o IA): usamos el primer usuario registrado como GM humano.
    const r = await this.pool.query<Campana>(
      `insert into campanas (nombre, diagrama, variables, resumen, gm_usuario_id)
       select $1, $2, $3, $4, (select id from usuarios order by creado_en limit 1)
       where exists (select 1 from usuarios)
       returning id, nombre, diagrama, variables, resumen`,
      params,
    );
    if (!r.rows[0]) throw new Error('Para crear campañas hace falta al menos un usuario GM en la base');
    return r.rows[0];
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

  /** Columnas opcionales de sesiones que ya existen (migraciones 001 y 002). Se consulta una vez. */
  private columnasOpcionales(): Promise<Set<string>> {
    this.columnas ??= this.pool
      .query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'sesiones' and column_name = any($1)`,
        [['variables', 'ia_pausada', 'ia_perfil_id', 'gm_token_hash']],
      )
      .then((r) => new Set(r.rows.map((f) => f.column_name)))
      .catch((err) => {
        this.columnas = null; // reintenta la próxima vez
        throw err;
      });
    return this.columnas;
  }

  private async tieneMigracion001() {
    const c = await this.columnasOpcionales();
    return c.has('variables') && c.has('ia_pausada') && c.has('ia_perfil_id');
  }

  private async tieneMigracion002() {
    return (await this.columnasOpcionales()).has('gm_token_hash');
  }

  async buscarSesionPorCodigo(codigo: string) {
    const con001 = await this.tieneMigracion001();
    const extra = (con001 ? ', variables, ia_pausada, ia_perfil_id' : '') + ((await this.tieneMigracion002()) ? ', gm_token_hash' : '');
    const r = await this.pool.query<Sesion>(
      `select id, codigo, campana_id, estado, nodo_actual${extra} from sesiones where codigo = $1`,
      [codigo],
    );
    const s = r.rows[0];
    return s ? { ...s, variables: con001 ? s.variables : null } : null;
  }

  async guardarEstadoSesion(sesionId: string, e: EstadoSesion) {
    if (await this.tieneMigracion001()) {
      await this.pool.query(
        'update sesiones set nodo_actual = $2, variables = $3, ia_pausada = $4, ia_perfil_id = $5 where id = $1',
        [sesionId, e.nodo_actual, JSON.stringify(e.variables), e.ia_pausada, e.ia_perfil_id],
      );
    } else {
      await this.pool.query('update sesiones set nodo_actual = $2 where id = $1', [sesionId, e.nodo_actual]);
    }
  }

  async criaturasDeCampana(campanaId: string): Promise<Plantilla[]> {
    if (!UUID.test(campanaId)) return [];
    const r = await this.pool.query<{ nombre: string; srd_clave: string | null; stats: Record<string, unknown> }>(
      'select nombre, srd_clave, stats from criaturas where campana_id = $1 or campana_id is null order by nombre',
      [campanaId],
    );
    return r.rows.map(plantillaDeCriatura).filter((p): p is Plantilla => p !== null);
  }

  async monstruosDeSesion(sesionId: string) {
    const r = await this.pool.query<{ participantes: unknown }>(
      'select participantes from encuentros where sesion_id = $1 and activo limit 1',
      [sesionId],
    );
    const p = r.rows[0]?.participantes as { monstruos?: Monstruo[] } | undefined;
    return Array.isArray(p?.monstruos) ? p.monstruos : [];
  }

  async guardarMonstruos(sesionId: string, monstruos: Monstruo[]) {
    const participantes = JSON.stringify({ monstruos });
    const r = await this.pool.query('update encuentros set participantes = $2 where sesion_id = $1 and activo', [sesionId, participantes]);
    if (r.rowCount === 0) {
      await this.pool.query('insert into encuentros (sesion_id, participantes) values ($1, $2)', [sesionId, participantes]);
    }
  }

  async guardarTokenGm(sesionId: string, hash: string) {
    if (!(await this.tieneMigracion002())) return; // sin la columna, el token vive solo en memoria
    await this.pool.query('update sesiones set gm_token_hash = $2 where id = $1', [sesionId, hash]);
  }

  async avisosBase() {
    return [
      ...((await this.tieneMigracion001()) ? [] : [MIGRACION_001]),
      ...((await this.tieneMigracion002()) ? [] : [MIGRACION_002]),
    ];
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
