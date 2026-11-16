// Etapa de um projeto (de montarProjetos, js/model.js) no vocabulário do desenho aprovado:
// 'ganchos' | 'rascunho' | 'aprovado' | 'recebido' | 'previa' | 'ajustes' | 'video-aprovado' | 'pronto' | 'arquivado' | ''.
// Puro: sem rede, sem DOM. Ordem de precedência: pronto > video-aprovado > ajustes > previa >
// recebido > aprovado > rascunho > ganchos > ''.
//
// 'ganchos' (desde 15/11/2026): o motor propôs 3 ganchos ("<id> ganchos vN.md") e ainda não há rascunho nem roteiro;
// ela escolhe um no app ("<id> gancho vN.md") e o rascunho v1 nasce dele. Com o rascunho, a etapa vira 'rascunho'.
//
// Divergências entre as regras pedidas (implementadas aqui) e formatos.md / model.js:
// 1. 'arquivado' nunca é devolvido: model.js ignora 2-Roteiros/arquivo/ (não registra esses
//    arquivos), então não há como saber. Um projeto cujo roteiro foi para arquivo/ mas cujo
//    rascunho ficou em rascunhos* aparece como 'rascunho'; se só existe em arquivo/, nem entra no Map.
// 2. ajustes de versão antiga: model.ajusteEmAndamento considera qualquer "ajustes vN" sem prévia
//    vN+1 (ex.: ajustes v1 com prévias v1 e v3) e calcularEtapa diz "ajustes"; aqui só conta
//    ajustes com N >= última prévia, então esse caso é 'previa'. Ajustes sem prévia nenhuma não
//    viram 'ajustes' (a etapa segue as regras seguintes).
// 3. prévia com só IG ou só TT: formatos.md diz que as duas andam sempre juntas; model.js (e esta
//    função) aceitam uma só como prévia válida.
// 4. brutos sem id no nome (ex. IMG_1234.MOV): formatos.md diz que ela não precisa renomear e o
//    /editar descobre o roteiro pela fala; model.js só liga a um projeto brutos que começam com o
//    id, então o projeto fica 'aprovado' (não 'recebido') até sair a prévia. Os órfãos estão em
//    model.brutosSemId().
// 5. o rascunho continua em rascunhos* depois de aprovado: com "<id> - <título>.md" na raiz a
//    etapa é 'aprovado' (ou adiante), nunca 'rascunho' — igual a model.ehRoteiroParaAprovar.
// 6. "<id> limpar.md" (testes): ignorado aqui; a etapa é calculada como se não existisse (para
//    esconder testes em limpeza use model.testesAtivos). Projeto só com limpar.md → ''.
// 7. postado / vencedor (model.calcularEtapa diz "postado em dd/mm"): o desenho aprovado não tem essa
//    etapa; com pacote em 5-Prontos é 'pronto'. Vencedor sem pacote não muda a etapa.
// 8. o desenho aprovado também lista 'mudanca' e 'recusado', que não se deduzem das listagens do Drive;
//    não são devolvidos. Projeto só com "<id> fontes.md" → ''.

import { ehPreviaNova, ehAprovadoSemBruto, ehRoteiroParaAprovar, ehGanchosParaEscolher } from './model.js';

export const ETAPAS = ['ganchos', 'rascunho', 'aprovado', 'recebido', 'previa', 'ajustes', 'video-aprovado', 'pronto', 'arquivado'];

/** Maior versão de rascunho ("<id> rascunho vN.md" em qualquer rascunhos*), ou null. */
export function versaoRascunho(p) {
  return p?.ultimoRascunho?.v ?? null;
}

/** Maior versão de prévia (IG e/ou TT vN em 4-Revisao), ou null. */
export function versaoPreviaAtual(p) {
  return p?.previas?.atual ?? null;
}

/** Pedido "ajustes vN" com N >= última prévia e sem prévia vN+1 → {v, file}; senão null. */
export function ajustePendente(p) {
  const n = versaoPreviaAtual(p);
  if (n === null) return null;
  const vs = new Set(p.previas.versoes.map((x) => x.v));
  const pend = (p.ajustes || []).filter((a) => a.v >= n && !vs.has(a.v + 1));
  return pend.length ? pend[pend.length - 1] : null;
}

export function etapaDe(p) {
  if (!p) return '';
  if (p.pacote) return 'pronto';
  if (p.aprovado) return 'video-aprovado';
  if (ajustePendente(p)) return 'ajustes';
  if (ehPreviaNova(p)) return 'previa';
  if (p.brutos.length && versaoPreviaAtual(p) === null) return 'recebido';
  if (ehAprovadoSemBruto(p)) return 'aprovado';
  if (ehRoteiroParaAprovar(p)) return 'rascunho';
  if (ehGanchosParaEscolher(p)) return 'ganchos';
  return '';
}
