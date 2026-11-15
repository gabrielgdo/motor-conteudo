// INTEGRAÇÕES: o ÚNICO módulo que fala com o mundo externo (Google Identity Services, Drive,
// Sheets, ponte no Apps Script). Só ele importa auth.js, drive.js e sheet.js; o resto do app chama
// Integra.
//
// Leitura: listagens do Drive, textos e blobs, "data do post", abas da planilha (planilha.ler,
// planilha.lerPautas, execucoes.ler, candidatos.ler).
// Escrita (controle manual):
//   planilha.acrescentar / atualizarCelula   linhas e células da planilha nativa (RAW)
//   planilha.gravarDecisoes                  decisões de pauta: relê Seleção e Decisões na hora,
//                                            planeja com selecao.js e só então grava
//   drive.criarArquivo                       arquivo de texto numa pasta do motor
//   drive.gravarDecisaoPrevia                aprovado.md / ajustes vN.md em 4-Revisao, conferindo
//                                            os nomes imediatamente antes (revisao.js)
//   ponte.disparar / ponte.decidirRoteiro    atrás de FLAGS.ponte e PONTE_URL (config.js);
//                                            desligada, erro com codigo 'ponte-desligada'
//   drive.enviarVideo                        vídeo bruto → 3-Brutos (`<id>.<ext>`), retomável com
//                                            upload.js e conferido nos metadados (envio-video.js)
//
// As regras puras (controle.js, selecao.js, revisao.js) são importadas aqui e estão na lista do
// service worker (sw.js).

import * as auth from './auth.js';
import * as drive from './drive.js';
import * as sheet from './sheet.js';
import { CONFIG, FLAGS, PONTE_URL, REVISAO_FOLDER, PASTAS, ROOT_FOLDER } from './config.js';
import { idValido, idCandidatoValido } from './parse.js';
import * as C from './controle.js';
import * as S from './selecao.js';
import { lerCandidatos, criarArquivosDoApp } from './candidatos.js';
import { planejarArquivoRevisao } from './revisao.js';
import * as PM from './pedidos-motor.js';
// Envio do vídeo bruto (ponto 7): upload.js só é importado aqui; as regras ficam em envio-video.js.
import { criarUpload } from './upload.js';
import { criarEnviador, travaDoNavegador } from './envio-video.js';

const naEtapa2 = () => { throw new Error('Disponível na etapa 2'); };

// Enviador do vídeo bruto: montado uma vez (guarda os envios desta aba contra o clique repetido).
let enviadorVideo = null;
function enviador() {
  if (!enviadorVideo) {
    enviadorVideo = criarEnviador({
      podeEnviar: () => C.podeDecidir(auth.emailAtual()),
      validadeToken: () => Math.max(0, (auth.lerSessao()?.expires_at || 0) - Date.now()),
      renovarInterativo: () => auth.renovarInterativo(),
      pastaBrutos: async () => (await drive.pastas()).brutos,
      listarBrutos: (pastaId) => drive.listar(pastaId),
      metadados: (id, campos) => drive.metadados(id, campos),
      criarUpload,
      trava: travaDoNavegador(),
      storage: globalThis.localStorage,
      aoTerminar: () => drive.invalidarCache(),
    });
  }
  return enviadorVideo;
}

/** Erro com `codigo` para a tela decidir o que mostrar ('ponte-desligada', 'sem-permissao'…). */
export class ErroIntegra extends Error {
  constructor(mensagem, codigo = '') {
    super(mensagem);
    this.codigo = codigo;
  }
}

export const MENSAGEM_PONTE_DESLIGADA = 'O disparo pelo app ainda não está ligado.';

/** Nome da aba: chave de CONFIG.abas ('selecao', 'decisoes', 'execucoes'…) ou o próprio nome. */
const nomeDaAba = (aba) => CONFIG.abas[aba] || String(aba || '');

/* ---------------------------------------------------------------- ponte */

function exigirPonte() {
  if (!FLAGS.ponte || !/^https:\/\/\S+$/.test(String(PONTE_URL || ''))) {
    throw new ErroIntegra(MENSAGEM_PONTE_DESLIGADA, 'ponte-desligada');
  }
}

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

