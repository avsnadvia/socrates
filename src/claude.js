// src/claude.js — v4.1: cérebro do Sócrates
// caching + modo normal/profundo + memória de narrativa + custo +
// resenha turbinada + comentários de jogo + FONTES EXTERNAS (futebol/notícias/clima).
// IMPORTANTE: força o uso do fetch NATIVO do Node (undici) em vez do node-fetch.
// O node-fetch tem um bug em que "Premature close" escapa do try/catch e derruba o
// processo. Com o fetch nativo, o erro vira rejeição normal — capturável pelo retry
// e pelo plano B. Este import precisa vir ANTES do import do SDK.
import '@anthropic-ai/sdk/shims/web';
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
import { ferramentasCustom, executarFerramenta } from './fontes.js';
import { temFallback, responderFallback } from './fallback.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SISTEMA_BASE = readFileSync(join(__dirname, '..', 'prompts', 'sistema.md'), 'utf-8');

const MODELO_NORMAL = process.env.MODELO_NORMAL || 'claude-sonnet-4-6';
const MODELO_PROFUNDO = process.env.MODELO_PROFUNDO || 'claude-opus-4-8';

const SERVER_TOOLS = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];

// Modelo de emergência: estável e barato, para quando o principal estiver oscilando.
const MODELO_FALLBACK = process.env.MODELO_FALLBACK || 'claude-sonnet-4-6';

