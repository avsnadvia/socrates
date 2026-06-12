// src/index.js — Sócrates v2: multiusuário, comandos e comentário do dia
import express from 'express';
import cron from 'node-cron';
import { responder, gerarComentarioDoDia, gerarResenhaDoDoutor } from './claude.js';
import {
  buscarUsuario,
  adicionarUsuario,
  removerUsuario,
  listarUsuarios,
  listarAssinantes,
  atualizarUsuario,
  salvarMensagem,
  buscarHistorico,
  contarMensagens,
} from './dados.js';
import { enviarMensagem } from './whatsapp.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

// Fila por usuário: conversas de pessoas diferentes rodam em paralelo,
// mas mensagens da MESMA pessoa são processadas em ordem.
const filas = new Map();
function enfileirar(numero, tarefa) {
  const anterior = filas.get(numero) || Promise.resolve();
  const proxima = anterior.then(tarefa).catch((e) => console.error(e));
  filas.set(numero, proxima);
}

// ---------- COMANDOS ----------
async function tratarComando(usuario, texto) {
  const t = texto.trim().toLowerCase();

  // Comandos de qualquer usuário autorizado
  if (t === '/profundo') {
    await atualizarUsuario(usuario.id, { modo: 'profundo' });
    return '🧠 Modo profundo ligado. Agora penso com mais calma (e custo um pouco mais pro Rodrigo, hein). Use /normal pra voltar.';
  }
  if (t === '/normal') {
    await atualizarUsuario(usuario.id, { modo: 'normal' });
    return 'Modo normal de volta. Leve como uma resenha de bar. ⚽';
  }
  if (t === '/resenha on' || t === '/copa on') {
    await atualizarUsuario(usuario.id, { recebe_copa: true });
    return 'Bola rolando: todo dia às 9h chega a minha Resenha do Doutor. ⚽';
  }
  if (t === '/resenha off' || t === '/copa off') {
    await atualizarUsuario(usuario.id, { recebe_copa: false });
    return 'Entendido, sem Resenha. Mas se o Brasil chegar na final, eu volto a gritar aqui. ⚽😄';
  }
  if (t === '/noticias on') {
    await atualizarUsuario(usuario.id, { recebe_noticias: true });
    return 'Combinado: todo dia te mando meu comentário das notícias do Brasil e do mundo. 📰';
  }
  if (t === '/noticias off') {
    await atualizarUsuario(usuario.id, { recebe_noticias: false });
    return 'Sem problema, paro com o noticiário. Quando quiser saber do mundo, é só perguntar.';
  }
  if (t === '/ajuda') {
    return (
      'Comandos:\n' +
      '/profundo — conversas mais densas\n' +
      '/normal — modo padrão\n' +
      '/resenha on|off — Resenha do Doutor diária (9h)\n' +
      '/noticias on|off — comentário de notícias gerais (8h)\n' +
      (usuario.admin
        ? '\nAdmin:\n/add 55DDDNUMERO Nome\n/remover 55DDDNUMERO\n/usuarios'
        : '')
    );
  }

  // Comandos só do admin (Rodrigo)
  if (usuario.admin) {
    if (t.startsWith('/add ')) {
      const partes = texto.trim().split(/\s+/); // /add 5516... Nome Sobrenome
      const numero = (partes[1] || '').replace(/\D/g, '');
      const nome = partes.slice(2).join(' ') || null;
      if (!numero) return 'Formato: /add 5516991234567 Nome';
      const ok = await adicionarUsuario(numero, nome);
      return ok
        ? `✅ ${nome || numero} entrou pro círculo. Quando mandar a primeira mensagem, faço as honras.`
        : 'Esse número já está cadastrado (ou deu erro).';
    }
    if (t.startsWith('/remover ')) {
      const numero = texto.trim().split(/\s+/)[1]?.replace(/\D/g, '');
      const ok = await removerUsuario(numero);
      return ok ? '✅ Removido (com histórico e memórias apagados).' : 'Número não encontrado.';
    }
    if (t === '/usuarios') {
      const lista = await listarUsuarios();
      return (
        `👥 ${lista.length} no círculo:\n` +
        lista
          .map(
            (u) =>
              `• ${u.nome || u.numero} (${u.modo}${u.recebe_copa ? ' ⚽' : ''}${u.recebe_noticias ? ' 📰' : ''})`
          )
          .join('\n')
      );
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
  if (remoteJid.endsWith('@g.us')) return; // ignora grupos
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
      return; // círculo fechado: silêncio para desconhecidos
    }

    console.log(`Msg de ${usuario.nome || numero}: ${texto.slice(0, 60)}`);

    // Comando?
    const respostaComando = await tratarComando(usuario, texto);
    if (respostaComando) {
      await enviarMensagem(numero, respostaComando);
      return;
    }

    // Conversa normal
    const primeiroContato = (await contarMensagens(usuario.id)) === 0;
    await salvarMensagem(usuario.id, 'user', texto);
    const historico = await buscarHistorico(usuario.id, 30);
    const resposta = await responder(usuario, historico, primeiroContato);
    await salvarMensagem(usuario.id, 'assistant', resposta);
    await enviarMensagem(numero, resposta);
  });
});

app.get('/', (_req, res) => res.send('Sócrates no ar ⚽🧠'));

// ---------- TAREFAS AGENDADAS ----------
// Helper: só agenda se a variável existir e não for "off"
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
          await new Promise((r) => setTimeout(r, 3000)); // pausa anti-bloqueio
        }
      } catch (e) {
        console.error(`Erro em "${nome}":`, e);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );
  console.log(`Tarefa "${nome}" agendada: ${expressao}`);
}

// ⚽ Giro da Copa (padrão: 9h, todos os dias durante o torneio)
agendar(process.env.CRON_COPA || '0 9 * * *', 'Resenha do Doutor', 'recebe_copa', gerarResenhaDoDoutor);

// 📰 Notícias gerais (8h) — só recebe quem ativou com /noticias on
agendar(process.env.CRON_NOTICIAS || '0 8 * * *', 'Comentário do dia', 'recebe_noticias', gerarComentarioDoDia);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sócrates rodando na porta ${PORT}`));
