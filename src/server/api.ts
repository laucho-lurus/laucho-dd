// API HTTP de creación de personajes y archivos subidos.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ALINEAMIENTOS, CLASES, METODOS, RAZAS } from '../rules/personaje.ts';
import { crearPersonaje, MAX_IMAGEN_BYTES, TiradasCaracteristicas, type Dependencias } from './creacion.ts';
import type { Repositorio } from './repositorio.ts';
import { DIFICULTADES, validarPerfil, type AlmacenPerfiles } from '../ia/perfiles.ts';

const UPLOADS = new URL('../../uploads/', import.meta.url);
const MAX_CUERPO_BYTES = Math.ceil(MAX_IMAGEN_BYTES * 1.4) + 64 * 1024; // base64 + resto del formulario
const ARCHIVO_SUBIDO = /^\/uploads\/([0-9a-f-]{36}\.(png|jpg|webp))$/;
const TIPOS_IMAGEN: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

class CuerpoDemasiadoGrande extends Error {}

function json(res: ServerResponse, estado: number, datos: unknown) {
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(datos));
}

async function leerJson(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > MAX_CUERPO_BYTES) throw new CuerpoDemasiadoGrande();
    partes.push(parte as Buffer);
  }
  const crudo = Buffer.concat(partes).toString('utf8');
  return JSON.parse(crudo) as unknown;
}

const opciones = (tabla: Readonly<Record<string, { nombre: string }>>) =>
  Object.entries(tabla).map(([clave, v]) => ({ clave, ...v }));

export function crearApi(repo: Repositorio, perfiles: AlmacenPerfiles) {
  const deps: Dependencias = {
    repo,
    tiradas: new TiradasCaracteristicas(),
    guardarArchivo: async (nombre, contenido) => {
      await mkdir(UPLOADS, { recursive: true });
      await writeFile(new URL(nombre, UPLOADS), contenido, { flag: 'wx' });
    },
  };

  /** Atiende la petición si es de la API o de /uploads. Devuelve false si no le toca. */
  return async function atender(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<boolean> {
    try {
      if (req.method === 'GET' && ruta === '/api/opciones') {
        json(res, 200, {
          razas: opciones(RAZAS),
          clases: opciones(CLASES),
          alineamientos: ALINEAMIENTOS,
          metodos: METODOS,
          campanas: (await repo.listarCampanas()).map(({ id, nombre }) => ({ id, nombre })),
        });
        return true;
      }
      if (req.method === 'GET' && ruta === '/api/perfiles') {
        json(res, 200, { perfiles: await perfiles.listar(), dificultades: DIFICULTADES });
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/perfiles') {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await leerJson(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Petición inválida' });
          return true;
        }
        const v = validarPerfil(cuerpo);
        if (!v.ok) {
          json(res, 400, { error: v.error });
          return true;
        }
        const id = typeof cuerpo?.id === 'string' && cuerpo.id ? cuerpo.id : null;
        if (id && !(await perfiles.buscar(id))) {
          json(res, 404, { error: 'No existe ese perfil' });
          return true;
        }
        json(res, id ? 200 : 201, { perfil: await perfiles.guardarPerfil(id, v.perfil) });
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/caracteristicas/tirar') {
        json(res, 200, deps.tiradas.tirar());
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/personajes') {
        let cuerpo;
        try {
          cuerpo = await leerJson(req);
        } catch (err) {
          json(res, err instanceof CuerpoDemasiadoGrande ? 413 : 400, {
            error: err instanceof CuerpoDemasiadoGrande ? 'La imagen supera 2 MB' : 'Petición inválida',
          });
          return true;
        }
        const r = await crearPersonaje(deps, cuerpo);
        if (r.ok) {
          console.log(`[api] personaje creado: ${r.valor.nombre} (campaña ${r.valor.campana_id})`);
          json(res, 201, { personaje: r.valor });
        } else {
          console.warn(`[api] creación de personaje rechazada: ${r.error}`);
          json(res, 400, { error: r.error });
        }
        return true;
      }
      const subido = req.method === 'GET' ? ARCHIVO_SUBIDO.exec(ruta) : null;
      if (subido) {
        try {
          const contenido = await readFile(new URL(subido[1], UPLOADS));
          res.writeHead(200, { 'content-type': TIPOS_IMAGEN[subido[2]], 'x-content-type-options': 'nosniff' }).end(contenido);
        } catch {
          res.writeHead(404).end();
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[api] error en ${req.method} ${ruta}:`, err);
      json(res, 500, { error: 'Error interno del servidor' });
      return true;
    }
  };
}
