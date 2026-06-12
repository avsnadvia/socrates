# ⚽🧠 SÓCRATES — Guia de Instalação Completo (do zero)

Conselheiro e amigo via WhatsApp para o seu círculo fechado: conversa com memória individual por pessoa, Resenha do Doutor diária na Copa, notícias gerais opcionais e modo profundo sob demanda.

Escrito para ser seguido **sem conhecimento técnico**. Reserve ~1 hora. Siga na ordem.

---

## O que vamos montar (em 1 minuto)

```
Amigos (WhatsApp) ⇄ Evolution API (já existe no seu VPS)
                          ⇅ webhook
                    SÓCRATES (app Node.js, no Easypanel)
                          ⇅
              Claude API (cérebro) + Supabase (memória)
```

- Cada amigo autorizado conversa com o Sócrates e tem **histórico e memória próprios** — ele nunca mistura as pessoas.
- Todo dia às **9h**: ⚽ *Resenha do Doutor* (resultados de ontem, jogos de hoje, curiosidades e palpite).
- Às **8h**, notícias gerais — mas só para quem ativar com `/noticias on`.
- Quem não estiver cadastrado é **ignorado em silêncio**. Círculo fechado de verdade.

## Checklist do que você precisa

- [ ] VPS Hostinger com Easypanel (✅ você já tem)
- [ ] Evolution API rodando no VPS (✅ você já tem)
- [ ] Conta/projeto no Supabase (✅ você já tem)
- [ ] Chave da API da Anthropic (console.anthropic.com) com créditos
- [ ] Conta no GitHub (✅)
- [ ] **Um número de WhatsApp para o Sócrates** ⚠️

> ### ⚠️ O número do Sócrates
> Ele precisa de número próprio — não pode morar no seu, senão responderia seus contatos.
> Compre um **chip pré-pago** (~R$ 10–20), ative o WhatsApp nele (pode ser no segundo chip do seu celular ou num aparelho velho) e pronto. Depois de conectado à Evolution (Passo 4), o aparelho pode ficar guardado — só abra o WhatsApp nele a cada ~14 dias para a sessão não expirar.
> **Dica importante**: deixe esse número "esquentar" — nos 2-3 primeiros dias, só conversas individuais; o broadcast diário entra depois. Número novo disparando mensagens em massa pode ser bloqueado pelo WhatsApp.

---

## PASSO 1 — A memória (Supabase) — ~5 min

