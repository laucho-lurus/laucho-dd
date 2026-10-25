-- 002: hash del token del GM para que pueda volver a entrar tras reiniciar el servidor (idempotente).
-- Aplicar en el SQL Editor de Neon. Nunca se guarda el token, solo su SHA-256.
alter table sesiones add column if not exists gm_token_hash text;
