// src/fallback.js — Plano B do Sócrates: provedor reserva quando a Anthropic cai.
// Usa um endpoint COMPATÍVEL COM OPENAI. Por padrão, Google Gemini (tier grátis).
// Só entra em ação quando a Anthropic esgota as tentativas. Sem ferramentas: só texto,
// mantendo a MESMA personalidade (o prompt do sistema é o mesmo).

const FALLBACK_URL =
  process.env.FALLBACK_URL ||
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || 'gemini-3.5-flash';

export function temFallback() {
  return !!process.env.FALLBACK_API_KEY;
}

function textoDoSistema(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map((b) => b.text || '').join('\n\n');
  return '';
}

// Converte o formato de mensagens da Anthropic para o formato OpenAI (texto simples).
function normalizarMensagens(messages) {
  return messages
    .map((m) => {
      let conteudo = '';
      if (typeof m.content === 'string') conteudo = m.content;
      else if (Array.isArray(m.content))
        conteudo = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: conteudo };
    })
    .filter((m) => m.content);
}

async function chamarGemini(key, msgs, tokens, reasoning) {
  const body = { model: FALLBACK_MODEL, messages: msgs, max_tokens: tokens };
  if (reasoning) body.reasoning_effort = reasoning; // controla o "pensamento" (none/low/medium/high)
  const r = await fetch(FALLBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Plano B HTTP ${r.status}: ${t.slice(0, 150)}`);
  }
  const data = await r.json();
  const msg = data.choices?.[0]?.message;
  let texto = '';
  if (msg) {
    if (typeof msg.content === 'string') texto = msg.content;
    else if (Array.isArray(msg.content))
      texto = msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('');
  }
  return texto.trim();
}

export async function responderFallback({ system, messages, max_tokens = 1024 }) {
  const key = process.env.FALLBACK_API_KEY;
  if (!key) throw new Error('Plano B não configurado (sem FALLBACK_API_KEY).');

  const msgs = [
    { role: 'system', content: textoDoSistema(system) },
    ...normalizarMensagens(messages),
  ];

  // Modelos "thinking" (Gemini) podem gastar todo o orçamento pensando e devolver
  // conteúdo VAZIO. Estratégia em camadas: pensamento baixo → desligado → sem o
  // parâmetro (caso o endpoint não o aceite), sempre com folga de tokens.
  const tokens = Math.max(max_tokens, 2048);
  let texto = '';

  try {
    texto = await chamarGemini(key, msgs, tokens, 'low');
  } catch (e) {
    console.warn('Plano B (pensamento baixo) falhou:', e.message);
  }
  if (!texto) {
    try {
      texto = await chamarGemini(key, msgs, Math.max(tokens, 3072), 'none');
    } catch (e) {
      console.warn('Plano B (sem pensamento) falhou:', e.message);
    }
  }
  if (!texto) {
    try {
      texto = await chamarGemini(key, msgs, 3072, null);
    } catch (e) {
      console.warn('Plano B (simples) falhou:', e.message);
    }
  }

  if (!texto) throw new Error('Plano B devolveu resposta vazia.');
  return texto;
}
