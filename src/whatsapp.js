// src/whatsapp.js — envio de mensagens via Evolution API
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'socrates';

export async function enviarMensagem(numero, texto) {
  try {
    const res = await fetch(
      `${EVOLUTION_URL}/message/sendText/${INSTANCE}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: EVOLUTION_APIKEY,
        },
        body: JSON.stringify({
          number: numero,
          text: texto,
        }),
      }
    );
    if (!res.ok) {
      const corpo = await res.text();
      console.error('Erro Evolution:', res.status, corpo);
    }
  } catch (e) {
    console.error('Falha ao enviar mensagem:', e.message);
  }
}
