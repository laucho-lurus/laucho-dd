// REVISAR PRECIOS: tabla de precios por modelo en USD por millón de tokens.
// Valores de la API de Anthropic (octubre 2026). Escritura de caché ≈ 1,25 × entrada; lectura ≈ 0,1 × entrada.
// Si un modelo no está en la tabla, se usa la fila más cara (estimación conservadora al alza).

export interface Precio {
  entrada: number;
  salida: number;
  cache_escritura: number;
  cache_lectura: number;
}

export const PRECIOS: Readonly<Record<string, Precio>> = {
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, cache_escritura: 0.125, cache_lectura: 0.01 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, cache_escritura: 2.5, cache_lectura: 0.2 },
};

export const MODELOS_PERMITIDOS = Object.keys(PRECIOS);
export const MODELO_POR_DEFECTO = 'claude-haiku-5-5';

const MAS_CARO: Precio = Object.values(PRECIOS).reduce((a, b) => (b.salida > a.salida ? b : a));

export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Costo en USD de una llamada según su `usage`. */
export function costo(modelo: string, uso: Uso): number {
  const p = PRECIOS[modelo] ?? MAS_CARO;
  const millon = 1_000_000;
  return (
    (uso.input_tokens * p.entrada +
      uso.output_tokens * p.salida +
      (uso.cache_creation_input_tokens ?? 0) * p.cache_escritura +
      (uso.cache_read_input_tokens ?? 0) * p.cache_lectura) /
    millon
  );
}
