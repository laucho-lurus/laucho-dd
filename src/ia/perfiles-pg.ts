// Perfiles del GM IA en la tabla gm_perfiles. El tono se guarda en prompt_sistema.
import { esDificultad, type AlmacenPerfiles, type PerfilGm } from './perfiles.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo único que usamos de pg.Pool. */
export interface Consultor {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface Fila {
  id: string;
  nombre: string;
  descripcion: string;
  tono: string;
  dificultad: string;
}

const COLUMNAS = 'id, nombre, descripcion, prompt_sistema as tono, dificultad';
const aPerfil = (f: Fila): PerfilGm => ({ ...f, dificultad: esDificultad(f.dificultad) ? f.dificultad : 'normal' });

export class PerfilesPg implements AlmacenPerfiles {
  private readonly db: Consultor;
  private readonly iniciales: () => Promise<PerfilGm[]>;
  private sembrado: Promise<void> | null = null;

  /** `iniciales`: perfiles a cargar si la tabla está vacía (los del JSON local o los de fábrica). */
  constructor(db: Consultor, iniciales: () => Promise<PerfilGm[]>) {
    this.db = db;
    this.iniciales = iniciales;
  }

  /** Una sola vez y solo si la tabla está vacía: así no se duplica aunque se reinicie. */
  private sembrar(): Promise<void> {
    this.sembrado ??= (async () => {
      const lista = await this.iniciales();
      await this.db.query(
        `insert into gm_perfiles (nombre, descripcion, prompt_sistema, dificultad)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
         where not exists (select 1 from gm_perfiles)`,
        [lista.map((p) => p.nombre), lista.map((p) => p.descripcion), lista.map((p) => p.tono), lista.map((p) => p.dificultad)],
      );
    })().catch((err) => {
      this.sembrado = null; // reintenta en la próxima consulta
      throw err;
    });
    return this.sembrado;
  }

  async listar() {
    await this.sembrar();
    const r = await this.db.query<Fila>(`select ${COLUMNAS} from gm_perfiles order by creado_en, nombre`);
    return r.rows.map(aPerfil);
  }

  async buscar(id: string) {
    if (!UUID.test(id)) return null;
    await this.sembrar();
    const r = await this.db.query<Fila>(`select ${COLUMNAS} from gm_perfiles where id = $1`, [id]);
    return r.rows[0] ? aPerfil(r.rows[0]) : null;
  }

  async guardarPerfil(id: string | null, d: Omit<PerfilGm, 'id'>) {
    const params = [d.nombre, d.descripcion, d.tono, d.dificultad];
    const r = id
      ? await this.db.query<Fila>(
          `update gm_perfiles set nombre = $2, descripcion = $3, prompt_sistema = $4, dificultad = $5 where id = $1 returning ${COLUMNAS}`,
          [id, ...params],
        )
      : await this.db.query<Fila>(
          `insert into gm_perfiles (nombre, descripcion, prompt_sistema, dificultad) values ($1, $2, $3, $4) returning ${COLUMNAS}`,
          params,
        );
    if (!r.rows[0]) throw new Error('No existe ese perfil');
    return aPerfil(r.rows[0]);
  }
}
