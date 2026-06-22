// src/index.js — Sócrates v4: multiusuário, comandos, resenha, jogo, bolão, painel, custo

// Rede de segurança: nenhum erro solto (ex: stream que escapa) pode derrubar o processo.
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e));

import express from 'express';
import cron from 'node-cron';
import {
  responder,
  gerarComentarioDoDia,
  gerarResenhaDoDoutor,
  gerarComentarioJogo,
  gerarParabens,
  gerarPosJogo,
  responderGrupo,
  gerarFechamentoBolao,
  gerarPerguntaSemana,
  gerarSintesePergunta,
} from './claude.js';
import {
  buscarUsuario,
  buscarUsuarioPorId,
  adicionarUsuario,
  removerUsuario,
  listarUsuarios,
  listarAssinantes,
  atualizarUsuario,
  salvarMensagem,
  buscarHistorico,
  contarMensagens,
  marcarConversa,
  registrarPalpite,
  adicionarSelecaoUsuario,
  dadosPainel,
  custoDesde,
  custoTotal,
  registrarRecado,
  esquecerUsuario,
  aniversariantesDeHoje,
  listarSelecoes,
  jaAvisou,
  marcarAvisado,
  salvarMensagemGrupo,
  historicoGrupo,
  palpitesPendentes,
  pontuarPalpite,
  rankingBolao,
  criarLembrete,
  lembretesPendentes,
  marcarLembreteEnviado,
  listarAdmins,
  criarPergunta,
  perguntaAtiva,
  respostasDaPergunta,
} from './dados.js';
import { enviarMensagem, baixarMidiaBase64 } from './whatsapp.js';
import { listarJogosCopa, mesmaSelecao } from './fontes.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

// Fila por usuário (paralelo entre pessoas, ordem dentro da mesma pessoa)
const filas = new Map();
function enfileirar(numero, tarefa) {
  const anterior = filas.get(numero) || Promise.resolve();
  const proxima = anterior.then(tarefa).catch((e) => console.error(e));
  filas.set(numero, proxima);
}

function inicioDoDiaISO() {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  agora.setHours(0, 0, 0, 0);
  return agora.toISOString();
}
function inicioDaSemanaISO() {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dia = agora.getDay();
  const diff = (dia + 6) % 7; // segunda como início
  agora.setDate(agora.getDate() - diff);
  agora.setHours(0, 0, 0, 0);
  return agora.toISOString();
}

