// src/claude.js — v4: cérebro do Sócrates
// caching + modo normal/profundo + memória de narrativa + custo +
// resenha turbinada (craques/seleções) + comentários de jogo.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buscarMemorias,
  salvarMemoria,
  buscarRelacao,
  selecoesDoUsuario,
  listarSelecoes,
  registrarUso,
} from './dados.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SISTEMA_BASE = readFileSync(
  join(__dirname, '..', 'prompts', 'sistema.md'),
  'utf-8'
);

const MODELO_NORMAL = process.env.MODELO_NORMAL || 'claude-sonnet-4-6';
const MODELO_PROFUNDO = process.env.MODELO_PROFUNDO || 'claude-opus-4-8';

// Extrai [MEMORIA:cat] da resposta (privado por padrão), salva, devolve texto limpo.
async function processarMemorias(usuarioId, texto) {
  const regex = /\[MEMORIA:(\w+)\]\s*(.+)/g;
  let limpo = texto;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    await salvarMemoria(usuarioId, m[1].toLowerCase(), m[2].trim(), 'privado');
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

function dataHoraSP() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

// Bloco de seleções para o contexto (Nível 1/2/3 + as que a pessoa pediu)
function blocoSelecoes(selecoesGerais, selecoesUsuario) {
  if (!selecoesGerais || selecoesGerais.length === 0) return '';
  const porNivel = { 1: [], 2: [], 3: [] };
  selecoesGerais.forEach((s) => porNivel[s.nivel]?.push(s.selecao));
  let txt = '\n\n## Seleções que o círculo acompanha na Copa\n';
  txt += `Nível 1 (sagrado): ${porNivel[1].join(', ') || '-'}\n`;
  txt += `Nível 2 (forte): ${porNivel[2].join(', ') || '-'}\n`;
  txt += `Nível 3 (grandes): ${porNivel[3].join(', ') || '-'}`;
  if (selecoesUsuario && selecoesUsuario.length > 0) {
    txt += `\nEsta pessoa pediu para acompanhar de perto: ${selecoesUsuario.join(', ')}.`;
  }
  return txt;
}

// system com prompt caching: persona fixa (cacheada) + contexto variável
function montarSistema(usuario, memorias, totalMensagens, relacao, selGerais, selUser) {
  let contexto = `## Data e hora (use sempre esta, é a fonte da verdade)\n${dataHoraSP()}\n\n## Com quem você está falando\nNome: ${usuario.nome || 'desconhecido (pergunte!)'}`;
  if (usuario.caracteristica) {
    contexto += `\n\nO Rodrigo te apresentou esta pessoa assim: "${usuario.caracteristica}". Use para puxar assunto com naturalidade, sem repetir como ficha.`;
  }
  contexto += `\n\n## Suas memórias sobre esta pessoa\n${memorias}`;

  if (relacao) {
    const partes = [];
    if (relacao.assuntos_recorrentes) partes.push(`Assuntos recorrentes: ${relacao.assuntos_recorrentes}`);
    if (relacao.tom_predominante) partes.push(`Tom predominante: ${relacao.tom_predominante}`);
    if (relacao.ultimos_temas) partes.push(`Últimos temas: ${relacao.ultimos_temas}`);
    if (relacao.nota_relacional) partes.push(`Nota: ${relacao.nota_relacional}`);
    if (relacao.ultima_conversa) partes.push(`Última conversa: ${new Date(relacao.ultima_conversa).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    if (partes.length) contexto += `\n\n## Diário do relacionamento\n${partes.join('\n')}`;
  }

  contexto += blocoSelecoes(selGerais, selUser);

  if (totalMensagens === 0) {
    contexto += `\n\n## Atenção\nPRIMEIRO contato com esta pessoa. Onboarding com charme, já a chamando pelo nome acima.`;
  } else {
    contexto += `\n\n## Contexto da relação\nVocês já trocaram ~${totalMensagens} mensagens. Se já houver intimidade e você ainda não registrou como ela prefere ser chamada, pergunte com naturalidade. Se já souber o apelido, use e não pergunte de novo.`;
  }
  return [
    { type: 'text', text: SISTEMA_BASE, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contexto },
  ];
}

// ---------- Conversa normal ----------
export async function responder(usuario, historico, totalMensagens = 0) {
  const [memorias, relacao, selGerais, selUser] = await Promise.all([
    buscarMemorias(usuario.id),
    buscarRelacao(usuario.id),
    listarSelecoes(),
    selecoesDoUsuario(usuario.id),
  ]);
  const modelo = usuario.modo === 'profundo' ? MODELO_PROFUNDO : MODELO_NORMAL;

  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 1500,
    system: montarSistema(usuario, memorias, totalMensagens, relacao, selGerais, selUser),
    messages: historico.map((m) => ({ role: m.papel, content: m.conteudo })),
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  });

  await registrarUso(usuario.id, modelo, resposta.usage, 'conversa');
  return processarMemorias(usuario.id, extrairTexto(resposta));
}

