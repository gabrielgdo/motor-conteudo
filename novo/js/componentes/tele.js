// Teleprompter (sempre escuro). Usado pela tela Roteiros (parte 2): Tele.abrir(roteiro).
// Os tamanhos da letra estão em "px de referência" (30/46, de 22 a 72, passo 4) e são aplicados
// em rem, para que no computador (html a 80%) fique igual ao desenho aprovado a 80% de zoom.

import { $, esc, ic, NOME_REDE, rem } from '../util.js';

export const Tele = {
  tocando: false, vel: 5, tam: 40, pos: 0, antes: 0, quadro: null, palavras: 1, ritmo: 20,
  /* Velocidade 5 = 150 palavras por minuto, o ritmo de fala usado nos roteiros.
     O ritmo em pixels por segundo sai da altura medida do texto, então vale para qualquer tela e letra. */
  medir() {
    const rolo = $('#tele-rolo');
    if (!rolo) return;
    const cs = getComputedStyle(rolo);
    this.ritmo = (rolo.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / (this.palavras / 2.5);
  },
  abrir(r) {
    const d = $('#tele');
    if (!r || !d) return;
    const frases = (texto) => texto.replace(/([.!?:])\s+/g, '$1\n').split('\n').filter(Boolean);
    this.tam = window.innerWidth < 720 ? 30 : 46;
    this.pos = 0;
    this.tocando = false;
    this.palavras = Math.max(1, r.falas.reduce((n, f) => n + f.texto.split(/\s+/).length, 0));
    // Rótulo de cada trecho que só existe numa rede. No formato novo com TikTok próprio, um
    // rótulo no começo de cada versão; no formato com etiquetas, como no desenho aprovado.
    let redeAnterior = null;
    const rotulo = (f) => {
      if (!f.rede) { redeAnterior = null; return ''; }
      if (r.formatoRoteiro === 'novo') {
        if (f.rede === redeAnterior) return '';
        redeAnterior = f.rede;
        return `<p class="tele-parte">Versão do ${NOME_REDE[f.rede]}</p>`;
      }
      const parte = f.parte === 'Gancho' ? 'Abertura' : f.parte;
      return `<p class="tele-parte">${esc(parte)} para o ${NOME_REDE[f.rede]}</p>`;
    };
    d.innerHTML = `<div class="tele-caixa">
      <div class="tele-topo"><span>${esc(r.id)}, ${esc(r.curto)}</span><button type="button" class="redondo" data-acao="tele-fechar" aria-label="Fechar o teleprompter">${ic('fechar')}</button></div>
      <div class="tele-meio"><div class="tele-rolo" id="tele-rolo" tabindex="0" aria-label="Texto do roteiro" style="font-size:${rem(this.tam)}">
        ${r.falas.map((f) => rotulo(f) + frases(f.texto).map((s) => `<p>${esc(s)}</p>`).join('')).join('')}
      </div><span class="tele-guia" aria-hidden="true"></span></div>
      <div class="tele-pe">
        <button type="button" class="botao" data-acao="tele-alternar" id="tele-botao">${ic('play', 18)} Rolar</button>
        <button type="button" class="botao sec" data-acao="tele-reiniciar">Do começo</button>
        <label>Velocidade <input type="range" id="tele-vel" min="1" max="10" step="1" value="${this.vel}"></label>
        <span><button type="button" class="botao sec" data-acao="tele-tamanho" data-valor="-4" aria-label="Diminuir a letra">A−</button> <button type="button" class="botao sec" data-acao="tele-tamanho" data-valor="4" aria-label="Aumentar a letra">A+</button></span>
      </div></div>`;
    d.showModal();
    $('#tele-rolo').addEventListener('scroll', (ev) => { if (!this.tocando) this.pos = ev.target.scrollTop; });
  },
  alternar() {
    this.tocando = !this.tocando;
    const b = $('#tele-botao');
    if (b) b.innerHTML = this.tocando ? `${ic('pausa', 18)} Pausar` : `${ic('play', 18)} Rolar`;
    cancelAnimationFrame(this.quadro);
    if (this.tocando) { this.medir(); this.antes = performance.now(); this.pos = $('#tele-rolo').scrollTop; this.rolar(); }
  },
  rolar() {
    this.quadro = requestAnimationFrame((agora) => {
      const rolo = $('#tele-rolo');
      if (!rolo || !this.tocando) return;
      this.pos += ((agora - this.antes) / 1000) * this.ritmo * (this.vel / 5);
      this.antes = agora;
      rolo.scrollTop = this.pos;
      if (rolo.scrollTop + rolo.clientHeight >= rolo.scrollHeight - 2) { this.alternar(); return; }
      this.rolar();
    });
  },
  parar() { if (this.tocando) this.alternar(); },
  reiniciar() { this.parar(); this.pos = 0; const rolo = $('#tele-rolo'); if (rolo) rolo.scrollTop = 0; },
  tamanho(passo) {
    this.tam = Math.max(22, Math.min(72, this.tam + passo));
    const rolo = $('#tele-rolo');
    if (rolo) rolo.style.fontSize = rem(this.tam);
    this.medir();
  },
  fechar() { const d = $('#tele'); if (d?.open) d.close(); },
  /** Liga as escutas do diálogo (uma vez, no início). */
  ligar() {
    const d = $('#tele');
    d.addEventListener('close', () => { this.tocando = false; cancelAnimationFrame(this.quadro); d.innerHTML = ''; });
    document.addEventListener('input', (ev) => { if (ev.target.id === 'tele-vel') this.vel = +ev.target.value; });
    document.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && d.open && !ev.target.closest('button, input')) { ev.preventDefault(); this.alternar(); }
    });
  },
};