// Difusão de uma mensagem para os assinantes de um canal (pausa anti-bloqueio)
async function difundir(texto, campoAssinatura) {
  const assinantes = await listarAssinantes(campoAssinatura);
  for (const a of assinantes) {
    await enviarMensagem(a.numero, texto);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return assinantes.length;
}

// ---------- COMANDOS ----------
async function tratarComando(usuario, texto) {
  const t = texto.trim().toLowerCase();

  // ---- Qualquer usuário ----
  if (t === '/profundo') {
    await atualizarUsuario(usuario.id, { modo: 'profundo' });
    return '🧠 Modo profundo ligado. Penso com mais calma (e custo um pouco mais pro Rodrigo, hein). /normal volta.';
  }
  if (t === '/normal') {
    await atualizarUsuario(usuario.id, { modo: 'normal' });
    return 'Modo normal de volta. Leve como resenha de bar. ⚽';
  }
  if (t === '/resenha on' || t === '/copa on') {
    await atualizarUsuario(usuario.id, { recebe_copa: true });
    return 'Bola rolando: todo dia às 9h chega a Resenha do Doutor. ⚽';
  }
  if (t === '/resenha off' || t === '/copa off') {
    await atualizarUsuario(usuario.id, { recebe_copa: false });
    return 'Sem Resenha então. Se o Brasil chegar na final, eu volto a gritar aqui. ⚽😄';
  }
  if (t === '/noticias on') {
    await atualizarUsuario(usuario.id, { recebe_noticias: true });
    return 'Combinado: meu comentário das notícias do Brasil e do mundo, todo dia. 📰';
  }
  if (t === '/noticias off') {
    await atualizarUsuario(usuario.id, { recebe_noticias: false });
    return 'Sem noticiário. Quando quiser saber do mundo, é só perguntar.';
  }

  // /palpite Brasil x Marrocos = 2x1   (bolão — canal coletivo)
  if (t.startsWith('/palpite ')) {
    const corpo = texto.trim().slice(9);
    const idx = corpo.lastIndexOf('=');
    if (idx === -1) return 'Manda assim: /palpite Brasil x Marrocos = 2x1';
    const jogo = corpo.slice(0, idx).trim();
    const palpite = corpo.slice(idx + 1).trim();
    if (!jogo || !palpite) return 'Manda assim: /palpite Brasil x Marrocos = 2x1';
    await registrarPalpite(usuario.id, jogo, palpite);
    return `⚽ Anotado seu palpite: ${jogo} = ${palpite}. Tá no bolão! Que o melhor (ou o mais sortudo) vença.`;
  }

  // /ranking — placar do bolão (canal coletivo, todos podem ver)
  if (t === '/ranking' || t === '/bolao' || t === '/bolão') {
    const r = await rankingBolao();
    if (!r.length) return '🏆 O bolão ainda não tem pontos. Mandem seus palpites com /palpite que eu vou contabilizando quando os jogos acabarem!';
    const medalha = ['🥇', '🥈', '🥉'];
    const linhas = r.map((u, i) => `${medalha[i] || `${i + 1}.`} ${u.nome} — *${u.pontos}* pts (${u.jogos}j)`);
    return `🏆 *RANKING DO BOLÃO*\n\n${linhas.join('\n')}\n\n_Pontos: 10 (placar exato) · 7 (saldo certo) · 5 (acertou quem ganhou) · 0 (errou)_`;
  }

  if (t === '/fechar-bolao' || t === '/fechar-bolão') {
    if (!usuario.admin) return null;
    const r = await rankingBolao();
    if (!r.length) return 'Sem pontos no bolão ainda — nada pra fechar.';
    const msg = await gerarFechamentoBolao(r);
    const assinantes = await listarAssinantes('recebe_copa');
    for (const a of assinantes) {
      await enviarMensagem(a.numero, msg);
      await new Promise((rr) => setTimeout(rr, 3000));
    }
    return `🏆 Fechamento do bolão enviado para ${assinantes.length} pessoas.`;
  }

  // /lembrar-todos DD/MM HH:MM | mensagem  (lembrete coletivo — só admin)
  if (t.startsWith('/lembrar-todos ')) {
    if (!usuario.admin) return null;
    const corpo = texto.trim().slice(15).trim();
    const sep = corpo.indexOf('|');
    if (sep === -1) return 'Manda assim: /lembrar-todos 25/12 09:00 | Feliz Natal, galera!';
    const quandoStr = corpo.slice(0, sep).trim();
    const msg = corpo.slice(sep + 1).trim();
    const md = quandoStr.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/);
    if (!md || !msg) return 'Manda assim: /lembrar-todos 25/12 09:00 | mensagem';
    const ano = md[3] ? (md[3].length === 2 ? `20${md[3]}` : md[3]) : String(new Date().getFullYear());
    const iso = `${ano}-${md[2].padStart(2, '0')}-${md[1].padStart(2, '0')}T${md[4].padStart(2, '0')}:${md[5]}:00-03:00`;
    const quando = new Date(iso);
    if (isNaN(quando.getTime())) return 'Data inválida. Ex: /lembrar-todos 25/12 09:00 | mensagem';
    await criarLembrete({ usuarioId: usuario.id, numero: null, escopo: 'coletivo', texto: msg, dispararEm: quando.toISOString() });
    return `⏰ Lembrete coletivo agendado para ${md[1].padStart(2, '0')}/${md[2].padStart(2, '0')} às ${md[4].padStart(2, '0')}:${md[5]}. Vou avisar a turma toda na hora.`;
  }

  // /perguntar <texto>  (lança a pergunta da semana na hora — só admin)
  if (t.startsWith('/perguntar ')) {
    if (!usuario.admin) return null;
    const texPergunta = texto.trim().slice(11).trim();
    if (!texPergunta) return 'Manda assim: /perguntar Qual foi o gol mais bonito que você já viu ao vivo?';
    await criarPergunta(texPergunta);
    const assinantes = await listarAssinantes('recebe_copa');
    const msg = `💬 *PERGUNTA DA SEMANA*\n\n${texPergunta}\n\n_Responde aqui no privado que eu compilo!_`;
    for (const a of assinantes) {
      await enviarMensagem(a.numero, msg);
      await new Promise((rr) => setTimeout(rr, 2500));
    }
    return `💬 Pergunta lançada para ${assinantes.length} pessoas.`;
  }

  // /soltar-sintese  (envia a síntese da pergunta atual para a turma — só admin)
  if (t === '/soltar-sintese') {
    if (!usuario.admin) return null;
    const p = await perguntaAtiva();
    if (!p) return 'Não há pergunta da semana ativa.';
    const respostas = await respostasDaPergunta(p.id);
    if (!respostas.length) return 'Ninguém respondeu ainda — nada para sintetizar.';
    const sintese = await gerarSintesePergunta(p.texto, respostas);
    const assinantes = await listarAssinantes('recebe_copa');
    for (const a of assinantes) {
      await enviarMensagem(a.numero, sintese);
      await new Promise((rr) => setTimeout(rr, 3000));
    }
    return `💬 Síntese enviada para ${assinantes.length} pessoas.`;
  }

  // /acompanhar Croácia  (a pessoa escolhe acompanhar uma seleção)
  if (t.startsWith('/acompanhar ')) {
    const sel = texto.trim().slice(12).trim();
    if (!sel) return 'Qual seleção? Ex.: /acompanhar Croácia';
    await adicionarSelecaoUsuario(usuario.id, sel);
    return `Fechado, vou ficar de olho na ${sel} pra você também. 🌎`;
  }

  // /recado 5516999999999 | texto   (Correio do Magrão — autorizado = coletivo)
  if (t.startsWith('/recado ')) {
    const corpo = texto.trim().slice(8);
    const [esq, ...resto] = corpo.split('|');
    const para = (esq || '').replace(/\D/g, '');
    const msg = resto.join('|').trim();
    if (!para || !msg) return 'Manda assim: /recado 5516999999999 | sua mensagem';
    const destino = await buscarUsuario(para);
    if (!destino) return 'Esse número não está no círculo — só consigo levar recado pra quem já conversa comigo.';
    await registrarRecado(usuario.id, para, msg);
    const aviso = `📬 Recado entregue pelo Correio do Magrão, da parte de ${usuario.nome || 'um amigo'}:\n\n"${msg}"`;
    await enviarMensagem(para, aviso);
    return `Entreguei pro ${destino.nome || para}. O Doutor leva e traz. 🍻`;
  }

  if (t === '/esquecer') {
    await esquecerUsuario(usuario.id);
    return 'Pronto: apaguei nossas conversas e o que eu sabia de você. Continuamos amigos no círculo — começamos do zero quando quiser. 🧹';
  }

  if (t === '/ajuda') {
    let ajuda =
      '⚽ *Pois não, meu caro.* Eis o que sei fazer:\n\n' +
      '💬 Conversar sobre o que der na telha — bola, vida, livro, decisão difícil\n' +
      '🧠 /profundo — papo mais denso (/normal volta)\n' +
      '📰 /resenha on|off — minha Resenha da Copa (9h)\n' +
      '🌎 /noticias on|off — giro das notícias (8h)\n' +
      '🎯 /palpite Brasil x Marrocos = 2x1 — entra no bolão\n' +
      '🏆 /ranking — placar do bolão\n' +
      '⏰ "me lembra amanhã às 9h de..." — eu te aviso na hora\n' +
      '🏆 /acompanhar Croácia — sigo uma seleção sua de perto\n' +
      '📬 /recado NUMERO | texto — mando um recado seu pra outro do círculo\n' +
      '🧹 /esquecer — apago o que sei de você\n\n' +
      '_Mas o melhor é não usar comando nenhum: só me manda o que tá pensando._';
    if (usuario.admin) {
      ajuda +=
        '\n\n*Admin:*\n' +
        '/add NUMERO Nome | característica\n' +
        '/remover NUMERO\n' +
        '/aniversario NUMERO DD/MM\n' +
        '/fechar-bolao\n' +
        '/lembrar-todos DD/MM HH:MM | msg\n' +
        '/perguntar TEXTO · /soltar-sintese\n' +
        '/usuarios · /painel · /custo\n' +
        '/jogo-prejogo · /jogo-intervalo · /jogo-posjogo';
    }
    return ajuda;
  }

  // ---- Só admin ----
  if (usuario.admin) {
    if (t.startsWith('/add ')) {
      const corpo = texto.trim().slice(5);
      const [parteEsq, ...resto] = corpo.split('|');
      const caracteristica = resto.join('|').trim() || null;
      const tokens = parteEsq.trim().split(/\s+/);
      const numero = (tokens[0] || '').replace(/\D/g, '');
      const nome = tokens.slice(1).join(' ') || null;
      if (!numero) return 'Formato: /add 5516991234567 Nome | característica (opcional)';
      const ok = await adicionarUsuario(numero, nome, caracteristica);
      return ok
        ? `⚽ ${nome || numero} entrou pro jogo!${caracteristica ? ' Já anotei quem ele é.' : ''}`
        : 'Esse número já está cadastrado (ou deu erro).';
    }
    if (t.startsWith('/remover ')) {
      const numero = texto.trim().split(/\s+/)[1]?.replace(/\D/g, '');
      const ok = await removerUsuario(numero);
      return ok ? '✅ Removido (histórico e memórias apagados).' : 'Número não encontrado.';
    }
    if (t.startsWith('/aniversario ')) {
      const parts = texto.trim().split(/\s+/);
      const numero = (parts[1] || '').replace(/\D/g, '');
      const m = (parts[2] || '').match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!numero || !m) return 'Formato: /aniversario 5516991234567 25/12';
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      const alvo = await buscarUsuario(numero);
      if (!alvo) return 'Esse número não está no círculo.';
      await atualizarUsuario(alvo.id, { aniversario: `${mm}-${dd}` });
      return `🎂 Anotado! Aniversário de ${alvo.nome || numero} em ${dd}/${mm}. Vou lembrar todo ano.`;
    }
    if (t === '/usuarios') {
      const lista = await listarUsuarios();
      return (
        `👥 ${lista.length} no círculo:\n` +
        lista.map((u) => `• ${u.nome || u.numero} (${u.modo}${u.recebe_copa ? ' ⚽' : ''}${u.recebe_noticias ? ' 📰' : ''})`).join('\n')
      );
    }
    if (t === '/painel') {
      const dados = await dadosPainel();
      const falaram = dados.filter((d) => d.mensagens > 0);
      const calados = dados.filter((d) => d.mensagens === 0);
      const top = [...falaram].sort((a, b) => b.mensagens - a.mensagens).slice(0, 5);
      let r = `👥 *Painel do círculo* (${dados.length} pessoas)\n\n`;
      r += `✅ Já conversaram (${falaram.length}): ${falaram.map((d) => d.nome).join(', ') || '—'}\n\n`;
      r += `⏳ Ainda calados (${calados.length}): ${calados.map((d) => d.nome).join(', ') || '—'}`;
      if (top.length) r += `\n\n🔝 Mais ativos: ${top.map((d) => `${d.nome} (${d.mensagens})`).join(', ')}`;
      return r;
    }
    if (t === '/custo') {
      const [hoje, semana, total] = await Promise.all([
        custoDesde(inicioDoDiaISO()),
        custoDesde(inicioDaSemanaISO()),
        custoTotal(),
      ]);
      return (
        `💰 *Custo estimado* (tokens × tabela; não é a fatura real da Anthropic)\n\n` +
        `Hoje: US$ ${hoje.toFixed(2)}\n` +
        `Semana: US$ ${semana.toFixed(2)}\n` +
        `Total: US$ ${total.toFixed(2)}\n\n` +
        `_Estimativa para acompanhamento. O valor oficial está no console.anthropic.com._`
      );
    }
    if (t === '/jogo-prejogo' || t === '/jogo-intervalo' || t === '/jogo-posjogo') {
      const momento = t.replace('/jogo-', '');
      await enviarMensagem(usuario.numero, '⚽ Preparando o comentário e buscando os dados do jogo... já disparo pra galera.');
      try {
        const texto = await gerarComentarioJogo(momento);
        const n = await difundir(texto, 'recebe_copa');
        return `✅ Comentário de ${momento} enviado para ${n} pessoas.`;
      } catch (e) {
        console.error('Falha no comentário de jogo:', e?.message || e);
        return '⚠️ Não consegui gerar o comentário agora (a API do Claude está oscilando). Tenta de novo em alguns minutos.';
      }
    }
  }

  return null; // não é comando: segue conversa normal
}