// Detecta erros transitórios (queda de conexão, sobrecarga, timeout da API).
function ehErroTransiente(err) {
  const code = err?.code || err?.cause?.code || '';
  const status = err?.status;
  if (['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(code)) return true;
  if ([408, 409, 429, 500, 502, 503, 529].includes(status)) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('premature close') || msg.includes('overloaded') || msg.includes('timeout') || msg.includes('connection');
}

// Chama a API com tentativas repetidas e, se o modelo principal insistir em falhar,
// tenta automaticamente no modelo de fallback (desvia de incidentes do Opus).
async function criarComRetry(params, tentativas = 3) {
  const modelos = params.model && params.model !== MODELO_FALLBACK
    ? [params.model, MODELO_FALLBACK]
    : [params.model];
  let ultimoErro;
  for (const model of modelos) {
    for (let i = 0; i < tentativas; i++) {
      try {
        return await anthropic.messages.create({ ...params, model });
      } catch (err) {
        ultimoErro = err;
        if (!ehErroTransiente(err)) throw err;
        const espera = 800 * 2 ** i; // 0,8s · 1,6s · 3,2s
        console.warn(`Anthropic instável (${err.code || err.status || err.message}) em ${model}. Tentativa ${i + 1}/${tentativas}, aguardando ${espera}ms.`);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
    if (model !== MODELO_FALLBACK) console.warn(`Trocando para o modelo de emergência: ${MODELO_FALLBACK}`);
  }
  throw ultimoErro;
}

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
  return resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function dataHoraSP() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

// ---------- LAÇO AGÊNTICO ----------
// Faz a chamada à API; se o modelo pedir uma ferramenta custom (futebol/notícias/
// clima), executa e devolve o resultado, repetindo até ele responder. A busca web
// é server-side (a Anthropic resolve sozinha). Limite de 5 voltas por segurança.
async function conversarComFerramentas({ model, max_tokens, system, messages, contexto, usuarioId = null }) {
  const tools = [...SERVER_TOOLS, ...ferramentasCustom()];
  const msgs = [...messages];
  let textoFinal = '';
  try {
    for (let i = 0; i < 5; i++) {
      const resposta = await criarComRetry({ model, max_tokens, system, messages: msgs, tools });
      await registrarUso(usuarioId, model, resposta.usage, contexto);

      const txt = extrairTexto(resposta);
      if (txt) textoFinal = txt;

      if (resposta.stop_reason !== 'tool_use') break;

      // Executa as ferramentas custom que o modelo pediu
      const pedidos = resposta.content.filter((b) => b.type === 'tool_use');
      if (pedidos.length === 0) break;
      const resultados = [];
      for (const p of pedidos) {
        const saida = await executarFerramenta(p.name, p.input);
        resultados.push({ type: 'tool_result', tool_use_id: p.id, content: saida });
      }
      msgs.push({ role: 'assistant', content: resposta.content });
      msgs.push({ role: 'user', content: resultados });
    }
    return textoFinal;
  } catch (err) {
    // Anthropic esgotou as tentativas (incidente amplo). Aciona o PLANO B.
    if (temFallback()) {
      console.warn(`Anthropic indisponível (${err?.message || err}). Acionando plano B (provedor reserva)...`);
      const texto = await responderFallback({ system, messages, max_tokens });
      console.warn('Plano B respondeu com sucesso.');
      return texto;
    }
    throw err;
  }
}

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
export async function responder(usuario, historico, totalMensagens = 0, anexo = null) {
  const [memorias, relacao, selGerais, selUser] = await Promise.all([
    buscarMemorias(usuario.id),
    buscarRelacao(usuario.id),
    listarSelecoes(),
    selecoesDoUsuario(usuario.id),
  ]);
  const modelo = usuario.modo === 'profundo' ? MODELO_PROFUNDO : MODELO_NORMAL;

  const messages = historico.map((m) => ({ role: m.papel, content: m.conteudo }));

  // Se veio uma imagem, injeta ela na última mensagem do usuário (visão).
  if (anexo?.data && messages.length) {
    const ultima = messages[messages.length - 1];
    const legenda = typeof ultima.content === 'string' ? ultima.content.replace(/^\[imagem\]\s*/, '') : '';
    ultima.content = [
      { type: 'image', source: { type: 'base64', media_type: anexo.media_type, data: anexo.data } },
      { type: 'text', text: legenda || 'Dá uma olhada nessa imagem que te mandei e comenta no teu estilo.' },
    ];
  }

  const textoFinal = await conversarComFerramentas({
    model: modelo,
    max_tokens: 1500,
    system: montarSistema(usuario, memorias, totalMensagens, relacao, selGerais, selUser),
    messages,
    contexto: 'conversa',
    usuarioId: usuario.id,
  });

  return processarMemorias(usuario.id, textoFinal);
}

// ---------- Modo Grupo (mediador/participante) ----------
const GRUPO_REGRAS = `

## VOCÊ ESTÁ NUM GRUPO (modo grupo — leia com atenção)
Você está participando de um GRUPO de WhatsApp da turma, não de uma conversa privada.
- COFRE LACRADO: aqui você NÃO tem acesso a nada que alguém te contou em particular. Não cite, não insinue, não use memória privada de ninguém. O grupo é canal público: trate apenas o que foi dito aqui no grupo.
- Cada fala vem marcada com o nome de quem falou ("Fulano: ..."). Dirija-se às pessoas pelo nome quando fizer sentido.
- SEJA CURTO: grupo não é lugar de textão. Uma ou duas frases na maioria das vezes. Solte algo mais longo só se pedirem análise.
- Juiz de boteco: se houver discussão factual (placar, quem fez gol, tabela), resolva com a ferramenta de futebol (código WC) e encerre a treta com o dado certo.
- Animador: puxe papo e provoque com bom humor — sem floodar.
- Você NÃO é mediador de briga séria. Se o clima esquentar de verdade entre pessoas, alivie com humor ou desconverse, mas não tome partido nem dê sermão.`;

export async function responderGrupo({ historico, gatilho }) {
  const linhas = historico
    .map((m) => (m.papel === 'assistant' ? `Sócrates: ${m.conteudo}` : `${m.autor || 'alguém'}: ${m.conteudo}`))
    .join('\n');
  const promptUsuario =
    `Conversa recente no grupo:\n${linhas}\n\n` +
    `Você é o Doutor Sócrates participando DESTE grupo. ${gatilho}\n` +
    `Responda curto, no seu estilo. Se for resolver algo factual de futebol, use a ferramenta (código WC). Nunca use memória privada de ninguém.`;
  const texto = await conversarComFerramentas({
    model: MODELO_NORMAL,
    max_tokens: 800,
    system: [{ type: 'text', text: SISTEMA_BASE + GRUPO_REGRAS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: promptUsuario }],
    contexto: 'grupo',
  });
  return texto.replace(/\[MEMORIA:\w+\].*/g, '').trim();
}

// ---------- Difusão (resenha/notícias/jogo) ----------
async function gerarDifusao(promptUsuario, contexto, maxTokens = 2000) {
  const textoFinal = await conversarComFerramentas({
    model: MODELO_NORMAL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SISTEMA_BASE, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: promptUsuario }],
    contexto,
  });
  return textoFinal.replace(/\[MEMORIA:\w+\].*/g, '').trim();
}

// Mensagem de feliz aniversário no estilo do Doutor.
export async function gerarParabens(nome) {
  return gerarDifusao(
    `Hoje é aniversário de ${nome}, um dos amigos do círculo. Escreva uma mensagem curta de feliz aniversário NO SEU ESTILO (Doutor Sócrates) — calorosa, com bom humor e um toque filosófico ou futebolístico, como um amigo de verdade manda no WhatsApp. Fale direto com ${nome} (segunda pessoa, "você"). Comece com um 🎂 ou 🎉. Máx ~400 caracteres. Não invente fatos da vida dele.`,
    'parabens',
    600
  );
}

// Resenha QUENTE de um jogo que acabou de terminar (radar automático de pós-jogo).
export async function gerarPosJogo(jogo) {
  const placar = `${jogo.casa} ${jogo.golCasa}x${jogo.golFora} ${jogo.fora}`;
  return gerarDifusao(
    `Acabou de terminar AGORA um jogo da Copa do Mundo 2026: ${placar}. Escreva a resenha QUENTE do pós-jogo NO SEU ESTILO (Doutor Sócrates) — análise de quem entende de bola, emoção, ironia fina. Se ajudar, use a ferramenta de futebol (código WC) para conferir a classificação atualizada do grupo. Foque NESTE jogo (${placar}); não misture com outras partidas. Comece com ⚽ e uma saudação coletiva variada (nunca um nome específico). Formato WhatsApp, máx ~1200 caracteres. Feche com uma provocação ou palpite.`,
    'posjogo',
    1600
  );
}

// Fechamento do bolão: comemora o líder e zoa (com carinho) o lanterna.
export async function gerarFechamentoBolao(ranking) {
  const tabela = ranking.map((u, i) => `${i + 1}. ${u.nome} — ${u.pontos}pts`).join('\n');
  return gerarDifusao(
    `Fechamento do nosso bolão da Copa. Ranking atual:\n${tabela}\n\nEscreva um boletim CURTO e divertido NO SEU ESTILO (Doutor Sócrates): exalte o líder e provoque com carinho o lanterna (zoeira de amigo, nunca humilhação). Comece com 🏆. Formato WhatsApp, máx ~600 caracteres.`,
    'bolao',
    800
  );
}

export async function gerarComentarioDoDia() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' });
  return gerarDifusao(
    `Hoje é ${hoje}. Pesquise as 3-4 notícias mais relevantes do dia (Brasil e mundo: política, economia, tecnologia, futebol — varie conforme o dia; pode usar a ferramenta de notícias ou a busca web). Escreva o "Comentário do Sócrates": um giro pelas notícias COM personalidade — opinião, ironia fina, contexto histórico quando couber. Conversa de amigo bem informado, não telejornal. Formato WhatsApp, máx ~1500 caracteres. Termine com uma provocação do dia.`,
    'noticias'
  );
}

export async function gerarResenhaDoDoutor() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' });
  const selGerais = await listarSelecoes();
  const porNivel = { 1: [], 2: [], 3: [] };
  selGerais.forEach((s) => porNivel[s.nivel]?.push(s.selecao));
  const blocoSel = `Seleções que o círculo acompanha — dê PRIORIDADE a elas: Nível 1 (sagrado): ${porNivel[1].join(', ')}; Nível 2: ${porNivel[2].join(', ')}; Nível 3: ${porNivel[3].join(', ')}.`;

  return gerarDifusao(
    `Hoje é ${hoje} e estamos na Copa do Mundo 2026. Busque dados REAIS com a ferramenta de futebol (código WC), SEMPRE filtrando por data (dataInicio/dataFim) para não misturar rodadas: (1) resultados de ONTEM — chame a ferramenta com a data de ontem; (2) jogos de HOJE com horário de Brasília — chame com a data de hoje; (3) os CRAQUES em destaque — consagrados e REVELAÇÕES (aqui pode usar a busca web). Confira a data de cada jogo antes de comentar; jamais junte jogos de dias diferentes. ${blocoSel}

Escreva a "Resenha do Doutor", começando com a linha: ⚽ *Resenha do Doutor* — e a data por extenso. Depois o comentário com SUA personalidade: análise de quem entende de bola, ironia fina, memória das Copas antigas, carinho com a Seleção. Inclua um "anota esse nome aí" destacando 1-2 craques/revelações. Saudação coletiva VARIADA (nunca um nome específico). Formato WhatsApp, máx ~1700 caracteres. Feche com palpite OU provocação — técnico ou apaixonado, deixando claro de qual lado fala.`,
    'resenha',
    2200
  );
}