1. Acesse [supabase.com](https://supabase.com) e entre no seu projeto (pode ser o mesmo de outros bots; as tabelas têm prefixo `socrates_` e não conflitam).
2. Menu lateral → **SQL Editor** → **New query**.
3. Abra o arquivo **`supabase.sql`** desta pasta.
4. **ANTES de colar**: na última parte do arquivo, troque `5516999999999` pelo **seu número** (55 + DDD + número, só dígitos). É isso que te torna admin.
5. Cole tudo no editor e clique em **Run**. Deve aparecer "Success".

**Anote para o Passo 3:**
- **Settings (engrenagem) → API**: copie a **Project URL** (`https://....supabase.co`) e a chave **`service_role`** (clique em Reveal; atenção: é a service_role, NÃO a "anon").

---

## PASSO 2 — O código (GitHub) — ~10 min

1. [github.com](https://github.com) → **+** → **New repository** → nome `socrates` → marque **Private** → **Create repository**.
2. Clique em **uploading an existing file** e arraste todos os arquivos desta pasta:
   - `package.json`, `Dockerfile`, `supabase.sql`
   - pasta `src/` (4 arquivos: `index.js`, `claude.js`, `dados.js`, `whatsapp.js`)
   - pasta `prompts/` (`sistema.md` — a alma do Sócrates mora aqui)
3. **Commit changes**.

> Se o navegador não aceitar pastas: **Add file → Create new file**, e no nome digite `src/index.js` (o GitHub cria a pasta sozinho). Ou peça ao Claude Code: "suba esta pasta num repositório privado chamado socrates".

---

## PASSO 3 — O servidor (Easypanel) — ~15 min

1. Acesse seu Easypanel → entre/crie um projeto → **+ Service → App** → nome `socrates`.
2. Aba **Source**: GitHub → repositório `socrates` → branch `main` → Build: **Dockerfile**.
3. Aba **Environment** — cole e preencha:

```
ANTHROPIC_API_KEY=sk-ant-SUACHAVE
SUPABASE_URL=https://SEUPROJETO.supabase.co
SUPABASE_SERVICE_KEY=SUA_SERVICE_ROLE_KEY
EVOLUTION_URL=https://SUA-EVOLUTION.dominio.com.br
EVOLUTION_APIKEY=SUA_APIKEY_GLOBAL
EVOLUTION_INSTANCE=socrates
MODELO_NORMAL=claude-sonnet-4-6
MODELO_PROFUNDO=claude-opus-4-8
CRON_COPA=0 9 * * *
CRON_NOTICIAS=0 8 * * *
PORT=3000
TZ=America/Sao_Paulo
```

   Onde achar:
   - `ANTHROPIC_API_KEY`: console.anthropic.com → API Keys → Create Key (e carregue créditos em Billing)
   - `SUPABASE_*`: anotadas no Passo 1
   - `EVOLUTION_URL`: o endereço da sua Evolution (o mesmo do navegador)
   - `EVOLUTION_APIKEY`: a chave global da sua instalação (variável `AUTHENTICATION_API_KEY`)

4. Aba **Domains**: **Add Domain** → ex.: `socrates.seudominio.com.br` → porta **3000** (ou use o domínio automático do Easypanel).
5. **Deploy**. Aguarde 1–3 min.
6. Abra `https://socrates.seudominio.com.br` no navegador: deve aparecer **"Sócrates no ar ⚽🧠"**. 🎉

---

## PASSO 4 — O WhatsApp do Doutor (Evolution) — ~10 min

1. Abra o **Manager** da Evolution (`https://sua-evolution.../manager`).
2. **Create Instance** → nome: `socrates` (exatamente igual à variável `EVOLUTION_INSTANCE`).
3. Clique em **Connect / QR Code**.
4. No celular com o **chip do Sócrates**: WhatsApp → Configurações → **Dispositivos conectados** → **Conectar dispositivo** → escaneie o QR.
5. Status deve ficar **open/connected** (verde).

Capricho opcional: coloque foto e nome "Sócrates ⚽" no perfil desse WhatsApp.

---

## PASSO 5 — Ligar os fios (webhook) — ~5 min

1. No Manager, abra a instância `socrates` → seção **Webhook**.
2. Configure:
   - **URL**: `https://socrates.seudominio.com.br/webhook` (o domínio do Passo 3 + `/webhook`)
   - **Enabled**: ✅
   - **Webhook by Events**: desativado
   - **Eventos**: marque só **MESSAGES_UPSERT**
3. Salve.

---

## PASSO 6 — O batismo 🎉 — ~5 min

1. No **seu** WhatsApp, salve o número do Sócrates ("Sócrates ⚽") e mande: *"Salve, Doutor!"*
2. Em 5–15 segundos ele responde — e como você é o único cadastrado (e admin), já te conhece.
3. Teste os comandos: mande `/ajuda` e depois `/usuarios`.

### Convocar os amigos
Mande para o Sócrates, um por vez:
```
/add 5516991234567 Dmitri
/add 5511991234567 Alamiro
/add 5516991234567 Pessoti
```
Aí é só passar o número do Sócrates pra eles. No primeiro "oi" de cada um, o Doutor se apresenta sozinho e começa a construir a memória daquela pessoa.

### Comandos (cola pra mandar no grupo dos amigos)
```
/profundo — conversas mais densas
/normal — modo padrão
/resenha on|off — Resenha do Doutor diária (9h)
/noticias on|off — notícias gerais (8h)
/ajuda — lista tudo
```

---

## Custos mensais estimados

| Item | Custo |
|---|---|
| VPS/Easypanel/Evolution/Supabase | R$ 0 a mais (já pagos) |
| Chip do Sócrates | ~R$ 0–10/mês |
| Claude API (4 usuários ativos + Resenha diária) | ~US$ 10–25/mês |
| Claude API (10 usuários ativos) | ~US$ 15–40/mês |

Acompanhe em **console.anthropic.com → Usage**. O `/profundo` (Opus) custa ~2x mais por mensagem — por isso o Sócrates avisa em tom de brincadeira quando alguém liga.

---

## Problemas comuns

**Mandei mensagem e nada acontece.**
1. `https://socrates...` mostra "Sócrates no ar"? Se não: Easypanel → app → **Logs**.
2. Nos Logs, aparece "Msg de..." quando você manda algo? Se NÃO: problema no webhook (Passo 5 — confira a URL com `/webhook` no final). Se aparece mas dá erro: o log diz qual chave está errada.
3. Aparece "Número não autorizado ignorado"? Seu número no `supabase.sql` foi salvo diferente do que o WhatsApp usa. Vá no Supabase → **Table Editor** → `socrates_usuarios` e corrija o campo `numero` (compare com o número que aparece no log).

**Ele pensa mas a resposta não chega.** Confira `EVOLUTION_URL`, `EVOLUTION_APIKEY` e se a instância se chama exatamente `socrates`.

**Amigo mandou mensagem e foi ignorado.** Ele não está cadastrado — use `/add`. Confira com `/usuarios`.

**Quero mudar horários.** Edite `CRON_COPA` / `CRON_NOTICIAS` no Easypanel (formato: `minuto hora * * *`; use `off` para desativar) → Deploy.

**Quero mudar a personalidade.** Edite `prompts/sistema.md` no GitHub (lápis → editar → Commit) → Deploy no Easypanel.

---

## ⚖️ Lembrete do advogado da casa

Círculo fechado de amigos: tranquilo. Antes de abrir ao público com nome/persona do Sócrates: **autorização da família** (direitos da personalidade post-mortem — art. 20, parágrafo único, CC), termos de uso e LGPD (as conversas são dados pessoais). O café com os filhos dele vem antes do produto. ☕
