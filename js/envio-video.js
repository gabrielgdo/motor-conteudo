// ENVIO DO VÍDEO BRUTO PELO APP (ponto 7): regras puras e o passo a passo do envio, com as
// dependências injetadas (o Drive, o token, o upload retomável, as travas). Só js/integra.js monta o
// enviador de verdade (com auth.js, drive.js e upload.js); os testes montam com fetch/XHR/Drive falsos.
//
// Regras que já valem no motor (formatos-referencia.md "Bruto", bin/motor cmd_vigiar):
//   - pasta 3-Brutos, só o nível de cima; extensões mp4, mov ou m4v (sem diferenciar maiúsculas);
//   - o app orienta o nome `<id>.<ext>` (ext em minúsculas); `<id> bruto.mp4` é do bruto de teste;
//   - nunca sobrescrever: com bruto do id já em 3-Brutos, o app bloqueia e explica (decisoes.md 5).

import { idValido, parseBruto, extensao } from './parse.js';

export const EXTENSOES_VIDEO = Object.freeze(['mp4', 'mov', 'm4v']);
/** Token com menos que isto de validade: renova dentro do toque em "Enviar" (sem popup no meio). */
export const MARGEM_TOKEN_MS = 50 * 60 * 1000;
/** Reserva do envio no localStorage (para abas sem navigator.locks): vale até isto sem renovar. */
export const VALIDADE_RESERVA_MS = 2 * 60 * 1000;
export const PREFIXO_RESERVA = 'motor.envio.reserva.';
const BATIDA_RESERVA_MS = 30 * 1000;
const ESPERAS_CONFERENCIA = [0, 1500, 4000];

/** Erro do envio com `codigo` (a tela decide o que mostrar) e `recuperacao` (o que fazer agora). */
export class ErroEnvio extends Error {
  constructor(mensagem, codigo, recuperacao = '') {
    super(mensagem);
    this.name = 'ErroEnvio';
    this.codigo = codigo;
    this.recuperacao = recuperacao;
  }
}

/* ------------------------------------------------------------ regras puras */

/**
 * Nome final do bruto: `<id>.<ext minúscula>`. → {ok:true, nome, ext} | {ok:false, codigo, mensagem}.
 */
export function nomeFinalDoBruto(id, nomeOriginal) {
  if (!idValido(id)) return { ok: false, codigo: 'id-invalido', mensagem: `Id de roteiro inválido: ${String(id ?? '')}.` };
  const ext = extensao(String(nomeOriginal || '').trim()).toLowerCase();
  if (!EXTENSOES_VIDEO.includes(ext)) {
    const veio = ext ? `.${ext}` : 'sem extensão';
    return {
      ok: false,
      codigo: 'extensao',
      mensagem: `O motor só aceita vídeo .mp4, .mov ou .m4v (este arquivo é ${veio}). Escolha o vídeo como saiu da câmera do celular.`,
    };
  }
  return { ok: true, nome: `${id}.${ext}`, ext };
}

/** Os vídeos de 3-Brutos (nível de cima, já listados) que são do id. */
export function brutosDoId(arquivos, id) {
  return (arquivos || []).filter((a) => a && a.mimeType !== 'application/vnd.google-apps.folder' && parseBruto(a.name)?.id === id);
}

/**
 * Confere os metadados do arquivo gravado: tamanho igual, pai = 3-Brutos, fora da lixeira e com o
 * nome pedido. → {ok:true} | {ok:false, codigo, mensagem}.
 */
export function conferirGravado(meta, { total, pastaId, nome }) {
  if (!meta || typeof meta !== 'object' || !meta.id) return { ok: false, codigo: 'conferencia', mensagem: 'O Drive não devolveu os dados do arquivo gravado.' };
  if (meta.trashed === true) return { ok: false, codigo: 'lixeira', mensagem: 'O arquivo foi parar na lixeira do Drive.' };
  const pais = Array.isArray(meta.parents) ? meta.parents : [];
  if (!pais.includes(pastaId)) return { ok: false, codigo: 'pasta', mensagem: 'O arquivo não ficou na pasta 3-Brutos.' };
  if (String(meta.size ?? '') !== String(total)) {
    return { ok: false, codigo: 'tamanho', mensagem: `O tamanho no Drive (${meta.size ?? '?'} bytes) não é o do vídeo (${total} bytes).` };
  }
  if (nome && meta.name !== nome) return { ok: false, codigo: 'nome', mensagem: `O arquivo ficou com o nome “${meta.name}”, e não “${nome}”.` };
  return { ok: true };
}

