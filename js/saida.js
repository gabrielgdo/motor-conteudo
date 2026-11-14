// A ordem do "Sair" (puro: os passos chegam de fora, os testes usam direto).
//
// 1. encerrar: apaga a sessão e as chaves do app no armazenamento (síncrono, nunca depende do Google)
// 2. marcar a saída em sessionStorage (a página recarregada abre na entrada, com a mensagem, se houver)
// 3. mostrarEntrada: troca para a tela de entrada na hora
// 4. limpezas: janelas, teleprompter, vídeos, downloads, dados e estado em memória
// 5. desligar: revoga o token no Google, sem esperar resposta (o GIS pode nem ter carregado)
// 6. recarregar: location.replace para o endereço do app sem rota, para nada da conta ficar em
//    memória (nem no bfcache do iPhone) e para a página já vir com a versão publicada
// Cada passo roda num try/catch: um passo que falha não impede os outros.

/** Chave em sessionStorage gravada DEPOIS da limpeza: "acabou de sair" (+ mensagem para a entrada). */
export const CHAVE_SAIDA = 'motor.saiu';

/** sessionStorage, ou null se o navegador bloquear o acesso (o acesso pode lançar SecurityError). */
export function sessaoSegura() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

/** Endereço da entrada: origem + caminho, sem rota (#/...) nem parâmetros. */
export function urlDaEntrada(loc) {
  return `${loc.origin}${loc.pathname}`;
}

export function marcarSaida(storage, mensagem = '') {
  if (!storage) return false;
  try { storage.setItem(CHAVE_SAIDA, JSON.stringify({ mensagem: String(mensagem || '') })); return true; } catch { return false; }
}

/** Lê e apaga a marca de saída. Devolve null (não saiu) ou { mensagem }. Nunca lança. */
export function tirarSaida(storage) {
  let bruto = null;
  try { bruto = storage?.getItem(CHAVE_SAIDA) ?? null; } catch { return null; }
  if (bruto === null) return null;
  try { storage.removeItem(CHAVE_SAIDA); } catch { /* fica; a próxima abertura também começa na entrada */ }
  try { const o = JSON.parse(bruto); return { mensagem: typeof o?.mensagem === 'string' ? o.mensagem : '' }; } catch { return { mensagem: '' }; }
}

/**
 * Executa o "Sair" na ordem acima. Devolve { erros: [{passo, erro}] } (para teste e diagnóstico).
 * passos = { encerrar() → token, mostrarEntrada(), limpezas: [fn], desligar(token), recarregar(), storage, mensagem }
 */
export function executarSaida(passos) {
  const erros = [];
  const tentar = (nome, fn) => {
    try { return fn(); } catch (erro) { erros.push({ passo: nome, erro }); return undefined; }
  };
  const token = tentar('encerrar', () => passos.encerrar?.());
  tentar('marcar', () => marcarSaida(passos.storage, passos.mensagem));
  tentar('mostrarEntrada', () => passos.mostrarEntrada?.());
  (passos.limpezas || []).forEach((fn, i) => tentar(`limpeza ${i}`, fn));
  tentar('desligar', () => passos.desligar?.(token));
  tentar('recarregar', () => passos.recarregar?.());
  return { erros };
}
