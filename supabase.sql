-- ============================================
-- SÓCRATES v2 (multiusuário) - Supabase
-- Cole tudo no SQL Editor e clique em RUN.
-- ============================================

-- 1. Usuários autorizados (círculo fechado)
create table if not exists socrates_usuarios (
  id bigint generated always as identity primary key,
  numero text not null unique,        -- 55 + DDD + número, só dígitos
  nome text,                          -- preenchido por você ou no onboarding
  admin boolean not null default false,
  modo text not null default 'normal' check (modo in ('normal', 'profundo')),
  recebe_copa boolean not null default true,      -- Giro da Copa (opt-out)
  recebe_noticias boolean not null default false, -- notícias gerais (opt-in)
  criado_em timestamptz not null default now()
);

-- MIGRAÇÃO: se você JÁ rodou a versão anterior deste SQL, rode também estas linhas:
alter table socrates_usuarios add column if not exists recebe_copa boolean not null default true;
alter table socrates_usuarios alter column recebe_noticias set default false;

-- 2. Histórico de mensagens (por usuário)
create table if not exists socrates_mensagens (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references socrates_usuarios(id),
  papel text not null check (papel in ('user', 'assistant')),
  conteudo text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_soc_msg on socrates_mensagens (usuario_id, criado_em desc);

-- 3. Memória de longo prazo (por usuário)
create table if not exists socrates_memorias (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references socrates_usuarios(id),
  categoria text not null default 'geral',
  conteudo text not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_soc_mem on socrates_memorias (usuario_id);

-- 4. VOCÊ, como primeiro usuário e admin
-- >>> TROQUE o número abaixo pelo SEU antes de rodar <<<
insert into socrates_usuarios (numero, nome, admin)
values ('5516999999999', 'Rodrigo', true)
on conflict (numero) do nothing;
