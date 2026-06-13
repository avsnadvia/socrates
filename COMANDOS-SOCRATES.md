# 📋 Comandos do Doutor Sócrates (v4)

## Para todos os amigos do círculo

| Comando | O que faz |
|---|---|
| *(conversa normal)* | Manda qualquer mensagem e o Doutor responde, com memória e personalidade |
| `/profundo` | Liga o modo profundo (modelo mais potente, para papos densos) |
| `/normal` | Volta ao modo padrão |
| `/resenha on` · `/resenha off` | Liga/desliga a Resenha do Doutor diária (9h) |
| `/noticias on` · `/noticias off` | Liga/desliga o comentário de notícias diário (8h) |
| `/palpite Brasil x Marrocos = 2x1` | Registra seu palpite no bolão |
| `/acompanhar Croácia` | Pede ao Doutor para seguir de perto uma seleção sua |
| `/recado NUMERO \| texto` | Correio do Magrão: o Doutor leva seu recado a outro do círculo |
| `/esquecer` | Apaga tudo o que o Doutor sabe de você (continua no círculo) |
| `/ajuda` | Mostra o menu |

## Só para o admin (Rodrigo)

| Comando | O que faz |
|---|---|
| `/add NUMERO Nome \| característica` | Adiciona alguém ao círculo |
| `/remover NUMERO` | Remove alguém (apaga histórico e memórias) |
| `/usuarios` | Lista todos do círculo |
| `/painel` | Quem já conversou × quem está calado + mais ativos |
| `/custo` | Gasto estimado de hoje/semana/total (estimativa, não a fatura) |
| `/jogo-prejogo` | Dispara comentário pré-jogo para os assinantes da Resenha |
| `/jogo-intervalo` | Dispara comentário de intervalo |
| `/jogo-posjogo` | Dispara comentário pós-jogo |

## Disparos automáticos (crons)

| Quando | O quê | Quem recebe |
|---|---|---|
| Todo dia 9h | Resenha do Doutor (Copa, craques, seleções) | Quem está com `/resenha on` (padrão) |
| Todo dia 8h | Comentário de notícias | Quem ativou `/noticias on` |
| Todo dia 23h | Resumo de custo estimado | Só o admin |

## Privacidade — a regra de fronteira

O Doutor é o amigo em comum de todos, mas **cada conversa é um cofre**. O que você conta em conversa privada **nunca** vaza para outro — nem o conteúdo, nem o assunto. Só é compartilhável o que nasce público: seu palpite no bolão (entra no ranking), uma pergunta de boteco respondida para síntese, ou um recado que você **pediu** para ele entregar (`/recado`).

Como admin, o `/painel` mostra **quem** falou e **quanto** — nunca o conteúdo das conversas.