// ---------- Tarefa de difusão (resenha/notícias/jogo): 1 chamada, vários destinos ----------
async function gerarDifusao(promptUsuario, contexto, maxTokens = 2000) {
  const resposta = await anthropic.messages.create({
    model: MODELO_NORMAL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SISTEMA_BASE, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: promptUsuario }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  });
  await registrarUso(null, MODELO_NORMAL, resposta.usage, contexto);
  return extrairTexto(resposta).replace(/\[MEMORIA:\w+\].*/g, '').trim();
}

// Comentário diário das notícias
export async function gerarComentarioDoDia() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' });
  return gerarDifusao(
    `Hoje é ${hoje}. Pesquise na web as 3-4 notícias mais relevantes do dia (Brasil e mundo: política, economia, tecnologia, futebol — varie conforme o dia). Escreva o "Comentário do Sócrates": um giro pelas notícias COM personalidade — opinião, ironia fina, contexto histórico quando couber. Conversa de amigo bem informado, não telejornal. Formato WhatsApp, máx ~1500 caracteres. Termine com uma provocação do dia.`,
    'noticias'
  );
}

// ⚽ Resenha do Doutor turbinada: resultados + craques (consagrados e revelações) + seleções
export async function gerarResenhaDoDoutor() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' });
  const selGerais = await listarSelecoes();
  const porNivel = { 1: [], 2: [], 3: [] };
  selGerais.forEach((s) => porNivel[s.nivel]?.push(s.selecao));
  const blocoSel = `Seleções que o círculo acompanha — dê PRIORIDADE a elas: Nível 1 (sagrado): ${porNivel[1].join(', ')}; Nível 2: ${porNivel[2].join(', ')}; Nível 3: ${porNivel[3].join(', ')}.`;

  return gerarDifusao(
    `Hoje é ${hoje} e estamos na Copa do Mundo 2026. Pesquise na web: (1) resultados de ontem, (2) jogos de HOJE com horário de Brasília, (3) os CRAQUES em destaque — tanto os consagrados que brilharam quanto REVELAÇÕES que surgiram (jogadores que o grande público ainda não conhecia). ${blocoSel}

Escreva a "Resenha do Doutor", começando com a linha: ⚽ *Resenha do Doutor* — e a data por extenso. Depois o comentário com SUA personalidade: análise de quem entende de bola, ironia fina, memória das Copas antigas, carinho com a Seleção. Inclua um trecho "anota esse nome aí" destacando 1-2 craques/revelações do momento. Saudação coletiva VARIADA (nunca um nome específico): alterne "Salve, boêmios", "Bom dia, rapaziada", "E aí, time", ou vá direto. Formato WhatsApp, máx ~1700 caracteres. Feche com palpite OU provocação — pode ser técnico ou apaixonado, mas deixe claro de qual lado você está falando.`,
    'resenha',
    2200
  );
}

// ⚽ Comentário de jogo (manual): momento = 'prejogo' | 'intervalo' | 'posjogo'
export async function gerarComentarioJogo(momento) {
  const hoje = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
  const selGerais = await listarSelecoes();
  const porNivel = { 1: [], 2: [], 3: [] };
  selGerais.forEach((s) => porNivel[s.nivel]?.push(s.selecao));
  const foco = `Durante a Copa o foco é o Brasil (${porNivel[1].join(', ')}); comente também ${porNivel[2].join(', ')} e ${porNivel[3].join(', ')} se estiverem jogando.`;

  const instr = {
    prejogo: `Faça o ESQUENTA pré-jogo: contexto da partida, escalações prováveis, o que está em jogo, um craque para ficar de olho, e seu palpite (técnico ou apaixonado, assumindo o lado). Clima de quem vai sentar pra ver o jogo com os amigos.`,
    intervalo: `Comente o INTERVALO: o que rolou no primeiro tempo (placar, lances, quem está bem/mal), e o que esperar do segundo. Rápido e afiado, como quem comenta no bar enquanto pega a próxima cerveja.`,
    posjogo: `Faça o PÓS-JOGO: resultado, análise da partida, o craque (ou o vilão) do jogo, e o que isso significa pra frente. Resenha de quem entende, com emoção mas com olhar técnico.`,
  };

  return gerarDifusao(
    `Agora é ${hoje}, Copa do Mundo 2026. Pesquise na web os dados REAIS do jogo mais relevante de agora (placar, lances, escalação conforme o momento). ${foco} ${instr[momento] || instr.prejogo} Comece com ⚽ e uma saudação coletiva variada (nunca um nome). Formato WhatsApp, máx ~1400 caracteres.`,
    `jogo_${momento}`,
    1800
  );
}
