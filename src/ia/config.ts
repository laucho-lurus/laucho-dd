// Arma el GM IA a partir de las variables de entorno. Sin ANTHROPIC_API_KEY la IA queda desactivada.
import Anthropic from '@anthropic-ai/sdk';
import { GmIa } from './gm-ia.ts';
import { MODELO_POR_DEFECTO, MODELOS_PERMITIDOS } from './precios.ts';
import { Presupuesto } from './presupuesto.ts';

import { rutasDatos } from '../server/rutas-datos.ts';
const TOPE_POR_DEFECTO = 5;

export function crearGmIa(env: NodeJS.ProcessEnv): { gm: GmIa | null; info: string } {
  if (!env.ANTHROPIC_API_KEY) return { gm: null, info: 'IA desactivada: falta ANTHROPIC_API_KEY' };
  const pedido = env.AI_MODEL ?? MODELO_POR_DEFECTO;
  const modelo = MODELOS_PERMITIDOS.includes(pedido) ? pedido : MODELO_POR_DEFECTO;
  const tope = Number(env.AI_MONTHLY_BUDGET_USD ?? TOPE_POR_DEFECTO);
  const presupuesto = new Presupuesto(rutasDatos(env).gasto, Number.isFinite(tope) && tope > 0 ? tope : TOPE_POR_DEFECTO);
  const sdk = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 30_000 });
  const gm = new GmIa({ cliente: { crear: (p) => sdk.messages.create(p) }, presupuesto, modelo });
  const aviso = pedido === modelo ? '' : ` (AI_MODEL "${pedido}" no permitido; uso ${modelo})`;
  return { gm, info: `IA activa con ${modelo}, tope $${tope.toFixed(2)}/mes${aviso}` };
}
