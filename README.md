# D&D multijugador con GM IA

App web de D&D 5e (reglas SRD 5.1, en español) para hasta 4 jugadores. El GM puede ser Claude, con distintas personalidades, o una persona que prepara la campaña en un editor de diagrama de flujo.

El plan completo está en el doc del proyecto: https://claude.ai/artifact/7mcCXFRDdebxh9u4XVm1Mb

## Estado

Fase 1, arranque. Hecho:

- Motor de dados (`src/rules/dice.ts`): notación `1d20+5`, `4d6kh3`, ventaja y desventaja, críticos.
- Esquema de la base de datos para Neon (`db/schema.sql`).

Falta: servidor con WebSockets, pantallas, login por link, motor de combate, mapa táctico y editor de campañas.

## Cómo entran los jugadores

Abren el link, escriben el código de la sesión y eligen su personaje. No hay cuentas.

## Desarrollo

Requiere Node 22.18 o superior.

```sh
cp .env.example .env   # y rellena DATABASE_URL y ANTHROPIC_API_KEY
npm test
```

El tope de gasto del GM IA es 5 USD al mes (`AI_MONTHLY_BUDGET_USD`).

## Imágenes y almacenamiento

Las imágenes (retratos, monstruos, escenas, PNJ y fondos de mapa) se suben en `/imagenes` o al crear un personaje. Se registran en la tabla `imagenes` (`pertenece_a`: `criatura:goblin`, `nodo:<campaña>:<nodo>`, `pnj:<campaña>:<nombre>`, `fondo:<campaña>:<nombre>`, `personaje:<id>`) y los archivos van al almacén definido en `src/server/almacen.ts`.

Hoy el almacén es la carpeta local `uploads/` (ignorada por git). Para desplegar con R2 o S3, crea otra clase que implemente la interfaz `Almacen` (`guardar`, `leer`, `borrar`) y úsala en `src/server/main.ts` en lugar de `AlmacenDisco`; las rutas guardadas en la base no cambian. Los archivos se sirven en `/uploads/<uuid>.<ext>` con `X-Content-Type-Options: nosniff` y `Content-Security-Policy: default-src 'none'; sandbox`, y el tipo se valida por la cabecera del archivo, no por la extensión.
