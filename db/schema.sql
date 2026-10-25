-- Esquema inicial para Neon (PostgreSQL). Todo en español.
create extension if not exists pgcrypto;

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_en timestamptz not null default now()
);

create table gm_perfiles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null,
  prompt_sistema text not null,
  dificultad text not null default 'normal',
  imagen_id uuid,
  creado_en timestamptz not null default now()
);

create table campanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  gm_usuario_id uuid references usuarios(id),   -- GM humano, si lo hay
  gm_perfil_id uuid references gm_perfiles(id), -- GM IA, si lo hay
  diagrama jsonb not null default '{"nodos":[],"flechas":[]}', -- editor de campaña
  variables jsonb not null default '{}',
  resumen text not null default '',
  creado_en timestamptz not null default now(),
  check (gm_usuario_id is not null or gm_perfil_id is not null)
);

create table sesiones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                  -- el id que escriben los jugadores
  campana_id uuid not null references campanas(id),
  nodo_actual text,
  estado text not null default 'abierta',       -- abierta | pausada | cerrada
  resumen text,
  creada_en timestamptz not null default now()
);

create table personajes (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campanas(id),
  usuario_id uuid references usuarios(id),
  nombre text not null,
  descripcion text not null default '',
  raza text not null,
  clase text not null,
  nivel int not null default 1,
  caracteristicas jsonb not null,               -- {fue,des,con,int,sab,car}
  pg_max int not null,
  pg_actual int not null,
  datos jsonb not null default '{}',            -- inventario, conjuros, competencias
  imagen_id uuid,
  creado_en timestamptz not null default now()
);

create table criaturas (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid references campanas(id),      -- null = biblioteca global
  nombre text not null,
  srd_clave text,                               -- ej. 'goblin'
  stats jsonb not null,
  notas text not null default '',
  imagen_id uuid
);

create table encuentros (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references sesiones(id),
  ronda int not null default 1,
  turno_actual int not null default 0,
  participantes jsonb not null default '[]',    -- orden de iniciativa, posiciones en el mapa
  activo boolean not null default true
);

create table eventos (
  id bigint generated always as identity primary key,
  sesion_id uuid not null references sesiones(id),
  tipo text not null,                           -- mensaje | accion | tirada | estado | intervencion_gm
  autor text not null,                          -- usuario, 'gm' o 'sistema'
  datos jsonb not null,
  creado_en timestamptz not null default now()
);
create index on eventos (sesion_id, id);

create table imagenes (
  id uuid primary key default gen_random_uuid(),
  ruta text not null,
  origen text not null default 'subida',        -- subida | ia
  pertenece_a text,                             -- ej. 'personaje:<uuid>'
  creada_en timestamptz not null default now()
);
