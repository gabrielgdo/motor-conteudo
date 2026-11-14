// INTEGRAÇÕES: o ÚNICO módulo que fala com o mundo externo (Google Identity Services, Drive,
// Sheets). Só ele importa auth.js, drive.js e sheet.js; o resto do app chama Integra.
// As funções de escrita (criarArquivo, enviarVideo, planilha.acrescentar, ponte.avisar) chegam
// na etapa 2: por enquanto lançam Error('Disponível na etapa 2') e trazem, no comentário, a
// chamada real que entra no lugar (procure "INTEGRAÇÃO:").

import * as auth from './auth.js';
import * as drive from './drive.js';
import * as sheet from './sheet.js';

const naEtapa2 = () => { throw new Error('Disponível na etapa 2'); };

export const Integra = {
  /* ------------------------------------------------------------ login */

  /* INTEGRAÇÃO: login com Google (Google Identity Services, token model).
     google.accounts.oauth2.initTokenClient({ client_id, scope, callback }) e requestAccessToken().
     Escopos (config.js): openid, email, userinfo.email, drive, spreadsheets. Depois do token, o
     e-mail é conferido em ALLOWED; quem protege os dados é a permissão da pasta no Drive.
     Devolve {access_token, expires_at, email} ou lança ErroAuth com a mensagem para a tela. */
  entrar: () => auth.entrar(),

  /** Sessão guardada em sessionStorage (sem precisar do script do GIS) e reagenda a renovação. */
  retomar: () => auth.retomarSessao(),

  /** Carrega o script do GIS antes do clique (o popup precisa sair do gesto, sem esperas). */
  prepararLogin: () => auth.carregarGis(),

  /** Toque no aviso "Sua sessão expirou": renova com popup (gesto do usuário). */
  renovarInterativo: () => auth.renovarInterativo(),

  /** Revoga o token, limpa a sessão e os caches de dados. */
  sair() {
    auth.sair();
    drive.invalidarCache();
    sheet.invalidarPostados();
  },

  email: () => auth.emailAtual(),

  /* ----------------------------------------------------------- leitura */

  /** Listagens de 2-Roteiros (e rascunhos*), 3-Brutos, 4-Revisao, 5-Prontos (pacotes, vencedores). */
  listagens: (forcar = false) => drive.carregarListagens(forcar),

  /** Map id → 'AAAA-MM-DD' dos ids com "data do post" na aba Desempenho da planilha Radar (só leitura). */
  postados: (forcar = false) => sheet.lerPostados(forcar),

  /** Esquece as listagens e os postados guardados (ação "Atualizar"). */
  invalidar() {
    drive.invalidarCache();
    sheet.invalidarPostados();
  },

  /** Texto de um arquivo do Drive (cache por id + modifiedTime). */
  baixarTexto: (arquivo) => drive.baixarTexto(arquivo),

  /** Conteúdo binário (vídeo, imagem) de um arquivo do Drive, como Blob. */
  baixarBlob: (arquivo) => drive.baixarBlob(typeof arquivo === 'string' ? arquivo : arquivo.id),

  /** Endereço https do arquivo ou da pasta no Drive (webViewLink ou o link montado pelo id). */
  linkDrive: (arquivo) => drive.linkDrive(arquivo),

  /* ----------------------------------------------------- escrita (etapa 2) */

  drive: {
    /* INTEGRAÇÃO: criar arquivo de texto no Drive.
       POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
       metadados: { name: nome, parents: [idDaPasta], mimeType: 'text/markdown' } + conteúdo.
       Precisa ser arquivo de texto (não Google Doc), porque o motor lê pelo nome e pela extensão.
       Já existe pronto em drive.js: criarArquivoTexto(nome, conteudo, pastaId); os ids das
       pastas vêm de drive.pastas(). */
    criarArquivo(pasta, nome, conteudo) { naEtapa2(pasta, nome, conteudo); },

    /* INTEGRAÇÃO: envio retomável do vídeo, em pedaços (js/upload.js da raiz faz isto).
       1) POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable
          com { name, parents: [idDe3-Brutos] }: a resposta traz o endereço da sessão no cabeçalho Location.
       2) PUT nesse endereço, um pedaço por vez, com Content-Range: bytes inicio-fim/total
          (pedaços múltiplos de 256 KB). Resposta 308 = continue; 200 ou 201 = terminou.
       3) Se a conexão cair: um PUT vazio, com Content-Range no formato "bytes [asterisco]/total",
          devolve até onde o envio chegou. */
    enviarVideo(nome, total) { naEtapa2(nome, total); },
  },

  planilha: {
    /* INTEGRAÇÃO: acrescentar linhas na planilha Radar.
       POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{aba}:append?valueInputOption=USER_ENTERED
       (a "data do post" já tem caminho pronto em sheet.js: marcarPostado(id, data), nativa ou .xlsx). */
    acrescentar(aba, linhas) { naEtapa2(aba, linhas); },
  },

  ponte: {
    /* INTEGRAÇÃO: ponte no Google Apps Script (função doPost publicada como app da web).
       A página manda { bot, corpo }; a ponte confere quem chamou e repassa ao webhook da rotina
       do bot, com a chave guardada nas propriedades do script. As chaves nunca ficam nesta página.
       Os nomes dos eventos para o Radar e o Roteirista são uma proposta: combine com cada bot. */
    avisar(bot, corpo) { naEtapa2(bot, corpo); },
  },
};
