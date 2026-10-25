-- 001: estado de la partida por sesión (idempotente). Aplicar en el SQL Editor de Neon.
alter table sesiones
  add column if not exists variables jsonb not null default '{}'::jsonb,
  add column if not exists ia_pausada boolean not null default false,
  add column if not exists ia_perfil_id uuid references gm_perfiles(id);
