// Dónde se guardan los archivos locales: gasto de la IA, perfiles del GM e imágenes subidas.
// En producción DATA_DIR apunta a un volumen persistente (p. ej. /data); sin él, carpetas del repo.
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

export function rutasDatos(env: NodeJS.ProcessEnv) {
  const datos = env.DATA_DIR || join(RAIZ, 'data');
  const uploads = env.UPLOADS_DIR || (env.DATA_DIR ? join(env.DATA_DIR, 'uploads') : join(RAIZ, 'uploads'));
  return {
    gasto: join(datos, 'gasto-ia.json'),
    perfiles: join(datos, 'gm-perfiles.json'),
    uploads: pathToFileURL(join(uploads, '/')), // AlmacenDisco espera una URL de carpeta (con / final)
  };
}
