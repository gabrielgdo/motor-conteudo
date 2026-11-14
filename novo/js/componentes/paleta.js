// Busca rápida (Ctrl K ou ⌘K): ir para qualquer tela ou roteiro, ou fazer uma ação.

import { $, esc, ic, semAcento } from '../util.js';
import { estado } from '../estado.js';
import { ativos } from '../dados.js';
import { NAVEGACAO } from '../roteador.js';
import { destinoDe } from '../telas/pecas.js';
import { abrirJanela, fecharJanela } from './janelas.js';
import { Tema } from '../visual.js';
import { executar } from '../acoes.js';

export const Paleta = {
  termo: '', i: 0,
  itens() {
    return [
      ...NAVEGACAO.map((n) => ({ grupo: 'Telas', rotulo: n.rotulo, icone: n.icone, ir: '#/' + n.rota })),
      { grupo: 'Telas', rotulo: 'Enviar gravação', icone: 'enviar', ir: '#/enviar' },
      ...ativos().map((r) => ({
        grupo: 'Roteiros e vídeos', rotulo: r.titulo, extra: r.id,
        icone: ['rascunho', 'mudanca', 'aprovado'].includes(r.etapa) ? 'roteiros' : r.etapa === 'pronto' ? 'prontos' : 'videos',
        ir: destinoDe(r),
      })),
      { grupo: 'Ações', rotulo: 'Atualizar com o Drive', icone: 'atualizar', acao: 'atualizar' },
      { grupo: 'Ações', rotulo: `Mudar para o tema ${Tema.atual === 'noite' ? 'Dia' : 'Noite'}`, icone: Tema.atual === 'noite' ? 'sol' : 'lua', acao: 'tema' },
      { grupo: 'Ações', rotulo: 'Sobre o app', icone: 'info', acao: 'abrir-sobre' },
      { grupo: 'Ações', rotulo: 'Sair', icone: 'sair', acao: 'sair' },
    ];
  },
  filtrados() {
    const t = semAcento(this.termo.trim());
    return this.itens().filter((x) => !t || semAcento(`${x.rotulo} ${x.extra || ''}`).includes(t));
  },
  lista() {
    const itens = this.filtrados();
    let grupo = '';
    if (!itens.length) return '<p class="vazio">Nada encontrado com esse nome.</p>';
    return itens.map((x, i) => `${x.grupo !== grupo ? `<div class="paleta-grupo" role="presentation">${esc(grupo = x.grupo)}</div>` : ''}<button type="button" class="paleta-item" role="option" id="paleta-${i}" aria-selected="${i === this.i}" tabindex="-1" data-acao="paleta-ir" data-valor="${i}">${ic(x.icone, 20)}${esc(x.rotulo)}${x.extra ? `<span>${esc(x.extra)}</span>` : ''}</button>`).join('');
  },
  abrir() {
    if ($('#tele').open || !estado.logada) return;
    this.termo = '';
    this.i = 0;
    abrirJanela(`<h2 class="vh" id="dlg-titulo">Ir para</h2>
      <div class="paleta-campo">${ic('pautas', 22)}<input id="paleta-campo" type="text" role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list" aria-label="Ir para" placeholder="Ir para uma tela, um roteiro ou uma ação" autocomplete="off"></div>
      <div class="paleta-lista" id="paleta-lista" role="listbox" aria-label="Destinos">${this.lista()}</div>`, 'paleta');
    $('#paleta-campo').focus();
  },
  pintar() {
    $('#paleta-lista').innerHTML = this.lista();
    const atual = $('#paleta-' + this.i);
    if (atual) { atual.scrollIntoView({ block: 'nearest' }); $('#paleta-campo').setAttribute('aria-activedescendant', atual.id); }
  },
  ir(i) {
    const x = this.filtrados()[i];
    if (!x) return;
    fecharJanela();
    if (x.ir) location.hash = x.ir;
    else executar(x.acao);
  },
  /** Escutas gerais (uma vez). */
  ligar() {
    document.addEventListener('input', (ev) => { if (ev.target.id === 'paleta-campo') { this.termo = ev.target.value; this.i = 0; this.pintar(); } });
    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && estado.logada) { ev.preventDefault(); this.abrir(); return; }
      if (ev.target.id !== 'paleta-campo') return;
      const n = this.filtrados().length;
      if (n && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); this.i = (this.i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n; this.pintar(); }
      if (ev.key === 'Enter') { ev.preventDefault(); this.ir(this.i); }
    });
  },
};
