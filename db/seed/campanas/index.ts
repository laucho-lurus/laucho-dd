// Aventuras disponibles para `npm run seed -- <id>`.
import type { SemillaCampana } from '../semilla.ts';
import { molino } from './molino.ts';
import { cripta } from './cripta.ts';
import { feria } from './feria.ts';
import { rey } from './rey.ts';
import { minas } from './minas.ts';

export const AVENTURAS: Readonly<Record<string, SemillaCampana>> = Object.fromEntries(
  [molino, cripta, feria, rey, minas].map((a) => [a.id, a]),
);
