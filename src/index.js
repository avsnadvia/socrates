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
} from './dados.js';
import { enviarMensagem } from './whatsapp.js';

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
      '🏆 /acompanhar Croácia — sigo uma seleção sua de perto\n' +
      '📬 /recado NUMERO | texto — mando um recado seu pra outro do círculo\n' +
      '🧹 /esquecer — apago o que sei de você\n\n' +
      '_Mas o melhor é não usar comando nenhum: só me manda o que tá pensando._';
    if (usuario.admin) {
      ajuda +=
        '\n\n*Admin:*\n' +
        '/add NUMERO Nome | característica\n' +
        '/remover NUMERO\n' +
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
  if (remoteJid.endsWith('@g.us')) return;
  const numero = remoteJid.split('@')[0];

  const texto =
    dados.message?.conversation ||
    dados.message?.extendedTextMessage?.text ||
    null;
  if (!texto) return;

  enfileirar(numero, async () => {
    const usuario = await buscarUsuario(numero);
    if (!usuario) {
      console.log(`Número não autorizado ignorado: ${numero}`);
      return;
    }

    console.log(`Msg de ${usuario.nome || numero}: ${texto.slice(0, 60)}`);

    const respostaComando = await tratarComando(usuario, texto);
    if (respostaComando) {
      await enviarMensagem(numero, respostaComando);
      return;
    }

    const totalMensagens = await contarMensagens(usuario.id);
    await salvarMensagem(usuario.id, 'user', texto);
    const historico = await buscarHistorico(usuario.id, 30);
    let resposta;
    try {
      resposta = await responder(usuario, historico, totalMensagens);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sócrates v4.6.0 rodando na porta ${PORT} ⚽`));