// ---------- WEBHOOK ----------
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const evento = req.body;
  if (evento?.event !== 'messages.upsert') return;

  const dados = evento.data;
  if (!dados || dados.key?.fromMe) return;

  const remoteJid = dados.key?.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) {
    tratarGrupo(remoteJid, dados);
    return;
  }
  const numero = remoteJid.split('@')[0];

  const imagem = dados.message?.imageMessage || null;
  const messageId = dados.key?.id || null;
  const texto =
    dados.message?.conversation ||
    dados.message?.extendedTextMessage?.text ||
    (imagem ? imagem.caption || '[imagem]' : null);
  if (!texto) return;

  enfileirar(numero, async () => {
    const usuario = await buscarUsuario(numero);
    if (!usuario) {
      console.log(`Número não autorizado ignorado: ${numero}`);
      return;
    }

    console.log(`Msg de ${usuario.nome || numero}: ${imagem ? '[imagem] ' : ''}${texto.slice(0, 60)}`);

    const respostaComando = await tratarComando(usuario, texto);
    if (respostaComando) {
      await enviarMensagem(numero, respostaComando);
      return;
    }

    // Se veio imagem, baixa em base64 para o Doutor "ver".
    let anexo = null;
    if (imagem && messageId) {
      const midia = await baixarMidiaBase64(messageId);
      if (midia?.base64 && (midia.mimetype || '').startsWith('image/')) {
        anexo = { media_type: midia.mimetype, data: midia.base64 };
      }
    }

    const totalMensagens = await contarMensagens(usuario.id);
    await salvarMensagem(usuario.id, 'user', texto);
    const historico = await buscarHistorico(usuario.id, 30);
    let resposta;
    try {
      resposta = await responder(usuario, historico, totalMensagens, anexo);
    } catch (e) {
      console.error('Falha ao gerar resposta:', e?.message || e);
      await enviarMensagem(
        numero,
        '⚽ Opa, deu uma travada na minha conexão aqui — meu cérebro tá oscilando neste instante. Manda de novo daqui a pouquinho que eu te respondo, combinado?'
      );
      return;
    }
    await salvarMensagem(usuario.id, 'assistant', resposta);
    await marcarConversa(usuario.id);
    await enviarMensagem(numero, resposta);
  });
});

