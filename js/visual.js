// CAMADA VISUAL. Nada aqui é necessário para o app funcionar: é o acabamento (véu em WebGL,
// tema Noite e Dia, luz que segue o ponteiro). Pode ser trocado sem mexer nas telas nem nas integrações.

import { $, ic } from './util.js';

/* ---- O véu: fundo vivo pintado por um shader WebGL, sem biblioteca ----
   O desenho é ruído suave dobrado sobre si mesmo (domain warping), o que dá o aspecto de
   seda em movimento lento. As quatro cores vêm do tema. Para poupar bateria, o canvas é
   pintado com metade da resolução, a 30 quadros por segundo, e para quando sai da tela,
   quando a aba fica escondida ou quando o sistema pede menos movimento. */
const VEU_FRAGMENTO = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_r; uniform float u_t; uniform vec3 u_a, u_b, u_c, u_d;
float sorte(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruido(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(sorte(i), sorte(i + vec2(1., 0.)), f.x), mix(sorte(i + vec2(0., 1.)), sorte(i + vec2(1., 1.)), f.x), f.y);
}
float camadas(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * ruido(p); p = p * 2.03 + vec2(11.3, 7.1); a *= .5; } return v; }
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * u_r) / u_r.y; float t = u_t * .045;
  vec2 q = vec2(camadas(p * 1.1 + vec2(0., t)), camadas(p * 1.1 + vec2(5.2, 1.3 - t)));
  vec2 w = vec2(camadas(p * 1.3 + 2.6 * q + vec2(1.7, 9.2) + t * .6), camadas(p * 1.3 + 2.6 * q + vec2(8.3, 2.8) - t * .4));
  float f = camadas(p * 1.2 + 3. * w);
  vec3 cor = mix(u_a, u_b, smoothstep(.2, .78, f));
  cor = mix(cor, u_c, smoothstep(.42, 1., length(w)) * .85);
  cor = mix(cor, u_d, pow(smoothstep(.52, .98, q.y), 2.) * .42);
  cor += u_d * pow(abs(sin(f * 16. + w.y * 5.)), 14.) * .05;      /* fios de luz, como dobras de tecido */
  gl_FragColor = vec4(cor, 1.);
}`;

export const Veu = {
  gl: null, u: {}, parado: false, visivel: true, antes: 0, quadro: 0,
  PALETAS: { noite: ['#0F0809', '#3A1019', '#8E2F40', '#EFB7A6'], dia: ['#F3E8E2', '#EFD6CE', '#DFAEA1', '#FFFCFA'] },
  iniciar() {
    const tela = $('#veu'); const falhou = () => tela.classList.add('sem-gl'); // sem WebGL: degradê parado, em CSS
    let gl = null;
    try { gl = tela.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch { /* segue sem WebGL */ }
    if (!gl) return falhou();
    const compilar = (tipo, fonte) => { const s = gl.createShader(tipo); gl.shaderSource(s, fonte); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vertice = compilar(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }');
    const fragmento = compilar(gl.FRAGMENT_SHADER, VEU_FRAGMENTO);
    if (!vertice || !fragmento) return falhou();
    const prog = gl.createProgram();
    gl.attachShader(prog, vertice); gl.attachShader(prog, fragmento); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return falhou();
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // um triângulo cobre a tela inteira
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    ['r', 't', 'a', 'b', 'c', 'd'].forEach((n) => { this.u[n] = gl.getUniformLocation(prog, 'u_' + n); });
    this.gl = gl;
    this.parado = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => this.medir()).observe(tela);
    new IntersectionObserver((es) => { this.visivel = es[0].isIntersecting; this.ligar(); }).observe(tela);
    document.addEventListener('visibilitychange', () => this.ligar());
    tela.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); this.gl = null; falhou(); });
    this.medir();
  },
  medir() {
    if (!this.gl) return;
    // clientWidth/Height já estão em px de tela: a metade da resolução vale em qualquer densidade.
    const tela = this.gl.canvas; const w = Math.max(160, Math.round(tela.clientWidth * 0.5)); const h = Math.max(120, Math.round(tela.clientHeight * 0.5));
    if (tela.width !== w || tela.height !== h) { tela.width = w; tela.height = h; this.gl.viewport(0, 0, w, h); }
    this.pintar(performance.now());
  },
  cores(tema) {
    if (!this.gl) return;
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    this.PALETAS[tema].forEach((hex, i) => this.gl.uniform3fv(this.u['abcd'[i]], rgb(hex)));
    this.pintar(performance.now());
  },
  pintar(agora) {
    const gl = this.gl;
    if (!gl) return;
    gl.uniform2f(this.u.r, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(this.u.t, this.parado ? 12 : agora / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },
  ligar() {
    cancelAnimationFrame(this.quadro);
    if (!this.gl || this.parado || !this.visivel || document.hidden) return;
    const passo = (agora) => { this.quadro = requestAnimationFrame(passo); if (agora - this.antes < 33) return; this.antes = agora; this.pintar(agora); };
    this.quadro = requestAnimationFrame(passo);
  },
};

/* ---- Tema Noite e Dia ---- */
export const Tema = {
  atual: 'noite',
  aplicar(tema) {
    this.atual = tema;
    document.documentElement.dataset.tema = tema;
    $('#meta-tema').content = tema === 'noite' ? '#0F0809' : '#F3E8E2';
    const b = $('#botao-tema'); const outro = tema === 'noite' ? 'Dia' : 'Noite';
    b.innerHTML = ic(tema === 'noite' ? 'sol' : 'lua');
    b.setAttribute('aria-label', `Mudar para o tema ${outro}`);
    b.title = `Tema ${outro}`;
    try { localStorage.setItem('motor-tema', tema); } catch { /* sem armazenamento: o tema só não é lembrado */ }
    Veu.cores(tema);
  },
  alternar() { this.aplicar(this.atual === 'noite' ? 'dia' : 'noite'); },
  lembrado() {
    try { return localStorage.getItem('motor-tema') === 'dia' ? 'dia' : 'noite'; } catch { return 'noite'; }
  },
};

/* ---- Luz que segue o ponteiro nos cartões com a classe "luz" (só com mouse) ----
   --mx/--my são posições medidas em px de tela, por isso continuam em px. */
export function ligarLuz() {
  if (!matchMedia('(hover: hover)').matches) return;
  document.addEventListener('pointermove', (ev) => {
    const el = ev.target.closest && ev.target.closest('.luz');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
    el.style.setProperty('--my', `${ev.clientY - r.top}px`);
  }, { passive: true });
}
