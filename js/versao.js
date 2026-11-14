// Nova versão do app (puro, sem DOM: os testes usam direto).
//
// No iPhone, o app instalado na tela de início (standalone) não recarrega ao voltar para ele: a
// página antiga fica em memória com o JS antigo, mesmo depois que o service worker novo assume.
// Por isso, quando o SW que controla a página tem outra versão, a página recarrega SOZINHA uma vez,
// se não houver trabalho em andamento (download, envio, ajustes digitados, vídeo tocando, janela
// aberta). Com trabalho em andamento, mostra o aviso "Nova versão" (tocar recarrega).
//
// Anti-laço: antes de recarregar, grava em sessionStorage a versão para a qual recarregou. Se a
// página nova ainda vier com a versão antiga (ex.: cache HTTP), a segunda vez vira aviso, nunca
// outra recarga. Sem sessionStorage que funcione, também só avisa.

/** Chave em sessionStorage com a versão do SW para a qual a página já recarregou sozinha. */
export const CHAVE_RECARGA = 'motor-recarga-para';

/**
 * O que fazer ao saber a versão do SW que controla a página.
 * @param {object} p
 * @param {string} p.versaoPagina   versão com que esta página foi carregada (VERSAO_APP)
 * @param {string|null} p.versaoSw  versão que o SW respondeu (null: não respondeu a tempo)
 * @param {boolean} p.ocupada       há trabalho em andamento que uma recarga perderia
 * @param {string|null} p.jaRecarregouPara  o que está em CHAVE_RECARGA
 * @returns {'nada'|'recarregar'|'avisar'}
 */
export function decidirAtualizacao({ versaoPagina, versaoSw, ocupada = false, jaRecarregouPara = null }) {
  if (versaoSw && versaoSw === versaoPagina) return 'nada';
  if (!versaoSw) return 'avisar'; // SW que não responde: não dá para saber, então só avisa
  // Página MAIS NOVA que o SW (veio da rede enquanto o SW novo ainda instala): nada a fazer; quando
  // o SW novo assumir, o controllerchange pergunta de novo e as versões batem.
  const np = numeroDaVersao(versaoPagina);
  const ns = numeroDaVersao(versaoSw);
  if (np !== null && ns !== null && ns < np) return 'nada';
  if (jaRecarregouPara === versaoSw) return 'avisar'; // já recarregou para esta versão: sem laço
  if (ocupada) return 'avisar';
  return 'recarregar';
}

/** 'motor-app-v12' → 12; formato desconhecido → null. */
export function numeroDaVersao(v) {
  const m = /v(\d+)$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

/** Lê o marcador anti-laço. Storage ausente ou que lança → null. */
export function lerRecarga(storage) {
  try { return storage?.getItem(CHAVE_RECARGA) ?? null; } catch { return null; }
}

/**
 * Grava o marcador e confere se gravou. Devolve false se o armazenamento não funciona: nesse caso
 * a página NÃO deve recarregar sozinha (não teria como evitar o laço).
 */
export function marcarRecarga(storage, versao) {
  try {
    storage.setItem(CHAVE_RECARGA, versao);
    return storage.getItem(CHAVE_RECARGA) === versao;
  } catch {
    return false;
  }
}

/**
 * Executa a decisão: 'recarregar' só acontece se o marcador gravou; senão vira 'avisar'.
 * Devolve o que foi feito. `acoes` = { recarregar(), avisar() }.
 */
export function aplicarAtualizacao(p, storage, acoes) {
  let d = decidirAtualizacao({ ...p, jaRecarregouPara: lerRecarga(storage) });
  if (d === 'recarregar' && !marcarRecarga(storage, p.versaoSw)) d = 'avisar';
  if (d === 'recarregar') acoes.recarregar();
  else if (d === 'avisar') acoes.avisar();
  return d;
}
