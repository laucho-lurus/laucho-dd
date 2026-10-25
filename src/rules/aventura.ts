// Diagrama de una aventura: nodos (escenas) y flechas (salidas posibles).

export interface Nodo {
  id: string;
  tipo: string; // escena | decision | evento | tirada | combate | dialogo | final
  titulo: string;
  texto: string;
  notas: string;
}

export interface Flecha {
  desde: string;
  hasta: string;
  etiqueta: string;
  condicion?: string;
}

export interface Diagrama {
  nodos: Nodo[];
  flechas: Flecha[];
}

export type Variables = Record<string, boolean | number | string>;

export const DIAGRAMA_VACIO: Diagrama = { nodos: [], flechas: [] };

export const nodoInicial = (d: Diagrama): Nodo | null => d.nodos[0] ?? null;

export const buscarNodo = (d: Diagrama, id: string | null): Nodo | null => d.nodos.find((n) => n.id === id) ?? null;

export const salidas = (d: Diagrama, id: string | null): Flecha[] => d.flechas.filter((f) => f.desde === id);
