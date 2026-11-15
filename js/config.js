// Constantes da plataforma. Nada aqui é segredo: o client_id OAuth é público por natureza.

export const CLIENT_ID = '262963421281-10ojh3kr71geqvmd73jv5978qib9h0b7.apps.googleusercontent.com';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

// Comparação sempre em minúsculas.
export const ALLOWED = ['robertta.c.alonso@gmail.com', 'gabrielgomesdeoliveira17@gmail.com'];

// E-mail → primeiro nome usado na saudação.
export const NOMES = {
  'robertta.c.alonso@gmail.com': 'Robertta',
  'gabrielgomesdeoliveira17@gmail.com': 'Gabriel',
};

export const ROOT_FOLDER = '1MlsVb3L2_ZqpYWqY6DSjkcVH-V-sqjwI'; // "Motor de Conteúdo"
export const REVISAO_FOLDER = '1shgllr5h7S-tVqJ86bJd-ZuwCSQjk6KX'; // 4-Revisao

// Demais subpastas resolvidas pelo nome dentro de ROOT_FOLDER.
export const PASTAS = {
  base: '0-Base',
  radar: '1-Radar',
  roteiros: '2-Roteiros',
  brutos: '3-Brutos',
  prontos: '5-Prontos',
  motor: '_motor',
};

export const RADAR_SHEET = '1CcMx96g4qLcvzbWLX1qBv4SwPNJ8bdYEhYC7Ng2-D9c';

export const TIMEZONE = 'America/Sao_Paulo';

// Tempo de vida do cache de listagens (ms).
export const CACHE_MS = 60 * 1000;

export const GIS_URL = 'https://accounts.google.com/gsi/client';
export const SHEETJS_URL = './vendor/xlsx.full.min.js'; // relativo ao documento (index.html)

/* ------------------------------------------------------------------ app
   O que muda de um ambiente para outro e as regras do fluxo. As datas ("hoje", semana) vêm
   sempre do relógio real no fuso TIMEZONE (js/parse.js: hojeISO, prefixoSemana, semanaIso). */

export const CONFIG = {
  pastaRaiz: 'Motor de Conteúdo',
  // Nomes das pastas como aparecem no Drive (para textos e caminhos; os ids vêm de drive.pastas()).
  pastas: { base: '0-Base', radar: '1-Radar', roteiros: '2-Roteiros', brutos: '3-Brutos', revisao: '4-Revisao', prontos: '5-Prontos' },
  planilha: 'Radar',
  abas: { selecao: 'Seleção', decisoes: 'Decisões', desempenho: 'Desempenho', execucoes: 'Execuções', candidatos: 'Candidatos' },
  vencedorMultiplo: 3, // vencedor = visualizações >= 3x a mediana da conta na rede
  pedacoEnvioMB: 8, // tamanho de cada pedaço do envio (múltiplo de 256 KB no Drive)
  concorrencia: 4, // downloads de roteiro ao mesmo tempo
};

/* --------------------------------------------------- controle manual
   O que o app grava e dispara. `ponte` liga o disparo pela ponte no Apps Script (PONTE_URL é o
   endereço público do app da web; as chaves dos webhooks ficam só nas propriedades do script,
   nunca aqui). Com a ponte desligada ou sem endereço, Integra.ponte.* responde
   "O disparo pelo app ainda não está ligado." */

export const FLAGS = { ponte: true, decisoesPeloApp: true, revisaoPeloApp: true, central: true };

/* Central (Supabase, região São Paulo): pedidos ao motor em segundos (js/central.js). A URL e a chave
   pública não são segredo: quem pode o quê fica nas regras do banco (RLS). Sem sessão na central ou com
   o motor sem ouvir, o app grava os pedidos no Drive como antes. */
export const CENTRAL = {
  url: 'https://jlknjytaiyjqmgfpsntb.supabase.co',
  chave: 'sb_publishable_DV3gXV4H9AVoPpZtNgiRcA_dY935tA-',
};

export const PONTE_URL = 'https://script.google.com/macros/s/AKfycbxJLR-qE9FeD167wx533b6wc8kNlbQYeDV2X0Euad2_wTmUabntp5-mo3PVCQ38o1j6/exec';

/** Primeiro nome de quem está logado (NOMES), ou '' se o e-mail não estiver lá. */
export function nomeDe(email) {
  return NOMES[String(email || '').toLowerCase()] || '';
}
