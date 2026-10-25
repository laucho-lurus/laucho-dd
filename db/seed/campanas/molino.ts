// El Molino Silencioso (los datos viven en molino-datos.ts, que ya usaba el seed original).
import { criaturas, diagrama, NOMBRE_CAMPANA, resumen, variables } from '../molino-datos.ts';
import type { SemillaCampana } from '../semilla.ts';

export const molino: SemillaCampana = { id: 'molino', nombre: NOMBRE_CAMPANA, resumen, variables, diagrama, criaturas };