/** Texto livre só como DADO: chaves simples, valores texto/número/booleano, tamanho limitado. */
function dadosLimpos(dados) {
  const out = {};
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return out;
  for (const [k, v] of Object.entries(dados)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * POST na ponte (app da web do Apps Script). Corpo text/plain com JSON (sem pré-verificação de
 * CORS); o access_token vai só no corpo, nunca na URL nem em log. A ponte confere o token no
 * Google, a lista de e-mails, a rotina, a trava e a chave_idem, e responde {ok, ...}.
 */
async function chamarPonte(corpo) {
  exigirPonte();
  const token = auth.getToken() || await auth.renovar();
  let r;
  try {
    r = await fetch(PONTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...corpo, access_token: token }),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ErroIntegra('Sem conexão com a ponte (ou ela não respondeu). Tente de novo.', 'sem-conexao');
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok || !j || typeof j !== 'object') throw new ErroIntegra(`A ponte não respondeu como esperado (${r.status}).`, 'resposta-invalida');
  if (j.ok === false) throw new ErroIntegra(texto(j.mensagem, 500) || 'A ponte recusou o pedido.', texto(j.codigo, 60) || 'recusado');
  return j;
}

export const Integra = {
  /* ------------------------------------------------------------ login */

  /* INTEGRAÇÃO: login com Google (Google Identity Services, token model).
     google.accounts.oauth2.initTokenClient({ client_id, scope, callback }) e requestAccessToken().
     Escopos (config.js): openid, email, userinfo.email, drive, spreadsheets. Depois do token, o
     e-mail é conferido em ALLOWED; quem protege os dados é a permissão da pasta no Drive.
     Devolve {access_token, expires_at, email} ou lança ErroAuth com a mensagem para a tela. */
  entrar: () => auth.entrar(),

  /** "Usar outra conta" (entrada com a sessão vencida): login com a escolha de conta. */
  entrarComOutraConta: () => auth.entrar({ outraConta: true }),

  /** "Continuar como …": um toque, com login_hint na conta da sessão vencida (só contas permitidas). */
  continuar: (email) => auth.continuar(email || undefined),

  /** Abertura do app: { estado: 'entrar' | 'continuar' | 'normal', email } pela sessão guardada. */
  abertura: () => auth.estadoDeAbertura(),

  /** Texto do botão "Continuar como <nome>" (texto puro: vai por textContent). */
  rotuloContinuar: (email) => auth.rotuloContinuar(email),

  /** Sessão guardada em localStorage com o token ainda válido (sem precisar do script do GIS):
      reagenda a renovação e devolve a sessão; vencida ou ausente, null. */
  retomar: () => auth.retomarSessao(),

  /** Carrega o script do GIS antes do clique (o popup precisa sair do gesto, sem esperas). */
  prepararLogin: () => auth.carregarGis(),

  /** Toque no aviso "Sua sessão expirou": renova com popup (gesto do usuário). */
  renovarInterativo: () => auth.renovarInterativo(),

  /** Teleprompter aberto (true) / fechado (false): a renovação automática do token espera até fechar
      (o teleprompter não usa rede). Não muda o fluxo normal nem o Sair (que nunca revoga). */
  segurarRenovacao: (sim) => auth.segurarRenovacao(!!sim),

  /** Não revoga nada no Google (ver auth.js). Cancela renovações, apaga a sessão e as chaves do app no
      armazenamento (menos o tema e os envios retomáveis) e esquece os caches do Drive e da planilha. */
  sair() {
    Integra.desligarGoogle(Integra.encerrar());
  },

  /** Primeira metade do sair, síncrona e sem depender do Google: devolve o token (que não é revogado). */
  encerrar() {
    const token = auth.encerrarSessao();
    try { drive.esquecerTudo(); } catch { /* segue */ }
    // caches em memória lidos do Drive (andamento, sinal de vida, estado dos candidatos): a próxima conta lê de novo
    try { Integra.motor.esquecer(); } catch { /* segue */ }
    try { Integra.app.candidatos.esquecer(); } catch { /* segue */ }
    try { sheet.invalidarPostados(); } catch { /* segue */ }
    try { sheet.invalidarAbas(); } catch { /* segue */ }
    return token;
  },

  /** Segunda metade: só desliga a seleção automática do Google; nunca revoga o token. Nunca lança. */
  desligarGoogle: (token) => auth.desligarGoogleDaJanela(token),

  email: () => auth.emailAtual(),

  /** Há sessão guardada, mesmo com o token vencido? (depois de sair, não: nada relê o Drive nem
      renova sozinho; em localStorage, vale também para o "Sair" feito em outra aba) */
  temSessao: () => auth.estaLogado(),

  /* ----------------------------------------------------------- leitura */

  /** Listagens de 2-Roteiros (e rascunhos*), 3-Brutos, 4-Revisao, 5-Prontos (pacotes, vencedores). */
  listagens: (forcar = false) => drive.carregarListagens(forcar),

  /** Map id → 'AAAA-MM-DD' dos ids com "data do post" na aba Desempenho da planilha Radar (só leitura). */
  postados: (forcar = false) => sheet.lerPostados(forcar),

  /** Esquece as listagens, os postados e as abas guardadas (ação "Atualizar"). */
  invalidar() {
    drive.invalidarCache();
    sheet.invalidarPostados();
    sheet.invalidarAbas();
  },

  /** Texto de um arquivo do Drive (cache por id + modifiedTime). */
  baixarTexto: (arquivo) => drive.baixarTexto(arquivo),

  /** Conteúdo binário (vídeo, imagem) de um arquivo do Drive, como Blob (o arquivo original).
      Drive API: GET files/{id}?alt=media com o token Bearer. `opcoes.aoProgresso(recebido, total)`
      lê o corpo em stream (total = Content-Length, ou o size da listagem, ou 0). */
  baixarBlob: (arquivo, { aoProgresso = null } = {}) => (typeof arquivo === 'string'
    ? drive.baixarBlob(arquivo, { aoProgresso })
    : drive.baixarBlob(arquivo.id, { aoProgresso, tamanho: arquivo.size })),

  /** Endereço https do arquivo ou da pasta no Drive (webViewLink ou o link montado pelo id). */
  linkDrive: (arquivo) => drive.linkDrive(arquivo),

  /** Pasta do motor já lida nesta sessão ('brutos', 'prontos'…) como arquivo do Drive, ou null. */
  pasta: (chave) => drive.pastaConhecida(chave),

  /* -------------------------------------------------------------- escrita */

  drive: {
    /** Cria um arquivo de texto (text/markdown) numa pasta do motor: 'revisao' (4-Revisao,
        REVISAO_FOLDER) ou uma chave de PASTAS; nunca um id livre. Precisa ser arquivo de texto
        (não Google Doc), porque o motor lê pelo nome e pela extensão. → {id, name}. */
    async criarArquivo(pasta, nome, conteudo) {
      let pastaId = null;
      if (pasta === 'revisao') pastaId = REVISAO_FOLDER;
      else if (Object.prototype.hasOwnProperty.call(PASTAS, pasta)) pastaId = (await drive.pastas())[pasta];
      if (!pastaId) throw new ErroIntegra(`Pasta desconhecida: ${pasta}`, 'pasta-desconhecida');
      const n = String(nome || '').trim();
      if (!n || /[\\/]/.test(n)) throw new ErroIntegra('Nome de arquivo inválido.', 'nome-invalido');
      try {
        return await drive.criarArquivoTexto(n, String(conteudo ?? ''), pastaId);
      } finally {
        drive.invalidarCache();
      }
    },

    /** Arquivos de 4-Revisao lidos agora, sem cache (para conferir os nomes antes de gravar).
        Só com `forcar = false` usa a listagem guardada (até 60 s). */
    async listarRevisao(forcar = true) {
      if (forcar === false) return (await drive.carregarListagens()).revisao;
      return drive.listar(REVISAO_FOLDER);
    },

    /** Decisão da prévia (aprovar | ajustar) → `<id> aprovado.md` ou `<id> ajustes vN.md` em
        4-Revisao. Confere os nomes imediatamente antes (vale a primeira decisão gravada; o Drive
        aceita nomes repetidos). → {ok:true, arquivo, nome} | {ok:false, motivo, mensagem}. */
    async gravarDecisaoPrevia({ id, decisao, versao, ajustes = [], observacoes = '' } = {}) {
      if (!FLAGS.revisaoPeloApp) throw new ErroIntegra('Decidir a prévia pelo app está desligado.', 'desligado');
      const arquivosExistentes = await Integra.drive.listarRevisao(true);
      const plano = planejarArquivoRevisao({
        id, decisao, versao, ajustes, observacoes, arquivosExistentes, email: auth.emailAtual(), agora: new Date(),
      });
      if (!plano.ok) return plano;
      const arquivo = await Integra.drive.criarArquivo('revisao', plano.nome, plano.conteudo);
      return { ok: true, arquivo, nome: plano.nome };
    },

    /* Pedidos ao Motor Reels por arquivo (Radar e Roteirista foram desligados; nada passa pela ponte). */

    /** Arquivo de texto por nome numa pasta (o mais recente), ou null. */
    async _acharArquivo(pastaId, nome) {
      const fs = (await drive.listar(pastaId)).filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && f.name.trim() === nome);
      fs.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
      return fs[0] || null;
    },

    /** 1-Radar/pedido-busca.md: cria ou mescla com o pedido que ainda não foi atendido. */
    async gravarPedidoBusca({ quantidade = null, tipo = 'busca', ids = [], teste = false } = {}) {
      const email = auth.emailAtual();
      if (!C.podeDisparar(email)) throw new ErroIntegra('Esta conta não pode pedir rodadas.', 'sem-permissao');
      const pasta = (await drive.pastas()).radar;
      if (!pasta) throw new ErroIntegra('Não encontrei a pasta 1-Radar.', 'pasta-desconhecida');
      const existente = await Integra.drive._acharArquivo(pasta, PM.NOME_PEDIDO_BUSCA);
      const textoAntigo = existente ? await drive.baixarTexto({ id: existente.id, modifiedTime: `${existente.modifiedTime}-${Date.now()}` }) : '';
      const plano = PM.planejarPedidoBusca({ quantidade, tipo, ids, teste, quem: email, existente: textoAntigo });
      if (!plano.ok) throw new ErroIntegra(plano.mensagem, plano.erro);
      try {
        if (existente) await drive.substituirConteudo(existente.id, plano.texto, 'text/markdown');
        else await drive.criarArquivoTexto(plano.nome, plano.texto, pasta);
      } finally { drive.invalidarCache(); }
      return { ok: true, nome: plano.nome, pedido: plano.pedido, mesclado: !!existente };
    },

    /** 1-Radar/decisoes <semana>.md (o motor roda /roteirizar com as aprovadas). */
    async gravarDecisoesSemana({ semana, itens = [] } = {}) {
      const email = auth.emailAtual();
      if (!C.podeDecidir(email)) throw new ErroIntegra('Só a conta da Robertta decide.', 'sem-permissao');
      if (!itens.length) return { ok: true, nome: '', gravado: 0 };
      const pasta = (await drive.pastas()).radar;
      if (!pasta) throw new ErroIntegra('Não encontrei a pasta 1-Radar.', 'pasta-desconhecida');
      const nome = PM.nomeDecisoesSemana(semana);
      const texto = PM.textoDecisoesSemana({ semana, itens, quem: email });
      const existente = await Integra.drive._acharArquivo(pasta, nome);
      try {
        if (existente) await drive.substituirConteudo(existente.id, texto, 'text/markdown');
        else await drive.criarArquivoTexto(nome, texto, pasta);
      } finally { drive.invalidarCache(); }
      return { ok: true, nome, gravado: itens.length };
    },

    /** 2-Roteiros/rascunhos/<id> decisao vN.md com quem (e-mail logado) e quando. */
    async gravarDecisaoRoteiro({ id, versao, decisao, pedido = '', motivo = '' } = {}) {
      const email = auth.emailAtual();
      if (!C.podeDecidir(email)) throw new ErroIntegra('Só a conta da Robertta decide.', 'sem-permissao');
      if (!idValido(id)) throw new ErroIntegra(`Id inválido: ${id}`, 'id-invalido');
      const v = Number(versao);
      if (!Number.isInteger(v) || v < 1) throw new ErroIntegra(`Versão inválida: ${versao}`, 'versao-invalida');
      if (!['aprovar', 'mudar', 'recusar'].includes(decisao)) throw new ErroIntegra('A decisão precisa ser aprovar, mudar ou recusar.', 'decisao-invalida');
      if (decisao === 'mudar' && !String(pedido || '').trim()) throw new ErroIntegra('Diga o que mudar.', 'falta-pedido');
      const raiz = (await drive.pastas()).roteiros;
      const pasta = (await drive.listar(raiz)).find((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.name.trim().toLowerCase() === 'rascunhos');
      if (!pasta) throw new ErroIntegra('Não encontrei 2-Roteiros/rascunhos.', 'pasta-desconhecida');
      const nome = PM.nomeDecisaoRoteiro(id, v);
      const texto = PM.textoDecisaoRoteiro({ id, versao: v, decisao, pedido, motivo, quem: email });
      try {
        const existente = await Integra.drive._acharArquivo(pasta.id, nome);
        if (existente) await drive.substituirConteudo(existente.id, texto, 'text/markdown');
        else await drive.criarArquivoTexto(nome, texto, pasta.id);
      } finally { drive.invalidarCache(); }
      return { ok: true, nome };
    },

    /* INTEGRAÇÃO: envio retomável do vídeo, em pedaços (js/upload.js faz isto, ainda sem ser importado).
       1) POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable
          com { name, parents: [idDe3-Brutos] }: a resposta traz o endereço da sessão no cabeçalho Location.
       2) PUT nesse endereço, um pedaço por vez, com Content-Range: bytes inicio-fim/total
          (pedaços múltiplos de 256 KB). Resposta 308 = continue; 200 ou 201 = terminou.
       3) Se a conexão cair: um PUT vazio, com Content-Range no formato "bytes [asterisco]/total",
          devolve até onde o envio chegou. */
    /** Vídeo bruto → 3-Brutos (nível de cima) como `<id>.<ext minúscula>`, retomável (upload.js).
        Chamar DENTRO do toque em "Enviar" (renova o token ali, se faltar pouco). Bloqueia se já houver
        bruto do id (nunca sobrescreve), trava por id (navigator.locks + reserva no localStorage) e só
        diz concluído depois de conferir tamanho, pasta e lixeira nos metadados. Ver envio-video.js.
        → {promessa, nome, pausar(), continuar(), cancelar()}. */
    enviarVideo(opcoes) { return enviador()(opcoes); },
  },

  planilha: {
    /** Aba da planilha Radar (nativa) → {aba, linhas, cabecalho, linhaCabecalho}. `aba`: chave de
        CONFIG.abas ou o nome. Aba que não existe: erro com codigo 'aba-ausente' ("A aba X ainda não
        existe na planilha."); planilha .xlsx: codigo 'xlsx'. */
    ler: (aba, forcar = false) => sheet.lerAba(nomeDaAba(aba), { forcar }),

    /** Acrescenta linhas (já na ordem do cabeçalho real) no fim da aba (values.append, RAW). */
    acrescentar: (aba, linhas) => sheet.acrescentarLinhas(nomeDaAba(aba), linhas),

    /** Grava uma célula: `linha` 1-based, `coluna` índice 0-based ou letra (values.update, RAW). */
    atualizarCelula: (aba, linha, coluna, valor) => sheet.atualizarCelula(nomeDaAba(aba), linha, coluna, valor),

    /** Seleção e Decisões lidas e interpretadas → {selecao, decisoes, colunasProntas}. */
    async lerPautas(forcar = false) {
      // Sem a aba Seleção: o erro 'aba-ausente' sobe (a tela explica). Sem a aba Decisões: as pautas
      // aparecem, mas decidir fica desligado (decisoesAusente).
      const [sel, dec] = await Promise.all([
        sheet.lerAba(nomeDaAba('selecao'), { forcar }),
        sheet.lerAba(nomeDaAba('decisoes'), { forcar }).catch((e) => {
          if (e?.codigo === 'aba-ausente') return null;
          throw e;
        }),
      ]);
      const decisoes = S.lerDecisoes(dec ? dec.linhas : []);
      return {
        selecao: S.lerSelecao(sel.linhas),
        decisoes,
        colunasProntas: !!dec && S.colunasDecisoesProntas(decisoes.cabecalho),
        decisoesAusente: !dec,
      };
    },

    /** Grava as decisões de pauta feitas no app: relê Seleção e Decisões na hora, planeja
        (selecao.planejarDecisoes: ids T fora, idempotência, primeira decisão vale, mudança de ideia
        só antes de "enviada ao Roteirista", só a conta da Robertta), acrescenta as linhas em
        Decisões e atualiza o status na Seleção (linha achada por id_pauta). Sem as colunas novas
        em Decisões, nada é gravado. `decisoesVistas`: Decisões como a tela mostrou.
        → o plano ({ok, erro?, mensagem?, resultados, ...}) com `gravado` (linhas acrescentadas). */
    async gravarDecisoes({ pedidos, decisoesVistas = [] } = {}) {
      if (!FLAGS.decisoesPeloApp) throw new ErroIntegra('Gravar decisões de pauta pelo app está desligado.', 'desligado');
      const [sel, dec] = await Promise.all([
        sheet.lerAba(nomeDaAba('selecao'), { forcar: true }), sheet.lerAba(nomeDaAba('decisoes'), { forcar: true }),
      ]);
      const plano = S.planejarDecisoes({
        selecao: S.lerSelecao(sel.linhas),
        decisoesVistas,
        decisoesAgora: S.lerDecisoes(dec.linhas),
        pedidos,
        email: auth.emailAtual(),
        agora: new Date(),
      });
      if (!plano.ok) return { ...plano, gravado: 0, falhasSelecao: [], falhasArquivo: [] };
      const falhasSelecao = [];
      if (plano.linhas.length) {
        await sheet.acrescentarLinhas(dec.aba, plano.linhas);
        // Decisões é a fonte do histórico; o status na Seleção acompanha. Se ele falhar, a decisão
        // já está gravada e o estado da pauta segue a última linha de Decisões.
        for (const a of plano.atualizacoes) {
          try {
            await sheet.atualizarCelula(sel.aba, a.linha, a.coluna, a.valor);
          } catch (erro) {
            falhasSelecao.push({ id_pauta: a.id_pauta, erro });
          }
        }
      }
      // Arquivo da semana no Drive (o motor lê 1-Radar/decisoes <semana>.md para /roteirizar): um reflexo
      // da aba Decisões, regravado inteiro com todas as decisões daquela semana (PM.itensDaSemana). Assim
      // uma gravação nunca apaga a decisão de outra pauta, e confirmar de novo depois de uma falha recria
      // o arquivo mesmo sem linha nova na planilha.
      const falhasArquivo = [];
      const semanas = new Set([...(pedidos || []).map((p) => PM.semanaDeIdPauta(p?.id_pauta)),
        ...(plano.registros || []).map((r) => r.semana || PM.semanaDeIdPauta(r.id_pauta))].filter(Boolean));
      const jaGravadas = S.lerDecisoes(dec.linhas).decisoes;
      for (const semana of semanas) {
        const itens = PM.itensDaSemana({ semana, decisoes: jaGravadas, novos: plano.registros || [] });
        if (!itens.length) continue;
        try { await Integra.drive.gravarDecisoesSemana({ semana, itens }); }
        catch {
          try { await Integra.drive.gravarDecisoesSemana({ semana, itens }); } // uma nova tentativa na hora
          catch (erro) { falhasArquivo.push({ semana, erro }); }
        }
      }
      return { ...plano, gravado: plano.linhas.length, falhasSelecao, falhasArquivo };
    },
  },

  candidatos: {
    /** Aba Candidatos (gravada pelo Radar diário) → {candidatos, temIdExecucao, cabecalho, abaAusente}.
        Sem a aba: lista vazia e abaAusente: true (a tela explica; o resto de Pautas segue igual). */
    async ler(forcar = false) {
      // Junto com a aba, o estado de cada candidato no app (_motor/app/candidatos). Se o Drive
      // falhar, a aba aparece do mesmo jeito e `app.erro` explica (os botões de estado esperam).
      const app = Integra.app.candidatos.ler().catch((e) => ({ registros: {}, erro: e?.message || 'Não consegui ler o estado dos candidatos no Drive.' }));
      try {
        const aba = await sheet.lerAba(nomeDaAba('candidatos'), { forcar });
        const t = lerCandidatos(aba.linhas);
        return { candidatos: t.candidatos, temIdExecucao: t.temIdExecucao, cabecalho: t.cabecalho, abaAusente: false, app: await app };
      } catch (e) {
        if (e?.codigo === 'aba-ausente') return { candidatos: [], temIdExecucao: false, cabecalho: [], abaAusente: true, app: await app };
        throw e;
      }
    },
  },

  /* Arquivos próprios do app no Drive (nunca a planilha): `_motor/app/candidatos/<id>.json` dentro de
     ROOT_FOLDER, com o estado do candidato (candidato | para-decidir | excluido | recusado). As regras
     e a leitura/gravação ficam em candidatos.js (criarArquivosDoApp); aqui só entram as funções do
     drive.js. Excluir ou recusar não toca Seleção, Decisões nem outras pastas. */
  app: {
    candidatos: criarArquivosDoApp({
      raiz: async () => ROOT_FOLDER,
      listar: (pastaId) => drive.listar(pastaId),
      baixarTexto: (arquivo) => drive.baixarTexto(arquivo),
      criarPasta: (nome, paiId) => drive.criarPasta(nome, paiId),
      criarArquivoTexto: (nome, texto, pastaId, mime) => drive.criarArquivoTexto(nome, texto, pastaId, mime),
      substituirConteudo: (id, texto, mime) => drive.substituirConteudo(id, texto, mime),
    }),
  },

  execucoes: {
    /** Aba Execuções → {execucoes, cabecalho, abaAusente}. Sem a aba: lista vazia e abaAusente: true. */
    async ler(forcar = false) {
      try {
        const aba = await sheet.lerAba(nomeDaAba('execucoes'), { forcar });
        const t = C.lerExecucoes(aba.linhas);
        return { execucoes: t.execucoes, cabecalho: t.cabecalho, abaAusente: false };
      } catch (e) {
        if (e?.codigo === 'aba-ausente') return { execucoes: [], cabecalho: [], abaAusente: true };
        throw e;
      }
    },
  },

  ponte: {
    /** Pede uma rodada a um bot pela ponte (só rotinas disparáveis da lista fechada). Texto livre
        vai em `dados`, como dado. → a resposta da ponte ({ok, id_execucao, ...}). */
    async disparar({ rotina, id_alvo = '', id_lote = '', chave_idem, dados = {} } = {}) {
      exigirPonte();
      if (!C.rotinaConhecida(rotina) || !C.ROTINAS[rotina].disparavel) throw new ErroIntegra('Rotina fora da lista do app.', 'rotina-desconhecida');
      if (rotina === 'roteirista-decisao') throw new ErroIntegra('A decisão de roteiro vai por ponte.decidirRoteiro.', 'rotina-desconhecida');
      if (!C.podeDisparar(auth.emailAtual())) throw new ErroIntegra('Esta conta não pode disparar rodadas.', 'sem-permissao');
      if (C.ROTINAS[rotina].soDecide && !C.podeDecidir(auth.emailAtual())) throw new ErroIntegra('Só a conta da Robertta decide.', 'sem-permissao');
      const id = texto(id_alvo, 20);
      // radar-candidato: o id_alvo é o id do candidato (AAAA-MM-DD-NN), não um id de roteiro.
      const idOk = rotina === 'radar-candidato' ? idCandidatoValido : idValido;
      if (id && !idOk(id)) throw new ErroIntegra(`Id inválido: ${id}`, 'id-invalido');
      if (!texto(chave_idem, 80)) throw new ErroIntegra('Falta a chave do pedido.', 'sem-chave');
      return chamarPonte({
        acao: 'disparar', rotina, id_alvo: id, id_lote: texto(id_lote, 40), chave_idem: texto(chave_idem, 80), dados: dadosLimpos(dados),
      });
    },

    /** Leva ao Roteirista a decisão sobre uma versão do roteiro (aprovar | mudar | recusar). Só a
        conta da Robertta. → a resposta da ponte. */
    async decidirRoteiro({ id, versao, decisao, pedido = '', motivo = '', chave_idem } = {}) {
      exigirPonte();
      if (!C.podeDecidir(auth.emailAtual())) throw new ErroIntegra('Só a conta da Robertta decide.', 'sem-permissao');
      if (!idValido(id)) throw new ErroIntegra(`Id inválido: ${id}`, 'id-invalido');
      const v = Number(versao);
      if (!Number.isInteger(v) || v < 1) throw new ErroIntegra(`Versão inválida: ${versao}`, 'versao-invalida');
      if (!['aprovar', 'mudar', 'recusar'].includes(decisao)) throw new ErroIntegra('A decisão precisa ser aprovar, mudar ou recusar.', 'decisao-invalida');
      if (decisao === 'mudar' && !String(pedido || '').trim()) throw new ErroIntegra('Diga o que mudar.', 'falta-pedido');
      if (!texto(chave_idem, 80)) throw new ErroIntegra('Falta a chave do pedido.', 'sem-chave');
      return chamarPonte({
        acao: 'decidir-roteiro',
        rotina: 'roteirista-decisao',
        id_alvo: id,
        chave_idem: texto(chave_idem, 80),
        dados: dadosLimpos({ id, versao: v, decisao, pedido: String(pedido || ''), motivo: String(motivo || '') }),
      });
    },
  },

  /* Andamento do Motor Reels (só leitura): `_motor/andamento/<id>.json`, publicado pelo
     bin/andamento.sh. Validação e resumo em js/andamento.js (puro). */
  motor: (() => {
    const PASTA_DRIVE = 'application/vnd.google-apps.folder';
    let pastasAndamento = null; // ids das pastas "andamento" dentro de _motor (o Drive aceita nome repetido)
    const lidos = new Map(); // id do vídeo → {chave: `${fileId}:${modifiedTime}`, dados}
    let saudeLida = null; // {chave: `${fileId}:${modifiedTime}`, dados} do _motor/saude.json
    return {
      /** → {estado:'ok', dados} | {estado:'sem-arquivo'} | {estado:'indisponivel', erro}. `dados` já
          validado (validarAndamento). Cache por modifiedTime: arquivo igual não é baixado de novo. */
      async andamento(id) {
        if (!idValido(id)) return { estado: 'indisponivel', erro: `Id inválido: ${id}` };
        try {
          if (!pastasAndamento) {
            const ids = await drive.pastas();
            if (!ids.motor) return { estado: 'sem-arquivo' }; // ainda sem a pasta _motor
            const filhos = await drive.listar(ids.motor);
            const achadas = filhos.filter((f) => f.mimeType === PASTA_DRIVE && f.name.trim() === 'andamento').map((f) => f.id);
            if (!achadas.length) return { estado: 'sem-arquivo' };
            pastasAndamento = achadas;
          }
          const nome = `${id}.json`;
          const arquivos = (await Promise.all(pastasAndamento.map((p) => drive.listar(p)))).flat()
            .filter((f) => f.mimeType !== PASTA_DRIVE && f.name.trim() === nome)
            .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
          if (!arquivos.length) return { estado: 'sem-arquivo' };
          const arquivo = arquivos[0];
          const chave = `${arquivo.id}:${arquivo.modifiedTime || ''}`;
          const guardado = lidos.get(id);
          if (guardado?.chave === chave) return { estado: 'ok', dados: guardado.dados };
          const [{ validarAndamento }, conteudo] = await Promise.all([import('./andamento.js'), drive.baixarTexto(arquivo)]);
          const v = validarAndamento(String(conteudo || ''), id);
          if (!v.ok) return { estado: 'indisponivel', erro: `O arquivo de andamento não está no formato esperado (${v.motivo}).` };
          lidos.set(id, { chave, dados: v.dados });
          return { estado: 'ok', dados: v.dados };
        } catch (e) {
          pastasAndamento = null; // a pasta pode ter mudado ou a conta saído: resolve de novo na próxima
          return { estado: 'indisponivel', erro: e?.message || 'Não consegui ler o andamento.' };
        }
      },
      /** Sinal de vida do motor: `_motor/saude.json` (bin/saude.py). → {estado:'ok', dados} |
          {estado:'sem-arquivo'} | {estado:'indisponivel', erro}. Cache por modifiedTime. */
      async saude() {
        try {
          const ids = await drive.pastas();
          if (!ids.motor) return { estado: 'sem-arquivo' };
          const arquivos = (await drive.listar(ids.motor))
            .filter((f) => f.mimeType !== PASTA_DRIVE && f.name.trim() === 'saude.json')
            .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
          if (!arquivos.length) return { estado: 'sem-arquivo' };
          const arquivo = arquivos[0];
          const chave = `${arquivo.id}:${arquivo.modifiedTime || ''}`;
          if (saudeLida?.chave === chave) return { estado: 'ok', dados: saudeLida.dados };
          const [{ validarSaude }, conteudo] = await Promise.all([import('./saude.js'), drive.baixarTexto(arquivo)]);
          const v = validarSaude(String(conteudo || ''));
          if (!v.ok) return { estado: 'indisponivel', erro: `O sinal de vida do motor não está no formato esperado (${v.motivo}).` };
          saudeLida = { chave, dados: v.dados };
          return { estado: 'ok', dados: v.dados };
        } catch (e) {
          return { estado: 'indisponivel', erro: e?.message || 'Não consegui ler o sinal de vida do motor.' };
        }
      },
      /** Ao sair da conta: esquece o que foi lido. */
      esquecer() { pastasAndamento = null; lidos.clear(); saudeLida = null; },
    };
  })(),
};
