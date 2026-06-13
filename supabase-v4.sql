-- ============================================================
-- SÓCRATES v4 — MIGRAÇÃO (rode DEPOIS de já ter o v2/v3 no ar)
-- Cole TUDO no SQL Editor do Supabase e clique em RUN.
-- É tudo ADITIVO: não apaga nem altera nada que já existe.
-- Seguro rodar com os 12 usuários já cadastrados.
-- ============================================================

-- ------------------------------------------------------------
-- 1. FRONTEIRA DE PRIVACIDADE
-- Toda memória passa a ter uma "origem": privado (cofre) ou
-- coletivo (nasceu público: bolão, pergunta de boteco, recado
-- autorizado). O Sócrates só usa o que é 'privado' ao falar COM
-- a própria pessoa; só usa 'coletivo' quando for falar de algo
-- coletivo. Default = privado (cofre), o mais seguro.
-- ------------------------------------------------------------
alter table socrates_memorias
  add column if not exists origem text not null default 'privado'
  check (origem in ('privado', 'coletivo'));

-- ------------------------------------------------------------
-- 2. DIÁRIO DE RELACIONAMENTO (1 linha por usuário)
-- Memória de relacionamento, não factual: assuntos recorrentes,
-- tom predominante, últimos temas, quando foi a última conversa.
-- É o que permite "faz tempo que não falamos de cinema".
-- ------------------------------------------------------------
create table if not exists socrates_relacao (
  usuario_id bigint primary key references socrates_usuarios(id),
  assuntos_recorrentes text,      -- ex: "futebol, viagens, filhos"
  tom_predominante text,          -- ex: "bem-humorado, gosta de provocar"
  ultimos_temas text,             -- ex: "viagem a Portugal; obra da casa"
  nota_relacional text,           -- texto livre que o Sócrates mantém
  ultima_conversa timestamptz,    -- atualizado a cada conversa
  ultima_iniciativa timestamptz,  -- quando o Sócrates puxou papo por conta própria
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. BOLÃO (canal coletivo por natureza)
-- Cada palpite nasce 'coletivo': a pessoa sabe que entra num ranking.
-- ------------------------------------------------------------
create table if not exists socrates_palpites (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references socrates_usuarios(id),
  jogo text not null,             -- ex: "Brasil x Marrocos"
  palpite text not null,          -- ex: "2x1"
  data_jogo date,
  acertou boolean,                -- preenchido depois do jogo (futuro)
  criado_em timestamptz not null default now()
);
create index if not exists idx_soc_palpite on socrates_palpites (data_jogo, usuario_id);

-- ------------------------------------------------------------
-- 4. SELEÇÕES ACOMPANHADAS (tabela editável; 3 níveis)
-- nivel 1 = sagrado (Brasil), 2 = forte, 3 = grandes da Copa.
-- Editável à mão pelo Table Editor quando quiser.
-- ------------------------------------------------------------
create table if not exists socrates_selecoes (
  id bigint generated always as identity primary key,
  selecao text not null unique,
  nivel int not null check (nivel between 1 and 3),
  criado_em timestamptz not null default now()
);
insert into socrates_selecoes (selecao, nivel) values
  ('Brasil', 1),
  ('Portugal', 2),
  ('Argentina', 2),
  ('França', 3),
  ('Espanha', 3),
  ('Alemanha', 3),
  ('Inglaterra', 3)
on conflict (selecao) do nothing;

-- Seleção que CADA pessoa pediu para acompanhar (o Sócrates pergunta no papo)
create table if not exists socrates_selecao_usuario (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references socrates_usuarios(id),
  selecao text not null,
  criado_em timestamptz not null default now(),
  unique (usuario_id, selecao)
);

-- ------------------------------------------------------------
-- 5. RASTREIO DE CUSTO (estimativa por tokens)
-- Uma linha por chamada à API da Anthropic. O custo em US$ é
-- calculado no código pela tabela de preços e gravado aqui.
-- ------------------------------------------------------------
create table if not exists socrates_uso (
  id bigint generated always as identity primary key,
  usuario_id bigint references socrates_usuarios(id), -- null = tarefa do sistema (resenha etc.)
  modelo text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  custo_usd numeric(10,5) not null default 0,
  contexto text,                  -- ex: 'conversa', 'resenha', 'jogo', 'custo'
  criado_em timestamptz not null default now()
);
create index if not exists idx_soc_uso on socrates_uso (criado_em desc);

-- ------------------------------------------------------------
-- 6. RECADOS DO CORREIO DO MAGRÃO (autorizados = coletivo)
-- A pessoa A pede explicitamente para o Sócrates entregar algo a B.
-- ------------------------------------------------------------
create table if not exists socrates_recados (
  id bigint generated always as identity primary key,
  de_usuario_id bigint not null references socrates_usuarios(id),
  para_numero text not null,
  conteudo text not null,
  entregue boolean not null default false,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- FIM DA MIGRAÇÃO v4. Deve aparecer "Success".
-- ============================================================
