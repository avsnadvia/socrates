# 🔄 Sócrates v4 — Guia de Atualização

Atualização da versão que já está no ar. **Nada aqui apaga o que existe** — os 12 usuários, conversas e memórias ficam intactos. Reserve ~20 min e siga na ordem.

> ⚠️ **Não suba isto no susto antes de um jogo.** Faça com calma, e logo após o deploy mande um "Salve, Doutor!" para testar. Se algo soar errado, dá para voltar à versão anterior pelo histórico do GitHub.

---

## O que muda nesta versão

- 🧠 **Memória de narrativa** — o Doutor passa a guardar opiniões e padrões, não só fatos secos.
- 📔 **Diário de relacionamento** — ele lembra do "clima" de cada amizade ("faz tempo que não falamos de cinema").
- 🔒 **Fronteira de privacidade** — regra inviolável: o que entra em conversa privada nunca vaza para outro.
- 🕐 **Correção do horário** — agora ele sempre sabe a data/hora certa de São Paulo.
- 🎯 **Bolão** (`/palpite`), 🏆 **seleções** (`/acompanhar`), 📬 **Correio** (`/recado`), 🧹 **`/esquecer`**.
- 👑 **Admin:** `/painel`, `/custo` (+ resumo diário 23h), `/jogo-prejogo|intervalo|posjogo`.
- ⚽ **Resenha turbinada** — com craques consagrados e revelações ("anota esse nome aí").

---

## PASSO 1 — Atualizar o banco (Supabase) — ~3 min

1. Supabase → seu projeto **Dr Socrates** → **SQL Editor** → **New query**.
2. Abra o arquivo **`supabase-v4.sql`** deste pacote, copie TUDO e cole.
3. Clique em **Run**. Deve aparecer **Success**.

É tudo aditivo: cria colunas e tabelas novas, não toca nas existentes. Pode rodar tranquilo com o sistema no ar.

---

## PASSO 2 — Subir o código novo — ~5 min

No GitHub (repositório `socrates`), substitua os arquivos pelos desta pasta:
- `src/dados.js`
- `src/claude.js`
- `src/index.js`
- `src/whatsapp.js`
- `prompts/sistema.md`
- `package.json`

> Pelo navegador: abra cada arquivo no GitHub → ✏️ (editar) → apague o conteúdo → cole o novo → **Commit**. Ou, mais fácil, use o **Upload files** e deixe substituir os existentes. (Se usa Claude Code, peça: "substitua estes arquivos no repositório socrates e faça commit".)

---

## PASSO 3 — (Opcional) variável nova de ambiente

No Easypanel → app **socrates** → **Environment**, você pode adicionar (opcional):

```
CRON_CUSTO=0 23 * * *
```

Isso liga o resumo de custo diário às 23h para o admin. Se não adicionar, ele já assume 23h por padrão. Para desligar: `CRON_CUSTO=off`.

As demais variáveis continuam as mesmas — não precisa mexer.

---

## PASSO 4 — Implantar — ~3 min

1. Easypanel → app **socrates** → **Implantar** (Deploy).
2. Acompanhe os **Logs** até aparecer **"Sócrates rodando na porta 3000"**.
3. Confira no navegador `https://socrates-socrates.kejkyw.easypanel.host` → "Sócrates no ar ⚽🧠".

---

## PASSO 5 — Testar — ~3 min

Do seu WhatsApp (admin), com o Doutor:
1. **`/ajuda`** → deve vir o menu novo com a voz dele + bloco Admin.
2. **`/painel`** → mostra quem já falou × calado.
3. **`/custo`** → mostra a estimativa (vai começar baixinha).
4. **`/palpite Brasil x Marrocos = 2x1`** → "Tá no bolão!".
5. Mande uma mensagem normal e confira se ele responde com a hora certa, se perguntar.
6. **`/jogo-prejogo`** (só quando tiver jogo!) → ele busca dados e dispara pros assinantes.

Se algo não responder, veja os **Logs** no Easypanel — costuma dizer a causa.

---

## Como editar as seleções acompanhadas

Supabase → **Table Editor** → tabela **`socrates_selecoes`**. Edite os nomes ou o `nivel` (1, 2 ou 3). O Doutor passa a priorizar conforme você definir.

---

## Reverter (se precisar)

No GitHub, cada arquivo tem **History** — dá para restaurar a versão anterior e reimplantar. Como o banco só ganhou colunas/tabelas novas (nada foi removido), a versão antiga continua funcionando com ele.
