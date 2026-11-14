// Downloads dos pacotes (tela Prontos): cada arquivo ORIGINAL do Drive (Integra.baixarBlob) salvo
// com o nome original (subpastas como "carrossel-01.png"). O botão mostra o andamento enquanto baixa.
// "Baixar tudo" baixa um por um (sem zip), com aviso do andamento e resumo no fim.
// Limite: cada arquivo passa inteiro pela memória antes de ser salvo (vídeos grandes pesam no celular).

import { $, esc, ic } from '../util.js';
import { Integra } from '../integra.js';
import { nomeDownload } from '../parse.js';
import { avisar, avisoFixo, removerAviso, salvarBlob } from './janelas.js';

const ehIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const Downloads = {
  andando: new Map(), // id do arquivo → % (ou null se o tamanho não é conhecido)
  geracao: 0, // sobe ao sair da conta: o que estava baixando não é mais salvo
  tudo: null, // {id do roteiro, i, n} enquanto "Baixar tudo" roda

  /** Botão redondo de baixar um arquivo do pacote. `a` = item de r.pacote.arquivos. */
  botao(r, a) {
    const id = a.file.id;
    const baixando = this.andando.has(id);
    const pct = this.andando.get(id);
    return `<button type="button" class="redondo" data-acao="baixar-arquivo" data-id="${esc(r.id)}" data-valor="${esc(id)}" data-baixar="${esc(id)}" aria-label="${baixando ? `Baixando ${esc(a.tipo)}` : `Baixar ${esc(a.tipo)}`}" ${baixando ? 'disabled aria-busy="true"' : ''}>${baixando ? `<span class="baixando">${Number.isFinite(pct) ? `${pct}%` : '…'}</span>` : ic('prontos', 18)}</button>`;
  },

  /** Rótulo do "Baixar tudo" (muda enquanto baixa). */
  rotuloTudo(r) {
    const t = this.tudo;
    return t && t.id === r.id ? `Baixando ${t.i} de ${t.n}…` : 'Baixar tudo';
  },

  pintar(id) {
    document.querySelectorAll(`[data-baixar="${CSS.escape(id)}"]`).forEach((b) => {
      const baixando = this.andando.has(id);
      const pct = this.andando.get(id);
      b.disabled = baixando;
      b.toggleAttribute('aria-busy', baixando);
      b.innerHTML = baixando ? `<span class="baixando">${Number.isFinite(pct) ? `${pct}%` : '…'}</span>` : ic('prontos', 18);
    });
  },

  pintarTudo(r) {
    const b = $(`[data-baixar-tudo="${CSS.escape(r.id)}"]`);
    if (!b) return;
    b.disabled = !!this.tudo;
    b.toggleAttribute('aria-busy', this.tudo?.id === r.id);
    b.lastChild.textContent = ` ${this.rotuloTudo(r)}`;
  },

  /** Baixa e salva um arquivo. Devolve true se deu certo; lança o erro do Drive se não. */
  async baixar(a) {
    const id = a.file.id;
    if (this.andando.has(id)) return false;
    const ger = this.geracao;
    this.andando.set(id, null);
    this.pintar(id);
    try {
      const blob = await Integra.baixarBlob(a.file, {
        aoProgresso: (recebido, total) => {
          if (ger !== this.geracao) return;
          const pct = total ? Math.min(99, Math.floor((recebido / total) * 100)) : null;
          if (pct !== this.andando.get(id)) { this.andando.set(id, pct); this.pintar(id); }
        },
      });
      if (ger !== this.geracao) return false; // saiu da conta no meio do download
      salvarBlob(blob, nomeDownload(a.file.name, a.file.sub));
      return true;
    } finally {
      if (ger === this.geracao) {
        this.andando.delete(id);
        this.pintar(id);
      }
    }
  },

  /** Baixa todos os arquivos do pacote, um por um. */
  async baixarTudo(r) {
    if (this.tudo) { avisar('Já estou baixando um pacote. Espere terminar.'); return; }
    const lista = r.pacote?.arquivos || [];
    if (!lista.length) return;
    let falhas = 0;
    const ger = this.geracao;
    this.tudo = { id: r.id, i: 0, n: lista.length };
    try {
      for (const a of lista) {
        if (ger !== this.geracao) return; // saiu da conta: para sem avisar
        this.tudo.i += 1;
        this.pintarTudo(r);
        avisoFixo('baixar-tudo', `Baixando ${this.tudo.i} de ${lista.length}…`, { calmo: true, icone: 'prontos' });
        try { await this.baixar(a); } catch { falhas += 1; }
      }
    } finally {
      if (ger === this.geracao) {
        this.tudo = null;
        removerAviso('baixar-tudo');
        this.pintarTudo(r);
      }
    }
    if (ger !== this.geracao) return;
    const n = lista.length;
    if (!falhas) avisar(n === 1 ? 'O arquivo foi baixado.' : `Os ${n} arquivos foram baixados.`);
    else if (ehIphone()) avisar(`Baixei ${n - falhas} de ${n}. No iPhone, vários downloads seguidos podem ser bloqueados: baixe os que faltaram um por um.`);
    else avisar(`Baixei ${n - falhas} de ${n}. ${falhas === 1 ? 'Um arquivo falhou' : `${falhas} arquivos falharam`}: tente de novo pelo botão de cada um.`);
  },

  /** Ao sair da conta: esquece os downloads em andamento (nada mais é salvo nem avisado). */
  liberar() {
    this.geracao++;
    this.andando.clear();
    this.tudo = null;
    removerAviso('baixar-tudo');
  },
};
