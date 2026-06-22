// src/dados.js — v4: usuários, mensagens, memórias (com origem),
// diário de relacionamento, bolão, seleções, custo e correio.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ===================== USUÁRIOS =====================
export async function buscarUsuario(numero) {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('*')
    .eq('numero', numero)
    .maybeSingle();
  return data || null;
}

export async function buscarUsuarioPorId(id) {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function adicionarUsuario(numero, nome, caracteristica) {
  const { error } = await supabase
    .from('socrates_usuarios')
    .insert({ numero, nome, caracteristica });
  return !error;
}

export async function removerUsuario(numero) {
  const u = await buscarUsuario(numero);
  if (!u) return false;
  await supabase.from('socrates_memorias').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_mensagens').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_palpites').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_selecao_usuario').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_relacao').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_recados').delete().eq('de_usuario_id', u.id);
  await supabase.from('socrates_usuarios').delete().eq('id', u.id);
  return true;
}

export async function listarUsuarios() {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('id, numero, nome, modo, recebe_copa, recebe_noticias')
    .order('criado_em');
  return data || [];
}

export async function listarAssinantes(campo) {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('numero, nome')
    .eq(campo, true);
  return data || [];
}

export async function atualizarUsuario(id, campos) {
  await supabase.from('socrates_usuarios').update(campos).eq('id', id);
}

// Aniversariantes de hoje (campo aniversario no formato MM-DD).
export async function aniversariantesDeHoje() {
  const [dd, mm] = new Date()
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
    .split('/');
  const mmdd = `${mm}-${dd}`;
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('id, numero, nome')
    .eq('aniversario', mmdd);
  return data || [];
}

// ===================== RADAR DE FUTEBOL (anti-duplicata) =====================
export async function jaAvisou(matchId, tipo) {
  const { data } = await supabase
    .from('socrates_jogos_avisados')
    .select('match_id')
    .eq('match_id', matchId)
    .eq('tipo', tipo)
    .maybeSingle();
  return !!data;
}

export async function marcarAvisado(matchId, tipo) {
  await supabase.from('socrates_jogos_avisados').insert({ match_id: matchId, tipo });
}

// ===================== GRUPO (modo mediador/participante) =====================
export async function salvarMensagemGrupo(grupoJid, papel, autor, conteudo) {
  await supabase
    .from('socrates_grupo_mensagens')
    .insert({ grupo_jid: grupoJid, papel, autor, conteudo });
}

export async function historicoGrupo(grupoJid, limite = 30) {
  const { data } = await supabase
    .from('socrates_grupo_mensagens')
    .select('papel, autor, conteudo')
    .eq('grupo_jid', grupoJid)
    .order('criado_em', { ascending: false })
    .limit(limite);
  return (data || []).reverse();
}

// ===================== MENSAGENS =====================
export async function salvarMensagem(usuarioId, papel, conteudo) {
  await supabase
    .from('socrates_mensagens')
    .insert({ usuario_id: usuarioId, papel, conteudo });
}