export async function gerarComentarioJogo(momento) {
  const hoje = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
  const selGerais = await listarSelecoes();
  const porNivel = { 1: [], 2: [], 3: [] };
  selGerais.forEach((s) => porNivel[s.nivel]?.push(s.selecao));
  const foco = `Durante a Copa o foco é o Brasil (${porNivel[1].join(', ')}); comente também ${porNivel[2].join(', ')} e ${porNivel[3].join(', ')} se estiverem jogando.`;

  const instr = {
    prejogo: `Faça o ESQUENTA pré-jogo: contexto, escalações prováveis, o que está em jogo, um craque para ficar de olho, e seu palpite (técnico ou apaixonado, assumindo o lado).`,
    intervalo: `Comente o INTERVALO: o que rolou no primeiro tempo (placar, lances, quem está bem/mal) e o que esperar do segundo. Rápido e afiado.`,
    posjogo: `Faça o PÓS-JOGO: resultado, análise, o craque (ou vilão) do jogo, e o que significa pra frente. Emoção com olhar técnico.`,
  };

  return gerarDifusao(
    `Agora é ${hoje}, Copa do Mundo 2026. Busque os dados REAIS do jogo mais relevante de agora (use a ferramenta de futebol — código WC — para placar/tabela, e a busca web para escalação/lances). ${foco} ${instr[momento] || instr.prejogo} Comece com ⚽ e uma saudação coletiva variada (nunca um nome). Formato WhatsApp, máx ~1400 caracteres.`,
    `jogo_${momento}`,
    1800
  );
}
