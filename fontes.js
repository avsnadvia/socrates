// src/fontes.js — fontes externas do Sócrates: futebol, notícias, clima.
// Cada função consulta uma API e devolve um RESUMO em texto (não o JSON cru),
// para o Doutor usar pouco token. Node 22 já tem fetch nativo.

// ===================== FUTEBOL — football-data.org =====================
// Códigos úteis de competição: WC (Copa do Mundo), CL (Champions),
// BSA (Brasileirão), PL (Premier League), PD (La Liga), SA (Serie A),
// BL1 (Bundesliga), FL1 (Ligue 1), EC (Eurocopa).
export async function consultarFutebol({ tipo, competicao, status }) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return 'Fonte de futebol não configurada.';
  const base = 'https://api.football-data.org/v4';
  const url =
    tipo === 'tabela'
      ? `${base}/competitions/${competicao}/standings`
      : `${base}/competitions/${competicao}/matches${status ? `?status=${status}` : ''}`;
  try {
    const r = await fetch(url, { headers: { 'X-Auth-Token': key } });
    if (!r.ok) return `Não consegui consultar o futebol agora (HTTP ${r.status}).`;
    const data = await r.json();
    return tipo === 'tabela' ? resumirTabela(data) : resumirJogos(data);
  } catch {
    return 'Erro ao consultar a fonte de futebol.';
  }
}

function resumirJogos(data) {
  const ms = (data.matches || []).slice(0, 18);
  if (ms.length === 0) return 'Nenhum jogo encontrado para esse filtro.';
  const linhas = ms.map((m) => {
    const casa = m.homeTeam?.name || '?';
    const fora = m.awayTeam?.name || '?';
    const g1 = m.score?.fullTime?.home;
    const g2 = m.score?.fullTime?.away;
    const placar = g1 != null && g2 != null ? `${g1}x${g2}` : 'x';
    const quando = m.utcDate
      ? new Date(m.utcDate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    const st = { SCHEDULED: 'agendado', TIMED: 'agendado', LIVE: 'AO VIVO', IN_PLAY: 'AO VIVO', PAUSED: 'intervalo', FINISHED: 'encerrado' }[m.status] || m.status;
    return `- ${casa} ${placar} ${fora} (${st}, ${quando})`;
  });
  return `Jogos:\n${linhas.join('\n')}`;
}

function resumirTabela(data) {
  const tabelas = data.standings || [];
  const partes = [];
  for (const t of tabelas.slice(0, 8)) {
    const grupo = t.group || t.stage || 'Classificação';
    const linhas = (t.table || []).slice(0, 6).map((row) =>
      `  ${row.position}. ${row.team?.name} — ${row.points}pts (${row.playedGames}j)`
    );
    if (linhas.length) partes.push(`${grupo}:\n${linhas.join('\n')}`);
  }
  return partes.length ? partes.join('\n') : 'Tabela não disponível.';
}

// ===================== NOTÍCIAS — GNews =====================
export async function consultarNoticias({ busca, idioma = 'pt' }) {
  const key = process.env.GNEWS_KEY;
  if (!key) return 'Fonte de notícias não configurada.';
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(busca)}&lang=${idioma}&max=5&apikey=${key}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return `Não consegui buscar notícias agora (HTTP ${r.status}).`;
    const data = await r.json();
    const arts = (data.articles || []).slice(0, 5);
    if (arts.length === 0) return 'Nenhuma notícia encontrada sobre isso.';
    return (
      'Manchetes:\n' +
      arts.map((a) => `- ${a.title} (${a.source?.name || 'fonte'})`).join('\n')
    );
  } catch {
    return 'Erro ao consultar a fonte de notícias.';
  }
}

