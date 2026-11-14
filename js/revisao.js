// DECISÃO DA PRÉVIA (puro: sem DOM, sem rede): o arquivo que o app grava em 4-Revisao.
//
//   planejarArquivoRevisao(...)  → {ok:true, nome, conteudo} | {ok:false, motivo, mensagem}
//
// Quem recebe a decisão grava (o app ou o Diretor), conferindo antes pelo nome: o Drive aceita
// dois arquivos com o mesmo nome, então a conferência é feita com a listagem de 4-Revisao lida
// imediatamente antes de gravar (Integra.drive.listarRevisao). O conteúdo sai dos geradores do
// contrato (parse.js: gerarAprovacao / gerarAjustes). Não há "recusar" a prévia: só aprovar ou
// ajustar. Ids T podem ser decididos aqui (o motor trata os testes); só Decisões e Desempenho
// recusam ids T.

import { gerarAprovacao, gerarAjustes, parseRevisao, idValido, horaCurta, formatarData, hojeISO, lerDataHora } from './parse.js';
import { podeDecidir } from './controle.js';

export const DECISOES_PREVIA = ['aprovar', 'ajustar'];

/** Nome do arquivo da decisão: `<id> aprovado.md` ou `<id> ajustes v<N>.md`. */
export function nomeArquivoRevisao(id, decisao, versao) {
  return decisao === 'aprovar' ? `${id} aprovado.md` : `${id} ajustes v${Number(versao)}.md`;
}

const nomeDe = (a) => (typeof a === 'string' ? a : String(a?.name || ''));

function quandoCriado(arquivo, agora) {
  const d = typeof arquivo === 'string' ? null : lerDataHora(arquivo?.createdTime);
  if (!d) return '';
  return hojeISO(d) === hojeISO(agora) ? ` às ${horaCurta(d)}` : ` em ${formatarData(d)} às ${horaCurta(d)}`;
}

/**
 * O arquivo a criar em 4-Revisao, ou a recusa.
 *   id, decisao ('aprovar' | 'ajustar'), versao (a prévia vista: versao_aprovada ou versao_base),
 *   ajustes [{versao: ig|tt|ambas, tempo, pedido, como}] (só no ajustar), observacoes,
 *   arquivosExistentes (listagem de 4-Revisao: nomes ou arquivos do Drive {name, createdTime}),
 *   email, agora.
 * Recusa quando: a conta não decide; já existe `<id> aprovado.md` (nada mais a gravar); o nome
 * já existe (também com caixa diferente, que o motor lê igual); dados fora do contrato.
 */
export function planejarArquivoRevisao({
  id, decisao, versao, ajustes = [], observacoes = '', arquivosExistentes = [], email, agora = new Date(),
} = {}) {
  if (!podeDecidir(email)) return { ok: false, motivo: 'sem-permissao', mensagem: 'Só a conta da Robertta decide.' };
  if (!idValido(id)) return { ok: false, motivo: 'id-invalido', mensagem: `Id inválido: ${id}` };
  if (!DECISOES_PREVIA.includes(decisao)) {
    return { ok: false, motivo: 'decisao-invalida', mensagem: 'Na prévia, a decisão é aprovar ou pedir ajustes.' };
  }

  // Do mesmo id: a aprovação já existe? O nome pedido já existe (comparando pelo tipo e versão,
  // que é como o vigia lê, e também pelo nome exato)?
  const nome = nomeArquivoRevisao(id, decisao, versao);
  const doId = (arquivosExistentes || []).map((a) => ({ a, p: parseRevisao(nomeDe(a)) })).filter((x) => x.p?.id === id);
  const aprovado = doId.find((x) => x.p.tipo === 'aprovado');
  if (aprovado) {
    return { ok: false, motivo: 'ja-aprovado', mensagem: `já decidido: a prévia já foi aprovada (arquivo criado${quandoCriado(aprovado.a, agora)}). Nada mais a gravar.`, arquivo: aprovado.a };
  }
  const mesmo = (arquivosExistentes || []).find((a) => nomeDe(a) === nome)
    || (decisao === 'ajustar' && doId.find((x) => x.p.tipo === 'ajustes' && x.p.v === Number(versao))?.a);
  if (mesmo) {
    return { ok: false, motivo: 'ja-existe', mensagem: `já decidido (arquivo criado${quandoCriado(mesmo, agora)}).`, arquivo: mesmo };
  }

  let conteudo;
  try {
    conteudo = decisao === 'aprovar'
      ? gerarAprovacao({ id, versao, observacoes })
      : gerarAjustes({ id, versaoBase: versao, ajustes, observacoes });
  } catch (e) {
    return { ok: false, motivo: 'dados-invalidos', mensagem: e.message };
  }
  return { ok: true, nome, conteudo };
}
