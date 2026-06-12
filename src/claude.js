// src/claude.js — cérebro do Sócrates: caching + modo normal/profundo
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buscarMemorias, salvarMemoria } from './dados.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SISTEMA_BASE = readFileSync(
  join(__dirname, '..', 'prompts', 'sistema.md'),
  'utf-8'
);

// Modelos: normal para o dia a dia; profundo para conversas densas
const MODELO_NORMAL = process.env.MODELO_NORMAL || 'claude-sonnet-4-6';
const MODELO_PROFUNDO = process.env.MODELO_PROFUNDO || 'claude-opus-4-8';

// Extrai [MEMORIA:cat] da resposta, salva e devolve texto limpo
async function processarMemorias(usuarioId, texto) {
  const regex = /\[MEMORIA:(\w+)\]\s*(.+)/g;
  let limpo = texto;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    await salvarMemoria(usuarioId, m[1].toLowerCase(), m[2].trim());
    limpo = limpo.replace(m[0], '');
  }
  return limpo.trim();
}

function extrairTexto(resposta) {
  return resposta.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// Monta o system com prompt caching:
// bloco 1 (persona, fixo) = cacheado; bloco 2 (contexto do usuário) = variável
function montarSistema(usuario, memorias, primeiroContato) {
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  let contexto = `## Data e hora\n${agora}\n\n## Com quem você está falando\nNome: ${usuario.nome || 'desconhecido (pergunte!)'}\n\n## Suas memórias sobre esta pessoa\n${memorias}`;
  if (primeiroContato) {
    contexto += `\n\n## Atenção\nEste é o PRIMEIRO contato com esta pessoa. Faça o onboarding com charme.`;
  }
  return [
    {
      type: 'text',
      text: SISTEMA_BASE,
      cache_control: { type: 'ephemeral' }, // persona cacheada (90% mais barata nas releituras)
    },
    { type: 'text', text: contexto },
  ];
}

// Conversa normal
export async function responder(usuario, historico, primeiroContato = false) {
  const memorias = await buscarMemorias(usuario.id);
  const modelo = usuario.modo === 'profundo' ? MODELO_PROFUNDO : MODELO_NORMAL;

  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 1500,
    system: montarSistema(usuario, memorias, primeiroContato),
    messages: historico.map((m) => ({ role: m.papel, content: m.conteudo })),
  });

  return processarMemorias(usuario.id, extrairTexto(resposta));
}

// Comentário diário das notícias (gerado 1x, enviado a todos os assinantes)
export async function gerarComentarioDoDia() {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
  });

  const resposta = await anthropic.messages.create({
    model: MODELO_NORMAL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: SISTEMA_BASE,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Hoje é ${hoje}. Pesquise na web as 3-4 notícias mais relevantes do dia (Brasil e mundo: política, economia, tecnologia, futebol — varie conforme o dia pedir). Depois escreva o "Comentário do Sócrates": um giro pelas notícias COM a sua personalidade — opinião, ironia fina, contexto histórico quando couber. Não é telejornal, é conversa de amigo bem informado. Formato WhatsApp, máximo ~1500 caracteres. Termine com uma provocação ou pergunta para o dia.`,
      },
    ],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  });

  return extrairTexto(resposta).replace(/\[MEMORIA:\w+\].*/g, '').trim();
}

// ⚽ Resenha do Doutor: jogos do dia, resultados de ontem e curiosidades
export async function gerarResenhaDoDoutor() {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
  });

  const resposta = await anthropic.messages.create({
    model: MODELO_NORMAL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: SISTEMA_BASE,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Hoje é ${hoje} e estamos na Copa do Mundo 2026. Pesquise na web: (1) os resultados dos jogos de ontem, (2) os jogos de HOJE com horários de Brasília, e (3) alguma curiosidade boa sobre os times ou jogadores que entram em campo hoje (história, estatística, drama, zebra). Depois escreva a "Resenha do Doutor", começando a mensagem com a linha: ⚽ *Resenha do Doutor* — e a data de hoje por extenso. Em seguida, o comentário: comentário com a SUA personalidade — análise de quem entende de bola, ironia fina, memória das Copas antigas, carinho especial quando envolver a Seleção. Não é tabela fria de resultados, é resenha de amigo que jogou futebol de verdade. Formato WhatsApp, máximo ~1600 caracteres. Feche com um palpite ou provocação do dia.`,
      },
    ],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  });

  return extrairTexto(resposta).replace(/\[MEMORIA:\w+\].*/g, '').trim();
}