export async function buscarHistorico(usuarioId, limite = 30) {
  const { data } = await supabase
    .from('socrates_mensagens')
    .select('papel, conteudo')
    .eq('usuario_id', usuarioId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  return (data || []).reverse();
}

export async function contarMensagens(usuarioId) {
  const { count } = await supabase
    .from('socrates_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId);
  return count || 0;
}

// ===================== MEMÓRIAS (com origem) =====================
// origem: 'privado' (cofre, padrão) | 'coletivo' (nasceu público)
export async function salvarMemoria(usuarioId, categoria, conteudo, origem = 'privado') {
  await supabase
    .from('socrates_memorias')
    .insert({ usuario_id: usuarioId, categoria, conteudo, origem });
}

// Memórias DESTA pessoa, para usar AO FALAR COM ELA (privado + coletivo).
// Proteção de fronteira é estrutural: ao falar com A, o código só busca
// memórias de A — nunca de B. Cross-leak é impossível no contexto.
export async function buscarMemorias(usuarioId) {
  const { data } = await supabase
    .from('socrates_memorias')
    .select('categoria, conteudo')
    .eq('usuario_id', usuarioId)
    .order('criado_em');
  if (!data || data.length === 0)
    return 'Nenhuma memória ainda — provavelmente é o primeiro contato.';
  return data.map((m) => `- [${m.categoria}] ${m.conteudo}`).join('\n');
}

// ===================== DIÁRIO DE RELACIONAMENTO =====================
export async function buscarRelacao(usuarioId) {
  const { data } = await supabase
    .from('socrates_relacao')
    .select('*')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  return data || null;
}

export async function atualizarRelacao(usuarioId, campos) {
  const existe = await buscarRelacao(usuarioId);
  if (existe) {
    await supabase
      .from('socrates_relacao')
      .update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('usuario_id', usuarioId);
  } else {
    await supabase
      .from('socrates_relacao')
      .insert({ usuario_id: usuarioId, ...campos });
  }
}

export async function marcarConversa(usuarioId) {
  await atualizarRelacao(usuarioId, { ultima_conversa: new Date().toISOString() });
}

// ===================== BOLÃO =====================
export async function registrarPalpite(usuarioId, jogo, palpite, dataJogo = null) {
  await supabase.from('socrates_palpites').insert({
    usuario_id: usuarioId,
    jogo,
    palpite,
    data_jogo: dataJogo,
  });
}

// Palpites de um jogo, com o nome de cada um — para o ranking.
// Dado COLETIVO por natureza (a pessoa palpita sabendo do ranking).
export async function palpitesDoJogo(jogo) {
  const { data } = await supabase
    .from('socrates_palpites')
    .select('palpite, criado_em, socrates_usuarios(nome)')
    .ilike('jogo', `%${jogo}%`)
    .order('criado_em');
  return (data || []).map((p) => ({
    nome: p.socrates_usuarios?.nome || 'alguém',
    palpite: p.palpite,
  }));
}

// Palpites ainda não corrigidos (para o radar pontuar quando o jogo terminar).
export async function palpitesPendentes() {
  const { data } = await supabase
    .from('socrates_palpites')
    .select('id, usuario_id, jogo, palpite')
    .or('corrigido.is.null,corrigido.eq.false');
  return data || [];
}

export async function pontuarPalpite(id, pontos, placarReal) {
  await supabase
    .from('socrates_palpites')
    .update({ pontos, corrigido: true, placar_real: placarReal })
    .eq('id', id);
}

export async function rankingBolao() {
  const { data } = await supabase
    .from('socrates_palpites')
    .select('pontos, socrates_usuarios(nome)')
    .eq('corrigido', true);
  const mapa = {};
  for (const p of data || []) {
    const nome = p.socrates_usuarios?.nome || 'alguém';
    if (!mapa[nome]) mapa[nome] = { nome, pontos: 0, jogos: 0 };
    mapa[nome].pontos += p.pontos || 0;
    mapa[nome].jogos += 1;
  }
  return Object.values(mapa).sort((a, b) => b.pontos - a.pontos);
}

// ===================== SELEÇÕES =====================
export async function listarSelecoes() {
  const { data } = await supabase
    .from('socrates_selecoes')
    .select('selecao, nivel')
    .order('nivel');
  return data || [];
}

export async function selecoesDoUsuario(usuarioId) {
  const { data } = await supabase
    .from('socrates_selecao_usuario')
    .select('selecao')
    .eq('usuario_id', usuarioId);
  return (data || []).map((s) => s.selecao);
}

export async function adicionarSelecaoUsuario(usuarioId, selecao) {
  await supabase
    .from('socrates_selecao_usuario')
    .insert({ usuario_id: usuarioId, selecao })
    .then(() => {}, () => {});
}

// ===================== CUSTO (estimativa por tokens) =====================
// Preços por MILHÃO de tokens (tabela pública Anthropic). Estimativa.
const PRECOS = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

export function calcularCustoUSD(modelo, usage) {
  const p = PRECOS[modelo] || PRECOS['claude-sonnet-4-6'];
  const tin = usage?.input_tokens || 0;
  const tout = usage?.output_tokens || 0;
  const cacheRead = usage?.cache_read_input_tokens || 0;
  const cacheWrite = usage?.cache_creation_input_tokens || 0;
  const custo =
    (tin / 1e6) * p.in +
    (tout / 1e6) * p.out +
    (cacheRead / 1e6) * p.in * 0.1 +
    (cacheWrite / 1e6) * p.in * 1.25;
  return { custo, tin: tin + cacheRead + cacheWrite, tout };
}

export async function registrarUso(usuarioId, modelo, usage, contexto) {
  const { custo, tin, tout } = calcularCustoUSD(modelo, usage);
  await supabase.from('socrates_uso').insert({
    usuario_id: usuarioId,
    modelo,
    tokens_in: tin,
    tokens_out: tout,
    custo_usd: Number(custo.toFixed(5)),
    contexto,
  });
  return custo;
}

export async function custoDesde(isoDate) {
  const { data } = await supabase
    .from('socrates_uso')
    .select('custo_usd')
    .gte('criado_em', isoDate);
  return (data || []).reduce((s, r) => s + Number(r.custo_usd), 0);
}

export async function custoTotal() {
  const { data } = await supabase.from('socrates_uso').select('custo_usd');
  return (data || []).reduce((s, r) => s + Number(r.custo_usd), 0);
}

// ===================== PAINEL =====================
export async function dadosPainel() {
  const usuarios = await listarUsuarios();
  const resultado = [];
  for (const u of usuarios) {
    const { count } = await supabase
      .from('socrates_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', u.id)
      .eq('papel', 'user');
    resultado.push({ nome: u.nome || u.numero, mensagens: count || 0 });
  }
  return resultado;
}

// ===================== CORREIO DO MAGRÃO =====================
export async function registrarRecado(deUsuarioId, paraNumero, conteudo) {
  await supabase.from('socrates_recados').insert({
    de_usuario_id: deUsuarioId,
    para_numero: paraNumero,
    conteudo,
  });
}

// /esquecer: limpa memórias, histórico e diário. Mantém no círculo.
export async function esquecerUsuario(usuarioId) {
  await supabase.from('socrates_memorias').delete().eq('usuario_id', usuarioId);
  await supabase.from('socrates_mensagens').delete().eq('usuario_id', usuarioId);
  await supabase.from('socrates_relacao').delete().eq('usuario_id', usuarioId);
}

// ===================== LEMBRETES =====================
export async function criarLembrete({ usuarioId, numero, escopo, texto, dispararEm }) {
  await supabase.from('socrates_lembretes').insert({
    usuario_id: usuarioId,
    numero,
    escopo: escopo || 'pessoal',
    texto,
    disparar_em: dispararEm,
  });
}

export async function lembretesPendentes() {
  const { data } = await supabase
    .from('socrates_lembretes')
    .select('id, numero, escopo, texto')
    .eq('enviado', false)
    .lte('disparar_em', new Date().toISOString());
  return data || [];
}

export async function marcarLembreteEnviado(id) {
  await supabase.from('socrates_lembretes').update({ enviado: true }).eq('id', id);
}

export async function listarAdmins() {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('numero, nome')
    .eq('admin', true);
  return data || [];
}

// ===================== PERGUNTA DA SEMANA =====================
export async function criarPergunta(texto) {
  await supabase.from('socrates_pergunta').update({ ativa: false }).eq('ativa', true);
  const { data } = await supabase
    .from('socrates_pergunta')
    .insert({ texto, ativa: true })
    .select('id, texto')
    .single();
  return data;
}

export async function perguntaAtiva() {
  const { data } = await supabase
    .from('socrates_pergunta')
    .select('id, texto')
    .eq('ativa', true)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function salvarRespostaPergunta(perguntaId, usuarioId, resposta) {
  await supabase
    .from('socrates_pergunta_respostas')
    .delete()
    .eq('pergunta_id', perguntaId)
    .eq('usuario_id', usuarioId);
  await supabase
    .from('socrates_pergunta_respostas')
    .insert({ pergunta_id: perguntaId, usuario_id: usuarioId, resposta });
}

export async function respostasDaPergunta(perguntaId) {
  const { data } = await supabase
    .from('socrates_pergunta_respostas')
    .select('resposta')
    .eq('pergunta_id', perguntaId);
  return (data || []).map((r) => r.resposta);
}
