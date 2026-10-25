// Introducción de ambientación de una aventura: plantilla con {heroes} y {héroe_N}.

export const SIN_HEROES = 'los héroes';

/** ["A"] → "A"; ["A", "B"] → "A y B"; ["A", "B", "C"] → "A, B y C"; [] → "los héroes". */
export function listaNombres(nombres: string[]): string {
  const limpios = nombres.map((n) => n.trim()).filter(Boolean);
  if (limpios.length === 0) return SIN_HEROES;
  if (limpios.length === 1) return limpios[0];
  return `${limpios.slice(0, -1).join(', ')} y ${limpios.at(-1)}`;
}

/**
 * Sustituye {heroes} por la lista de nombres y {héroe_N} (o {heroe_N}) por el N-ésimo personaje,
 * contando desde 1. Si no hay tantos personajes, queda «un aventurero».
 */
export function rellenarIntroduccion(plantilla: string, nombres: string[]): string {
  return plantilla
    .replace(/\{h[eé]roes\}/gi, listaNombres(nombres))
    .replace(/\{h[eé]roe_(\d+)\}/gi, (_, n: string) => nombres[Number(n) - 1]?.trim() || 'un aventurero');
}
