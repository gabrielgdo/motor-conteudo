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
export const SHEETJS_URL = './vendor/xlsx.full.min.js';