// ===================== CLIMA — Open-Meteo (sem chave) =====================
export async function consultarClima({ cidade }) {
  if (!cidade) return 'Preciso do nome da cidade.';
  try {
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&format=json`
    );
    const gd = await g.json();
    const loc = gd.results?.[0];
    if (!loc) return `Não encontrei a cidade "${cidade}".`;
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo&forecast_days=1`
    );
    const wd = await w.json();
    const c = wd.current || {};
    const d = wd.daily || {};
    const desc = descricaoTempo(c.weather_code);
    return `Clima em ${loc.name}${loc.admin1 ? `/${loc.admin1}` : ''}: ${desc}, ${Math.round(c.temperature_2m)}°C agora (umidade ${c.relative_humidity_2m}%, vento ${Math.round(c.wind_speed_10m)} km/h). Hoje: mín ${Math.round(d.temperature_2m_min?.[0])}°C, máx ${Math.round(d.temperature_2m_max?.[0])}°C.`;
  } catch {
    return 'Erro ao consultar a previsão do tempo.';
  }
}

function descricaoTempo(code) {
  const mapa = {
    0: 'céu limpo', 1: 'predomínio de sol', 2: 'parcialmente nublado', 3: 'nublado',
    45: 'névoa', 48: 'névoa com geada', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte',
    61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 71: 'neve fraca', 73: 'neve', 75: 'neve forte',
    80: 'pancadas de chuva', 81: 'pancadas de chuva', 82: 'pancadas fortes de chuva',
    95: 'tempestade', 96: 'tempestade com granizo', 99: 'tempestade forte com granizo',
  };
  return mapa[code] || 'tempo variável';
}

// ===================== DEFINIÇÕES DAS FERRAMENTAS (para o modelo) =====================
const DEF_FUTEBOL = {
  name: 'futebol',
  description:
    'Consulta dados REAIS de futebol (placares, classificação/tabela, jogos agendados) via football-data.org. Use para resultados, tabela de grupos da Copa do Mundo, próximos jogos. Prefira esta ferramenta à busca web para placar e tabela.',
  input_schema: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: ['jogos', 'tabela'], description: 'jogos = partidas (placar/agenda); tabela = classificação' },
      competicao: { type: 'string', description: 'Código: WC (Copa do Mundo), CL (Champions), BSA (Brasileirão), PL, PD (La Liga), SA, BL1, FL1, EC' },
      status: { type: 'string', description: 'Opcional, só para jogos: SCHEDULED, LIVE, FINISHED' },
    },
    required: ['tipo', 'competicao'],
  },
};

const DEF_NOTICIAS = {
  name: 'noticias',
  description: 'Busca manchetes de notícias atuais via GNews. Use quando pedirem notícias sobre um tema específico.',
  input_schema: {
    type: 'object',
    properties: {
      busca: { type: 'string', description: 'Tema ou palavra-chave' },
      idioma: { type: 'string', description: 'Código do idioma (padrão pt)' },
    },
    required: ['busca'],
  },
};

const DEF_CLIMA = {
  name: 'clima',
  description: 'Consulta a previsão do tempo atual de uma cidade via Open-Meteo. Use quando perguntarem sobre clima/tempo.',
  input_schema: {
    type: 'object',
    properties: {
      cidade: { type: 'string', description: 'Nome da cidade, ex: Ribeirão Preto' },
    },
    required: ['cidade'],
  },
};

// Só oferece a ferramenta se a chave existir (clima não precisa de chave)
export function ferramentasCustom() {
  const t = [];
  if (process.env.FOOTBALL_DATA_KEY) t.push(DEF_FUTEBOL);
  if (process.env.GNEWS_KEY) t.push(DEF_NOTICIAS);
  t.push(DEF_CLIMA);
  return t;
}

// Executa a ferramenta que o modelo pediu
export async function executarFerramenta(nome, input) {
  try {
    if (nome === 'futebol') return await consultarFutebol(input);
    if (nome === 'noticias') return await consultarNoticias(input);
    if (nome === 'clima') return await consultarClima(input);
    return 'Ferramenta desconhecida.';
  } catch {
    return 'Não consegui consultar essa fonte agora.';
  }
}
