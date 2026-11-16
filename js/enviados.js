// DECISÕES ENVIADAS E AINDA NÃO VISTAS NO DRIVE (puro, sem DOM nem rede; o storage é passado). A escolha do gancho e a
// decisão do storyboard só aparecem no Drive quando o motor sobe o arquivo; até lá, o app mostra o registro otimista
// ("Gancho 2 escolhido", "Storyboard aprovado"). Antes ele vivia só na memória: se o app recarregasse nesse intervalo
// (o iPhone fecha o app em segundo plano, a recarga da versão nova, puxar para atualizar), os botões voltavam e ela
// podia decidir de novo, e a segunda decisão sumia sem aviso (vale a primeira). Agora fica também no localStorage do
// aparelho, preso à conta que decidiu e com o mesmo prazo de 2 h dos registros otimistas; a chave começa por "motor."
// e sai no "Sair" (js/auth.js).
//
//   lerEnviados(storage, email, agora)                  → {ganchos: {id: reg}, storyboards: {id: reg}} da conta e no prazo
//   guardarEnviado(storage, email, tipo, id, reg, agora) grava um (tipo 'ganchos' | 'storyboards'); nunca lança

export const CHAVE_ENVIADOS = 'motor.enviados';
/** O mesmo prazo de ESPERA_GANCHO_MS e ESPERA_STORYBOARD_MS: depois disso o registro otimista não vale mais. */
export const VALIDADE_ENVIADOS_MS = 2 * 60 * 60 * 1000;
const TIPOS = ['ganchos', 'storyboards'];

const minusc = (s) => String(s ?? '').trim().toLowerCase();

function noPrazo(reg, agora) {
  const desde = Number(reg?.desde);
  return Number.isFinite(desde) && desde <= agora + 60 * 1000 && agora - desde < VALIDADE_ENVIADOS_MS;
}

function lerBruto(storage) {
  try {
    const v = JSON.parse(storage?.getItem(CHAVE_ENVIADOS) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Os registros da conta `email` ainda no prazo. Outra conta, nada guardado, JSON quebrado ou storage que lança: vazio. */
export function lerEnviados(storage, email, agora = Date.now()) {
  const out = { ganchos: {}, storyboards: {} };
  const v = lerBruto(storage);
  if (!v || !minusc(email) || minusc(v.email) !== minusc(email)) return out;
  for (const tipo of TIPOS) {
    for (const [id, reg] of Object.entries(v[tipo] || {})) {
      if (reg && typeof reg === 'object' && noPrazo(reg, agora)) out[tipo][id] = { ...reg };
    }
  }
  return out;
}

/** Grava o registro `reg` ({versao, escolha|decisao, desde}) do id; tira os vencidos e os de outra conta. → true se gravou. */
export function guardarEnviado(storage, email, tipo, id, reg, agora = Date.now()) {
  if (!storage || !minusc(email) || !TIPOS.includes(tipo) || !id || !reg) return false;
  const atual = lerEnviados(storage, email, agora);
  atual[tipo][id] = { ...reg };
  try {
    storage.setItem(CHAVE_ENVIADOS, JSON.stringify({ email: minusc(email), ...atual }));
    return true;
  } catch {
    return false; // modo privado ou sem espaço: fica só na memória, como antes
  }
}
