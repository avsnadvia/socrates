// src/whatsapp.js — envio de mensagens via Evolution API
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'socrates';

// Baixa uma mídia recebida (imagem/áudio) como base64, via Evolution API.
export async function baixarMidiaBase64(messageId) {
  try {
    const res = await fetch(
      `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${INSTANCE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_APIKEY },
        body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
      }
    );
    if (!res.ok) {
      console.error('Erro ao baixar mídia:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    if (!data?.base64) return null;
    return { mimetype: data.mimetype || 'image/jpeg', base64: data.base64 };
  } catch (e) {
    console.error('Falha ao baixar mídia:', e.message);
    return null;
  }
}

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
