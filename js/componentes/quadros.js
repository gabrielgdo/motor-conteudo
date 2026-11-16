// QUADROS DO STORYBOARD: as imagens (JPG de 540x960 em 4-Revisao/<id> storyboard vN/, privadas no Drive) viram
// endereços blob: no navegador, baixadas UMA vez por arquivo (no máximo 4 ao mesmo tempo, como os outros anexos) e
// esquecidas no "Sair". A tela pede `Quadros.url(arquivo)`: devolve o endereço já pronto ou null (e começa a baixar,
// se o arquivo ainda não está na fila nem baixando); quando a imagem chega (ou falha), o evento 'motor:anexo' faz a
// tela se redesenhar. Nunca põe nada do Drive no HTML: o endereço é gerado aqui (URL.createObjectURL) e o blob é
// sempre image/jpeg (um arquivo plantado com nome .jpg não vira página se alguém abrir o endereço noutra aba).

import { Integra } from '../integra.js';

const MAX_IMAGENS = 72;        // dois storyboards de 12 + 12 quadros, com folga
const AO_MESMO_TEMPO = 4;
export const chaveDoQuadro = (f) => `${f.id}:${f.modifiedTime || ''}`;

export const Quadros = {
  urls: new Map(),      // chave → endereço blob: (ordem de uso: o mais velho sai primeiro)
  erros: new Set(),     // chave que falhou (até "Tentar de novo")
  baixando: new Set(),  // chave em download agora
  fila: [],
  geracao: 0,

  /** Endereço da imagem, ou null enquanto não chegou (começa o download uma vez só). */
  url(f) {
    if (!f?.id) return null;
    const k = chaveDoQuadro(f);
    if (this.urls.has(k)) return this.urls.get(k);
    if (!this.erros.has(k) && !this.baixando.has(k) && !this.fila.some((x) => chaveDoQuadro(x) === k)) {
      this.fila.push(f);
      this.proximo();
    }
    return null;
  },

  /** 'pronto' | 'carregando' | 'erro' | 'sem-arquivo' */
  estado(f) {
    if (!f?.id) return 'sem-arquivo';
    const k = chaveDoQuadro(f);
    if (this.urls.has(k)) return 'pronto';
    return this.erros.has(k) ? 'erro' : 'carregando';
  },

  guardar(k, url) {
    const antigo = this.urls.get(k);
    if (antigo && antigo !== url) URL.revokeObjectURL(antigo);
    this.urls.delete(k);
    this.urls.set(k, url);
    while (this.urls.size > MAX_IMAGENS) {
      const [velha, u] = this.urls.entries().next().value;
      this.urls.delete(velha);
      URL.revokeObjectURL(u);
    }
  },

  proximo() {
    while (this.baixando.size < AO_MESMO_TEMPO && this.fila.length) {
      const f = this.fila.shift();
      const k = chaveDoQuadro(f);
      if (this.urls.has(k) || this.baixando.has(k)) continue;
      const g = this.geracao;
      this.baixando.add(k);
      Promise.resolve().then(() => Integra.baixarBlob(f)).then((blob) => {
        if (g !== this.geracao) return;
        this.guardar(k, URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })));
      }, () => { if (g === this.geracao) this.erros.add(k); }).finally(() => {
        if (g !== this.geracao) return;
        this.baixando.delete(k);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('motor:anexo'));
        this.proximo();
      });
    }
  },

  /** "Tentar de novo": esquece as falhas (o próximo desenho baixa de novo). */
  tentar() {
    this.erros.clear();
  },

  /** No "Sair": revoga todos os endereços e descarta os downloads em andamento. */
  liberar() {
    this.geracao++;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.erros.clear();
    this.baixando.clear();
    this.fila = [];
  },
};
