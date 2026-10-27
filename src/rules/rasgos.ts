// Habilidades (rasgos de clase del SRD 5.1) y "movimientos" que inventa el GM.

export type UsoHabilidad = 'a_voluntad' | 'por_descanso' | 'una_vez';
export type Recarga = 'corto' | 'largo';
export type ObjetivoModificador = 'ataque' | 'ca' | 'dano';

export interface RasgoCatalogo {
  id: string;
  clase: string; // nombre de la clase tal como lo guarda el personaje
  nombre: string;
  descripcion: string;
  uso: UsoHabilidad;
  recarga?: Recarga;
  usos_max: number; // 0 = sin límite
}

const r = (id: string, clase: string, nombre: string, descripcion: string, uso: UsoHabilidad, usos_max = 0, recarga?: Recarga): RasgoCatalogo =>
  ({ id, clase, nombre, descripcion, uso, usos_max, ...(recarga && { recarga }) });

export const RASGOS: Readonly<Record<string, RasgoCatalogo>> = Object.fromEntries([
  r('furia', 'Bárbaro', 'Furia', 'Acción adicional: ventaja en pruebas de FUE, +2 al daño cuerpo a cuerpo y resistencia a daño contundente, cortante y perforante durante 1 minuto.', 'por_descanso', 2, 'largo'),
  r('ataque_temerario', 'Bárbaro', 'Ataque temerario', 'Ventaja en ataques de FUE este turno; los ataques contra ti tienen ventaja hasta tu siguiente turno.', 'a_voluntad'),
  r('inspiracion_bardica', 'Bardo', 'Inspiración bárdica', 'Acción adicional: un aliado gana un d6 que puede sumar a una tirada en los próximos 10 minutos.', 'por_descanso', 3, 'largo'),
  r('expulsar_muertos', 'Clérigo', 'Canalizar divinidad: expulsar muertos', 'Los no muertos a 9 m que fallen una salvación de SAB huyen durante 1 minuto.', 'por_descanso', 1, 'corto'),
  r('forma_salvaje', 'Druida', 'Forma salvaje', 'Te transformas en una bestia que hayas visto (VD máx. 1/4) durante horas iguales a la mitad de tu nivel.', 'por_descanso', 2, 'corto'),
  r('tomar_aliento', 'Guerrero', 'Tomar aliento', 'Acción adicional: recuperas 1d10 + tu nivel en PG.', 'por_descanso', 1, 'corto'),
  r('oleada_de_accion', 'Guerrero', 'Oleada de acción', 'Realizas una acción adicional en tu turno.', 'por_descanso', 1, 'corto'),
  r('artes_marciales', 'Monje', 'Artes marciales', 'Usas DES para golpes sin armas y armas de monje, y puedes dar un golpe sin armas como acción adicional.', 'a_voluntad'),
  r('imposicion_de_manos', 'Paladín', 'Imposición de manos', 'Reserva de 5 × nivel PG para curar con el toque.', 'por_descanso', 1, 'largo'),
  r('sentido_divino', 'Paladín', 'Sentido divino', 'Detectas celestiales, infernales y no muertos a 18 m hasta el final de tu siguiente turno.', 'por_descanso', 2, 'largo'),
  r('enemigo_predilecto', 'Explorador', 'Enemigo predilecto', 'Ventaja en pruebas de Supervivencia para rastrear a tu enemigo predilecto y de INT para recordar datos sobre él.', 'a_voluntad'),
  r('ataque_furtivo', 'Pícaro', 'Ataque furtivo', 'Una vez por turno, +1d6 de daño si tienes ventaja o un aliado está junto al objetivo.', 'a_voluntad'),
  r('accion_astuta', 'Pícaro', 'Acción astuta', 'Acción adicional para correr, retirarte o esconderte.', 'a_voluntad'),
  r('puntos_hechiceria', 'Hechicero', 'Fuente de magia', 'Puntos de hechicería para crear espacios de conjuro o modificar conjuros.', 'por_descanso', 2, 'largo'),
  r('pacto_brujo', 'Brujo', 'Magia de pacto', 'Tus espacios de conjuro se recuperan con un descanso corto.', 'por_descanso', 1, 'corto'),
  r('recuperacion_arcana', 'Mago', 'Recuperación arcana', 'Tras un descanso corto, recuperas espacios de conjuro de nivel total igual a la mitad de tu nivel.', 'por_descanso', 1, 'largo'),
].map((x) => [x.id, x]));

// Las fichas pueden guardar la clase en femenino ("Pícara", "Maga"): se lleva al nombre del catálogo.
const FEMENINOS: Record<string, string> = {
  Bárbara: 'Bárbaro', Barda: 'Bardo', Clériga: 'Clérigo', Guerrera: 'Guerrero', Monja: 'Monje', Paladina: 'Paladín',
  Exploradora: 'Explorador', Pícara: 'Pícaro', Hechicera: 'Hechicero', Bruja: 'Brujo', Maga: 'Mago',
};
export const claseBase = (clase: string) => FEMENINOS[clase.trim()] ?? clase.trim();

export const rasgosDeClase = (clase: string) => Object.values(RASGOS).filter((x) => x.clase === claseBase(clase));