/** 125 → "2 min 5 s"; null → "calculando…". */
function duracao(seg) {
  if (seg === null || seg === undefined || !Number.isFinite(seg)) return 'calculando…';
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** Progresso real → {pct (0–100, inteiro), feito "12,0 MB de 80,0 MB", velocidade, restante}. */
export function textoProgresso({ enviados = 0, total = 0, velocidade = 0, restante = null } = {}, formatarBytes = (n) => `${n} B`) {
  const t = Math.max(0, Number(total) || 0);
  const e = Math.min(t, Math.max(0, Number(enviados) || 0));
  const pct = t ? Math.min(100, Math.floor((e / t) * 100)) : 0;
  return {
    pct,
    feito: `${formatarBytes(e)} de ${formatarBytes(t)}`,
    velocidade: velocidade > 0 ? `${formatarBytes(velocidade)}/s` : '—',
    restante: e >= t && t > 0 ? '0 s' : duracao(restante),
  };
}

/** Reserva salva ainda vale (outra aba enviando)? */
export function reservaAtiva(valor, agora = Date.now()) {
  try {
    const r = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return !!(r && Number.isFinite(r.ate) && r.ate > agora);
  } catch { return false; }
}

/* --------------------------------------------------------------- enviador */

const semTrava = async (_nome, fn) => fn(true);

/** navigator.locks quando existe: segura `motor-envio-<id>` enquanto `fn` roda (ifAvailable). */
export function travaDoNavegador(locks = globalThis.navigator?.locks) {
  if (!locks || typeof locks.request !== 'function') return semTrava;
  return (nome, fn) => locks.request(nome, { ifAvailable: true }, (lock) => fn(!!lock));
}

/**
 * Monta `enviarVideo`. Dependências:
 *   podeEnviar() → bool                         quem pode gravar no Drive (a conta que decide)
 *   validadeToken() → ms restantes do token (0 sem sessão)
 *   renovarInterativo() → Promise               popup do Google (chamado dentro do toque)
 *   pastaBrutos() → Promise<id de 3-Brutos>
 *   listarBrutos(pastaId) → Promise<arquivos>   sem cache
 *   metadados(id, campos) → Promise<meta>
 *   criarUpload({arquivo, id, nome, pastaId, aoProgresso, aoEstado}) → {iniciar, pausar, continuar, cancelar}
 *   trava(nome, fn(conseguiu))                  navigator.locks (travaDoNavegador)
 *   storage                                     localStorage (reserva entre abas)
 *   esperar(ms), agora()
 *   aoTerminar()                                invalida os caches (Integra.invalidar)
 *
 * enviarVideo({id, arquivo, aoProgresso, aoEstado}) é chamada DENTRO do toque em "Enviar" e devolve
 * na hora {promessa, nome, pausar(), continuar(), cancelar()}; `promessa` resolve
 * {ok:true, arquivo:{id,name,size}, nome, duplicados, jaEstava} ou rejeita ErroEnvio.
 * aoEstado(fase, mensagem?): verificando, renovando, iniciando, enviando, pausado, aguardando-rede,
 * reiniciando, conferindo, concluido, cancelado, erro. A "concluido" só vem depois da conferência.
 */
export function criarEnviador(deps) {
  const {
    podeEnviar = () => false, validadeToken = () => 0, renovarInterativo, pastaBrutos, listarBrutos, metadados,
    criarUpload, trava = semTrava, storage = null, esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
    agora = () => Date.now(), aoTerminar = () => {},
  } = deps;
  const ativos = new Set(); // ids enviando nesta aba (o clique repetido cai aqui, antes de qualquer espera)

  const chaveReserva = (id) => `${PREFIXO_RESERVA}${id}`;
  const lerReserva = (id) => { try { return storage?.getItem(chaveReserva(id)) ?? null; } catch { return null; } };
  const dono = `${agora()}-${Math.random().toString(36).slice(2, 10)}`; // esta aba
  const gravarReserva = (id) => { try { storage?.setItem(chaveReserva(id), JSON.stringify({ ate: agora() + VALIDADE_RESERVA_MS, dono })); } catch { /* sem espaço */ } };
  // Só apaga a reserva que é desta aba (a de outra aba, que ganhou o navigator.locks, fica).
  const apagarReserva = (id) => {
    try { if (JSON.parse(storage?.getItem(chaveReserva(id)) || 'null')?.dono === dono) storage.removeItem(chaveReserva(id)); } catch { /* ignore */ }
  };

  function recusa(mensagem, codigo, recuperacao = '') {
    const e = new ErroEnvio(mensagem, codigo, recuperacao);
    const promessa = Promise.reject(e);
    promessa.catch(() => {});
    return { promessa, nome: '', pausar() {}, continuar() {}, cancelar() {}, recusado: true };
  }

  return function enviarVideo({ id, arquivo, aoProgresso = () => {}, aoEstado = () => {} } = {}) {
    // 1) Tudo o que é síncrono primeiro (o popup do Google precisa sair do toque, sem esperas antes).
    if (!podeEnviar()) return recusa('Só a conta da Robertta envia o vídeo para a edição.', 'sem-permissao', 'Entre com a conta da Robertta para enviar.');
    if (!arquivo || !Number.isFinite(arquivo.size)) return recusa('Escolha o vídeo antes de enviar.', 'sem-arquivo');
    const n = nomeFinalDoBruto(id, arquivo.name);
    if (!n.ok) return recusa(n.mensagem, n.codigo, n.codigo === 'extensao' ? 'Escolha outro arquivo.' : '');
    if (arquivo.size <= 0) return recusa('Este arquivo está vazio (0 bytes).', 'vazio', 'Escolha o vídeo de novo.');
    if (ativos.has(id)) return recusa(`O envio de ${id} já está em andamento.`, 'em-andamento', 'Espere terminar.');
    if (reservaAtiva(lerReserva(id), agora())) return recusa(`O vídeo de ${id} já está sendo enviado em outra janela do app.`, 'em-andamento', 'Espere terminar lá, ou feche a outra janela e tente de novo em 2 minutos.');
    ativos.add(id);
    gravarReserva(id);

    let upload = null;
    let cancelado = false;
    let pausadoAntes = false;
    // Token perto de vencer: o popup do Google sai AGORA, ainda dentro do toque (o iPhone bloqueia
    // popup depois de uma espera), e não no meio do envio.
    let renovacao = null;
    if (validadeToken() < MARGEM_TOKEN_MS && typeof renovarInterativo === 'function') {
      try { renovacao = Promise.resolve(renovarInterativo()); } catch (e) { renovacao = Promise.reject(e); }
      renovacao.catch(() => {});
    }

    async function passos() {
      if (renovacao) {
        aoEstado('renovando', 'Confirmando o acesso ao Google…');
        try { await renovacao; } catch (e) {
          if (e?.codigo === 'saiu') throw new ErroEnvio('Você saiu da conta.', 'saiu');
          throw new ErroEnvio('Não consegui confirmar o acesso ao Google (a janela do Google foi fechada ou bloqueada).', 'token', 'Toque em Enviar de novo e confirme a conta na janela do Google.');
        }
      }
      if (cancelado) throw new ErroEnvio('Envio cancelado.', 'cancelado');
      aoEstado('verificando', 'Conferindo a pasta 3-Brutos…');
      let pastaId;
      let existentes;
      try {
        pastaId = await pastaBrutos();
        if (!pastaId) throw new Error('sem pasta');
        existentes = brutosDoId(await listarBrutos(pastaId), id);
      } catch {
        throw new ErroEnvio('Não consegui ler a pasta 3-Brutos no Drive.', 'leitura', 'Confira a internet e toque em Enviar de novo.');
      }
      if (existentes.length) {
        const igual = existentes.find((a) => a.name === n.nome && String(a.size) === String(arquivo.size));
        if (igual) return { ok: true, arquivo: igual, nome: n.nome, duplicados: existentes.length > 1, jaEstava: true };
        const nomes = existentes.map((a) => a.name).join(', ');
        throw new ErroEnvio(
          `Já existe um vídeo de ${id} em 3-Brutos (${nomes}). O app não substitui o que já foi enviado.`,
          'ja-existe',
          'Para gravar de novo, fale com o Diretor ou apague o vídeo antigo de 3-Brutos no Drive e envie outra vez.',
        );
      }
      if (cancelado) throw new ErroEnvio('Envio cancelado.', 'cancelado');

      // 2) Envio retomável (upload.js): a "concluido" dele vira "conferindo" aqui.
      upload = criarUpload({
        arquivo, id, nome: n.nome, pastaId, aoProgresso,
        aoEstado: (fase, msg) => {
          if (fase === 'concluido') aoEstado('conferindo', 'Conferindo o arquivo no Drive…');
          else if (fase !== 'cancelado' && fase !== 'erro') aoEstado(fase, msg);
        },
      });
      if (pausadoAntes) upload.pausar();
      let res;
      try {
        res = await upload.iniciar();
      } catch (e) {
        if (cancelado || e?.tipo === 'cancelado') throw new ErroEnvio('Envio cancelado. Nada ficou em 3-Brutos.', 'cancelado');
        const detalhe = e?.tipo === 'fatal' && e.message ? ` ${e.message}` : '';
        throw new ErroEnvio(`O envio parou.${detalhe}`, 'envio', 'Toque em Enviar de novo: o envio continua de onde parou.');
      }
      if (!res?.id) throw new ErroEnvio('O Google não confirmou o arquivo gravado.', 'conferencia', 'Abra 3-Brutos no Drive para ver se o vídeo está lá antes de enviar de novo.');

      // 3) Só diz "concluído" depois de os metadados conferirem.
      let meta = null;
      for (const ms of ESPERAS_CONFERENCIA) {
        if (ms) await esperar(ms);
        try { meta = await metadados(res.id, 'id,name,size,parents,trashed'); break; } catch { meta = null; }
      }
      if (!meta) throw new ErroEnvio('O envio terminou, mas não consegui conferir o arquivo no Drive.', 'conferencia', 'Toque em Enviar de novo: se o vídeo já estiver certo em 3-Brutos, o app reconhece e não envia outra vez.');
      const c = conferirGravado(meta, { total: arquivo.size, pastaId, nome: n.nome });
      if (!c.ok) {
        throw new ErroEnvio(`${c.mensagem} O motor pode não conseguir editar este arquivo.`, c.codigo, `Abra 3-Brutos no Drive, apague “${meta.name || n.nome}” e envie de novo.`);
      }
      // 4) Relê a pasta para avisar se apareceu outro bruto do mesmo id no meio tempo.
      let duplicados = false;
      try { duplicados = brutosDoId(await listarBrutos(pastaId), id).length > 1; } catch { /* a conferência já valeu */ }
      return { ok: true, arquivo: { id: meta.id, name: meta.name, size: Number(meta.size) }, nome: n.nome, duplicados, jaEstava: false };
    }

    const promessa = (async () => {
      const batida = setInterval(() => gravarReserva(id), BATIDA_RESERVA_MS);
      try {
        let resultado;
        let conseguiu = true;
        await trava(`motor-envio-${id}`, async (ok) => {
          conseguiu = ok;
          if (ok) resultado = await passos();
        });
        if (!conseguiu) throw new ErroEnvio(`O vídeo de ${id} já está sendo enviado em outra janela do app.`, 'em-andamento', 'Espere terminar lá.');
        aoEstado('concluido');
        return resultado;
      } catch (e) {
        const erro = e instanceof ErroEnvio ? e : new ErroEnvio('Algo deu errado no envio.', 'desconhecido', 'Toque em Enviar de novo.');
        aoEstado(erro.codigo === 'cancelado' ? 'cancelado' : 'erro', erro.message);
        throw erro;
      } finally {
        clearInterval(batida);
        ativos.delete(id);
        apagarReserva(id);
        try { aoTerminar(); } catch { /* ignore */ }
      }
    })();
    promessa.catch(() => {});

    return {
      promessa,
      nome: n.nome,
      pausar() { if (upload) upload.pausar(); else pausadoAntes = true; },
      continuar() { pausadoAntes = false; upload?.continuar(); },
      cancelar() { cancelado = true; upload?.cancelar(); },
    };
  };
}
