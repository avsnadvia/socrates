// src/dados.js — usuários, mensagens e memórias (multiusuário)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---------- USUÁRIOS ----------
export async function buscarUsuario(numero) {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('*')
    .eq('numero', numero)
    .maybeSingle();
  return data || null;
}

export async function adicionarUsuario(numero, nome) {
  const { error } = await supabase
    .from('socrates_usuarios')
    .insert({ numero, nome });
  return !error;
}

export async function removerUsuario(numero) {
  // remove memórias e mensagens antes (chaves estrangeiras)
  const u = await buscarUsuario(numero);
  if (!u) return false;
  await supabase.from('socrates_memorias').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_mensagens').delete().eq('usuario_id', u.id);
  await supabase.from('socrates_usuarios').delete().eq('id', u.id);
  return true;
}

export async function listarUsuarios() {
  const { data } = await supabase
    .from('socrates_usuarios')
    .select('numero, nome, modo, recebe_copa, recebe_noticias')
    .order('criado_em');
  return data || [];
}

// Assinantes de um canal: 'recebe_copa' ou 'recebe_noticias'
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

// ---------- MENSAGENS ----------
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

// ---------- MEMÓRIAS ----------
export async function salvarMemoria(usuarioId, categoria, conteudo) {
  await supabase
    .from('socrates_memorias')
    .insert({ usuario_id: usuarioId, categoria, conteudo });
}

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