app.get('/', (_req, res) => res.send('Sócrates no ar ⚽🧠'));

// ---------- MODO GRUPO ----------
const ultimoEspontaneo = new Map(); // grupoJid -> timestamp da última intromissão espontânea

function mencionaramOBot(dados, texto) {
  const t = (texto || '').toLowerCase();
  const porNome = /(sócrates|socrates|magrão|magrao|doutor)/.test(t);
  const botNum = (process.env.BOT_NUMERO || '').replace(/\D/g, '');
  const mencionados = dados.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const porArroba = !!botNum && mencionados.some((j) => (j || '').includes(botNum));
  return porNome || porArroba;
}

function tratarGrupo(grupoJid, dados) {
  // Modo grupo é OPT-IN: o Doutor só atua em grupos se GRUPO_ATIVO=on.
  if ((process.env.GRUPO_ATIVO || 'off') !== 'on') return;

  // Allowlist opcional: se GRUPOS_AUTORIZADOS estiver definido, só responde nesses grupos.
  const permitidos = (process.env.GRUPOS_AUTORIZADOS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (permitidos.length && !permitidos.includes(grupoJid)) return;

  const texto =
    dados.message?.conversation ||
    dados.message?.extendedTextMessage?.text ||
    (dados.message?.imageMessage ? dados.message.imageMessage.caption || '[imagem]' : null);
  if (!texto) return;

  const participante = (dados.key?.participant || '').split('@')[0];

  enfileirar(grupoJid, async () => {
    let autorNome = dados.pushName || participante;
    try {
      const u = await buscarUsuario(participante);
      if (u?.nome) autorNome = u.nome;
    } catch {}

    // Registra a fala no histórico do grupo (contexto para o juiz de boteco).
    console.log(`[grupo ${grupoJid}] ${autorNome}: ${texto.slice(0, 50)}`);
    await salvarMensagemGrupo(grupoJid, 'user', autorNome, texto);

    const t = texto.trim();
    const ehComando = t.startsWith('/');
    const mencionado = mencionaramOBot(dados, texto);

    let gatilho = null;
    let espontaneo = false;

    if (mencionado || ehComando) {
      gatilho = ehComando
        ? 'Te acionaram por comando no grupo. Se pedirem para julgar/resolver algo factual (placar, gol, tabela), aja como juiz de boteco e use a ferramenta de futebol. Responda direto.'
        : 'Te chamaram/mencionaram agora. Responda direto a quem falou.';
    } else {
      // Modo espontâneo: só passa pelo freio triplo (ligado + cooldown + sorteio).
      const ligado = (process.env.GRUPO_ESPONTANEO || 'on') !== 'off';
      const cooldownMin = Number(process.env.GRUPO_COOLDOWN_MIN || 45);
      const chance = Number(process.env.GRUPO_CHANCE || 0.1);
      const ultimo = ultimoEspontaneo.get(grupoJid) || 0;
      const passouCooldown = Date.now() - ultimo > cooldownMin * 60000;
      if (ligado && passouCooldown && Math.random() < chance) {
        espontaneo = true;
        gatilho =
          'Ninguém te chamou diretamente. Só entre na conversa se tiver algo CURTO e bom para somar (resolver uma dúvida, uma tirada com humor, um dado de futebol). Se não tiver nada que realmente valha, responda APENAS a palavra: PASSO';
      }
    }

    if (!gatilho) return; // não é hora de falar

    const historico = await historicoGrupo(grupoJid, 30);
    let resposta;
    try {
      resposta = await responderGrupo({ historico, gatilho });
    } catch (e) {
      console.error('Falha no grupo:', e?.message || e);
      return; // no grupo, silêncio é melhor que mensagem de erro
    }
    if (!resposta || resposta.trim().toUpperCase() === 'PASSO') return;

    if (espontaneo) ultimoEspontaneo.set(grupoJid, Date.now());
    await salvarMensagemGrupo(grupoJid, 'assistant', null, resposta);
    await enviarMensagem(grupoJid, resposta);
  });
}

// ---------- TAREFAS AGENDADAS ----------
function agendar(expressao, nome, campoAssinatura, gerador) {
  if (!expressao || expressao === 'off') {
    console.log(`Tarefa "${nome}" desativada.`);
    return;
  }
  cron.schedule(
    expressao,
    async () => {
      try {
        const assinantes = await listarAssinantes(campoAssinatura);
        if (assinantes.length === 0) return;
        console.log(`Gerando "${nome}" para ${assinantes.length} pessoas...`);
        const texto = await gerador();
        for (const a of assinantes) {
          await enviarMensagem(a.numero, texto);
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (e) {
        console.error(`Erro em "${nome}":`, e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "${nome}" agendada: ${expressao}`);
}

agendar(process.env.CRON_COPA || '0 9 * * *', 'Resenha do Doutor', 'recebe_copa', gerarResenhaDoDoutor);
agendar(process.env.CRON_NOTICIAS || '0 8 * * *', 'Comentário do dia', 'recebe_noticias', gerarComentarioDoDia);

// 💰 Relatório de custo diário para o admin (padrão 23h)
const CRON_CUSTO = process.env.CRON_CUSTO || '0 23 * * *';
if (CRON_CUSTO !== 'off') {
  cron.schedule(
    CRON_CUSTO,
    async () => {
      try {
        const [hoje, semana, total] = await Promise.all([
          custoDesde(inicioDoDiaISO()),
          custoDesde(inicioDaSemanaISO()),
          custoTotal(),
        ]);
        // envia o resumo para todos os admins
        const todos = await listarUsuarios();
        for (const u of todos) {
          const full = await buscarUsuario(u.numero);
          if (full?.admin) {
            await enviarMensagem(
              full.numero,
              `💰 *Resumo do dia* (estimativa)\nHoje: US$ ${hoje.toFixed(2)} · Semana: US$ ${semana.toFixed(2)} · Total: US$ ${total.toFixed(2)}\n_Não é a fatura real; é o acompanhamento por tokens._`
            );
          }
        }
      } catch (e) {
        console.error('Erro no relatório de custo:', e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Relatório de custo" agendada: ${CRON_CUSTO}`);
}

// 🎂 Aniversários: todo dia no horário configurado, parabeniza quem faz aniversário.
const CRON_ANIVERSARIO = process.env.CRON_ANIVERSARIO || '0 9 * * *';
if (CRON_ANIVERSARIO !== 'off') {
  cron.schedule(
    CRON_ANIVERSARIO,
    async () => {
      try {
        const lista = await aniversariantesDeHoje();
        if (lista.length === 0) return;
        console.log(`🎂 Aniversariantes hoje: ${lista.map((a) => a.nome || a.numero).join(', ')}`);
        for (const a of lista) {
          const msg = await gerarParabens(a.nome || 'amigo');
          await enviarMensagem(a.numero, msg);
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (e) {
        console.error('Erro na tarefa de aniversários:', e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Aniversários" agendada: ${CRON_ANIVERSARIO}`);
}

// ⚽ RADAR DE FUTEBOL — alerta de jogo (~1h antes) e pós-jogo automático.
function dataSP(offsetDias = 0) {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
}

// Pontuação do bolão: 10 (exato) · 7 (saldo certo) · 5 (acertou vencedor/empate) · 0 (errou).
function pontosPalpite(predCasa, predFora, realCasa, realFora) {
  if (predCasa === realCasa && predFora === realFora) return 10;
  const sp = Math.sign(predCasa - predFora);
  const sr = Math.sign(realCasa - realFora);
  if (sp === sr) return predCasa - predFora === realCasa - realFora ? 7 : 5;
  return 0;
}

function parsePlacar(str) {
  const m = (str || '').match(/(\d+)\s*[x×\-:]\s*(\d+)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function corrigirBolao(finalizados) {
  if (!finalizados.length) return;
  const pendentes = await palpitesPendentes();
  for (const p of pendentes) {
    const partes = (p.jogo || '').split(/\s*[x×]\s*/i);
    if (partes.length < 2) continue;
    const t1 = partes[0].trim();
    const t2 = partes[1].trim();
    const jogo = finalizados.find(
      (j) =>
        (mesmaSelecao(t1, j.casa) && mesmaSelecao(t2, j.fora)) ||
        (mesmaSelecao(t1, j.fora) && mesmaSelecao(t2, j.casa))
    );
    if (!jogo) continue;
    const placarReal = `${jogo.casa} ${jogo.golCasa}x${jogo.golFora} ${jogo.fora}`;
    const pred = parsePlacar(p.palpite);
    if (!pred) {
      await pontuarPalpite(p.id, 0, placarReal);
      continue;
    }
    let predCasa;
    let predFora;
    if (mesmaSelecao(t1, jogo.casa)) {
      predCasa = pred[0];
      predFora = pred[1];
    } else {
      predCasa = pred[1];
      predFora = pred[0];
    }
    const pts = pontosPalpite(predCasa, predFora, jogo.golCasa, jogo.golFora);
    await pontuarPalpite(p.id, pts, placarReal);
    console.log(`🎯 Bolão: ${p.jogo} = ${p.palpite} (real ${jogo.golCasa}x${jogo.golFora}) → ${pts}pts`);
  }
}

async function radarFutebol() {
  const selecoes = await listarSelecoes();
  if (!selecoes.length) return;
  const nomes = selecoes.map((s) => s.selecao).filter(Boolean);
  const acompanhada = (j) => nomes.some((n) => mesmaSelecao(n, j.casa) || mesmaSelecao(n, j.fora));

  const jogos = await listarJogosCopa({ dataInicio: dataSP(-1), dataFim: dataSP(1) });
  if (!jogos.length) return;
  const agora = Date.now();

  // Pontua o bolão com os jogos já encerrados (independe das seleções acompanhadas).
  const finalizados = jogos.filter((j) => j.status === 'FINISHED' && j.golCasa != null && j.golFora != null);
  await corrigirBolao(finalizados);

  for (const j of jogos) {
    if (!acompanhada(j)) continue;
    const inicio = new Date(j.utcDate).getTime();
    const minAte = (inicio - agora) / 60000;
    const minDesde = (agora - inicio) / 60000;

    // ALERTA — jogo começa em ~30 a 75 minutos
    if (['SCHEDULED', 'TIMED'].includes(j.status) && minAte > 30 && minAte <= 75) {
      if (!(await jaAvisou(j.id, 'alerta'))) {
        const hora = new Date(j.utcDate).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
        });
        const msg = `⚽ Daqui a pouco tem jogo da nossa Copa! *${j.casa} x ${j.fora}* começa às ${hora} (horário de Brasília). Já vai separando a cerveja que o Magrão tá de olho. 🍺`;
        const assinantes = await listarAssinantes('recebe_copa');
        console.log(`📣 Alerta: ${j.casa} x ${j.fora} → ${assinantes.length} pessoas`);
        for (const a of assinantes) {
          await enviarMensagem(a.numero, msg);
          await new Promise((r) => setTimeout(r, 2000));
        }
        await marcarAvisado(j.id, 'alerta');
      }
    }

    // PÓS-JOGO — terminou com placar e foi recente (até ~6h após o início)
    if (j.status === 'FINISHED' && j.golCasa != null && j.golFora != null && minDesde > 0 && minDesde <= 360) {
      if (!(await jaAvisou(j.id, 'posjogo'))) {
        console.log(`📝 Pós-jogo: ${j.casa} ${j.golCasa}x${j.golFora} ${j.fora}`);
        const texto = await gerarPosJogo(j);
        const assinantes = await listarAssinantes('recebe_copa');
        for (const a of assinantes) {
          await enviarMensagem(a.numero, texto);
          await new Promise((r) => setTimeout(r, 3000));
        }
        await marcarAvisado(j.id, 'posjogo');
      }
    }
  }
}

const CRON_RADAR = process.env.CRON_RADAR || '*/15 * * * *';
if (CRON_RADAR !== 'off') {
  cron.schedule(
    CRON_RADAR,
    () => radarFutebol().catch((e) => console.error('Erro no radar de futebol:', e?.message || e)),
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Radar de futebol" agendada: ${CRON_RADAR}`);
}

// ⏰ LEMBRETES — verifica a cada minuto e dispara os que chegaram a hora.
async function dispararLembretes() {
  const pendentes = await lembretesPendentes();
  for (const l of pendentes) {
    try {
      if (l.escopo === 'coletivo') {
        const todos = await listarUsuarios();
        const msg = `⏰ *Recado pra todos:* ${l.texto}`;
        for (const u of todos) {
          await enviarMensagem(u.numero, msg);
          await new Promise((r) => setTimeout(r, 1500));
        }
      } else if (l.numero) {
        await enviarMensagem(l.numero, `⏰ Ó, aquele lembrete que você me pediu: ${l.texto}`);
      }
      await marcarLembreteEnviado(l.id);
      console.log(`⏰ Lembrete disparado (${l.escopo}): ${l.texto.slice(0, 40)}`);
    } catch (e) {
      console.error('Erro ao disparar lembrete:', e?.message || e);
    }
  }
}

const CRON_LEMBRETES = process.env.CRON_LEMBRETES || '* * * * *';
if (CRON_LEMBRETES !== 'off') {
  cron.schedule(
    CRON_LEMBRETES,
    () => dispararLembretes().catch((e) => console.error('Erro nos lembretes:', e?.message || e)),
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Lembretes" agendada: ${CRON_LEMBRETES}`);
}

// 💬 PERGUNTA DA SEMANA — lança a pergunta (seg 10h) e manda a síntese ao admin (sex 18h).
const CRON_PERGUNTA = process.env.CRON_PERGUNTA || '0 10 * * 1';
if (CRON_PERGUNTA !== 'off') {
  cron.schedule(
    CRON_PERGUNTA,
    async () => {
      try {
        const assinantes = await listarAssinantes('recebe_copa');
        if (!assinantes.length) return;
        const texto = await gerarPerguntaSemana();
        await criarPergunta(texto.replace(/^💬\s*\*?PERGUNTA DA SEMANA\*?\s*/i, '').trim() || texto);
        console.log(`💬 Pergunta da semana lançada para ${assinantes.length} pessoas`);
        for (const a of assinantes) {
          await enviarMensagem(a.numero, texto);
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch (e) {
        console.error('Erro na pergunta da semana:', e?.message || e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Pergunta da semana" agendada: ${CRON_PERGUNTA}`);
}

const CRON_SINTESE = process.env.CRON_SINTESE || '0 18 * * 5';
if (CRON_SINTESE !== 'off') {
  cron.schedule(
    CRON_SINTESE,
    async () => {
      try {
        const p = await perguntaAtiva();
        if (!p) return;
        const respostas = await respostasDaPergunta(p.id);
        if (!respostas.length) return;
        const sintese = await gerarSintesePergunta(p.texto, respostas);
        const admins = await listarAdmins();
        const aviso = `🔎 *Síntese da pergunta da semana* (revise antes de soltar pra turma com /soltar-sintese)\n\n${sintese}`;
        for (const a of admins) {
          await enviarMensagem(a.numero, aviso);
          await new Promise((r) => setTimeout(r, 2000));
        }
        console.log(`💬 Síntese enviada para ${admins.length} admin(s) revisar`);
      } catch (e) {
        console.error('Erro na síntese da pergunta:', e?.message || e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "Síntese da pergunta" agendada: ${CRON_SINTESE}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sócrates v4.11.0 rodando na porta ${PORT} ⚽`));
