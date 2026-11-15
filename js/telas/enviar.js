// ENVIAR GRAVAÇÃO (#/enviar e #/enviar/<id>). A escolha do roteiro é a do desenho aprovado. O vídeo
// vai direto pelo app (Integra.drive.enviarVideo: envio retomável para 3-Brutos com o nome
// `<id>.<ext>`, conferido no Drive antes de dizer "concluído"); o passo a passo pelo app do Google
// Drive continua como alternativa. As ações do envio (envio-*) ficam aqui, num listener próprio,
// junto do estado do envio (como o "Tentar de novo" do andamento em videos.js).

import { esc, ic, validade } from '../util.js';
import { estado, rascunho } from '../estado.js';
import { Integra } from '../integra.js';
import { porEtapa, carregar } from '../dados.js';
import { podeDecidir } from '../controle.js';
import { formatarBytes } from '../parse.js';
import { nomeFinalDoBruto, textoProgresso } from '../envio-video.js';
import { cab, selo, comDados, vazio, linkDoDrive } from './pecas.js';

const enc = encodeURIComponent;
const temNavegador = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Estado do envio desta tela (um por vez). `ctl` = controle devolvido por enviarVideo. */
let ui = vazioUi();
function vazioUi() {
  return { id: '', nome: '', fase: '', mensagem: '', recuperacao: '', prog: null, ctl: null, resultado: null };
}

const FASES_ATIVAS = new Set(['renovando', 'verificando', 'iniciando', 'enviando', 'pausado', 'aguardando-rede', 'reiniciando', 'conferindo']);
const TEXTO_FASE = {
  renovando: 'Confirmando o acesso ao Google…',
  verificando: 'Conferindo a pasta 3-Brutos…',
  iniciando: 'Abrindo o envio…',
  enviando: 'Enviando…',
  pausado: 'Pausado. Toque em Continuar quando quiser.',
  'aguardando-rede': 'Sem conexão estável. O envio continua sozinho quando a internet voltar.',
  reiniciando: 'A sessão de envio expirou. Recomeçando do zero…',
  conferindo: 'Conferindo o arquivo no Drive…',
};
const enviando = () => !!ui.ctl;
const C_ANEL = 2 * Math.PI * 52;

/* ------------------------------------------------------------------ tela */

export function vEnviar(idDaRota) {
  return comDados(() => {
    const opcoes = porEtapa('aprovado');
    const resultado = ui.resultado ? blocoResultado() : '';
    if (!opcoes.length) {
      return `${cab('Enviar gravação')}${resultado}<div class="painel">${vazio('Nenhum roteiro esperando gravação', 'Aprove um roteiro e ele aparece aqui para receber o vídeo.', '<a class="botao contorno" href="#/roteiros">Ver os roteiros</a>')}</div>`;
    }
    // Link do tipo #/enviar/S47-02: já chega com o roteiro escolhido.
    if (!enviando() && idDaRota && rascunho['envio-rota'] !== idDaRota && opcoes.some((r) => r.id === idDaRota)) { rascunho['envio-id'] = idDaRota; rascunho['envio-rota'] = idDaRota; }
    if (enviando()) rascunho['envio-id'] = ui.id; // durante o envio, o roteiro fica preso ao que está subindo
    if (!opcoes.some((r) => r.id === rascunho['envio-id'])) rascunho['envio-id'] = enviando() ? ui.id : opcoes[0].id;
    const escolhido = rascunho['envio-id'];
    const pasta = linkDoDrive(Integra.pasta('brutos'), 'Abrir a pasta 3-Brutos');
    const travado = enviando() ? 'disabled' : '';
    return `
  ${cab('Enviar gravação', 'O vídeo vai direto para a edição, no tamanho original.')}
  ${resultado}
  <div class="envio">
    <section class="painel" aria-labelledby="t-qual">
      <fieldset class="grupo"><legend><h2 id="t-qual" style="margin-bottom:.875rem">Qual roteiro você gravou?</h2></legend>
      <div class="escolhas">${opcoes.map((r) => { const v = validade(r); return `<label class="escolha"><input type="radio" name="envio-id" data-modelo="envio-id" data-redesenhar value="${esc(r.id)}" ${r.id === escolhido ? 'checked' : ''} ${travado}>
        <span class="escolha-texto"><strong>${esc(r.titulo)}</strong><span class="meta"><span class="id">${esc(r.id)}</span>${v.perto ? selo(v.texto, 'alerta') : ''}${r.teste ? selo('Teste') : ''}</span></span></label>`; }).join('')}</div>
      </fieldset>
    </section>
    <section class="painel pilha" aria-labelledby="t-video">
      <h2 id="t-video">O vídeo</h2>
      ${blocoEnvioDireto(escolhido)}
      <h3 class="envio-alternativa">Ou pelo app do Google Drive</h3>
      <p class="nota calma">${ic('info')}<span>Envie o vídeo pelo app do Google Drive para a pasta 3-Brutos, com o nome <strong>${esc(escolhido)}.&lt;extensão&gt;</strong> (ex.: ${esc(escolhido)}.mov). O motor reconhece o roteiro pelo nome.</span></p>
      <div class="botoes">
        <button type="button" class="botao contorno" data-acao="copiar-nome" data-id="${esc(escolhido)}">${ic('copiar', 18)} Copiar o nome</button>
        ${pasta.replace('<a ', '<a class="botao calmo" ')}
      </div>
    </section>
  </div>`;
  });
}

/** Escolher arquivo → nome final → Enviar; ou o progresso do envio em andamento; ou o erro. */
export function blocoEnvioDireto(id, { email = Integra.email() } = {}) {
  if (!podeDecidir(email)) {
    return `<p class="nota calma">${ic('info')}<span>Só a conta da Robertta envia o vídeo pelo app. Com esta conta, acompanhe a edição em Vídeos.</span></p>`;
  }
  if (enviando() || FASES_ATIVAS.has(ui.fase)) return blocoProgresso();
  const a = estado.arquivo;
  const erro = ui.fase === 'erro' && ui.id === id
    ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(ui.mensagem)}${ui.recuperacao ? ` ${esc(ui.recuperacao)}` : ''}</span></p>` : '';
  const cancelado = ui.fase === 'cancelado' && ui.id === id ? `<p class="nota calma" role="status">${ic('info')}<span>${esc(ui.mensagem || 'Envio cancelado.')}</span></p>` : '';
  if (!a) {
    return `${erro}${cancelado}<div class="solte">
        <span class="solte-icone">${ic('camera', 30)}</span>
        <strong>Escolha o vídeo</strong>
        <p class="meta">mp4, mov ou m4v, como saiu da câmera. Vai para 3-Brutos como <strong>${esc(id)}.mov</strong> (ou .mp4).</p>
        <button type="button" class="botao primario" data-acao="envio-escolher">${ic('enviar', 18)} Escolher o vídeo</button>
      </div>`;
  }
  const n = nomeFinalDoBruto(id, a.nome);
  const final = n.ok
    ? `<p>Vai para <strong>3-Brutos</strong> como <strong class="envio-nome">${esc(n.nome)}</strong></p>`
    : `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(n.mensagem)}</span></p>`;
  return `${erro}${cancelado}<div class="arquivo">
        <span class="arquivo-icone">${ic('camera', 22)}</span>
        <span class="arquivo-texto"><strong>${esc(a.nome)}</strong><span class="meta">${esc(formatarBytes(a.total))}</span></span>
        <button type="button" class="botao calmo menor" data-acao="envio-escolher">Trocar</button>
      </div>
      ${final}
      ${n.ok ? `<p class="nota calma">${ic('info')}<span>Mantenha o app aberto até terminar. No iPhone, se você sair do app, o envio pausa e continua quando você voltar.</span></p>
      <button type="button" class="botao primario cheio" data-acao="envio-enviar" data-id="${esc(id)}">${ic('enviar', 18)} Enviar para a edição</button>` : ''}`;
}

function blocoProgresso() {
  const p = textoProgresso(ui.prog || {}, formatarBytes);
  const parado = ui.fase === 'pausado' || ui.fase === 'aguardando-rede';
  const fase = ui.mensagem && (ui.fase === 'aguardando-rede' || ui.fase === 'reiniciando') ? ui.mensagem : (TEXTO_FASE[ui.fase] || 'Preparando…');
  const pausa = ui.fase === 'pausado'
    ? `<button type="button" class="botao contorno" data-acao="envio-continuar">${ic('play', 18)} Continuar</button>`
    : `<button type="button" class="botao contorno" data-acao="envio-pausar" ${ui.fase === 'enviando' || ui.fase === 'aguardando-rede' ? '' : 'disabled'}>${ic('pausa', 18)} Pausar</button>`;
  return `<div class="subida${parado ? ' parado' : ''}" id="envio-subida">
      <div class="anel" role="progressbar" aria-label="Envio do vídeo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" id="envio-anel">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trilho" cx="60" cy="60" r="52"/><circle class="valor" id="envio-anel-valor" cx="60" cy="60" r="52" stroke-dasharray="${C_ANEL.toFixed(2)}" stroke-dashoffset="${(C_ANEL * (1 - p.pct / 100)).toFixed(2)}"/></svg>
        <div class="anel-meio"><b id="envio-pct">${p.pct}%</b><span>enviado</span></div>
      </div>
      <div class="pilha">
        <p><strong class="envio-nome">${esc(ui.nome)}</strong> → 3-Brutos</p>
        <p id="envio-fase" role="status" aria-live="polite">${esc(fase)}</p>
        <div class="envio-numeros" id="envio-numeros"><span>${esc(p.feito)}</span><span>${esc(p.velocidade)}</span><span>faltam ${esc(p.restante)}</span></div>
        <p class="nota atencao">${ic('alerta')}<span>Mantenha o app aberto até terminar.</span></p>
        <div class="botoes">
          ${pausa}
          <button type="button" class="botao calmo" data-acao="envio-cancelar" ${ui.fase === 'conferindo' ? 'disabled' : ''}>${ic('fechar', 18)} Cancelar</button>
        </div>
      </div>
    </div>`;
}

function blocoResultado() {
  const r = ui.resultado;
  const id = ui.id;
  const texto = r.jaEstava
    ? `Este vídeo já estava em 3-Brutos como <strong>${esc(r.arquivo?.name || r.nome)}</strong> (mesmo nome e tamanho): nada foi enviado de novo.`
    : `<strong>${esc(r.arquivo?.name || r.nome)}</strong> está em 3-Brutos e foi conferido no Drive (${esc(formatarBytes(r.arquivo?.size || 0))}). O motor começa a edição em alguns minutos.`;
  const dup = r.duplicados
    ? `<p class="nota atencao">${ic('alerta')}<span>Há mais de um vídeo de ${esc(id)} em 3-Brutos. Fale com o Diretor ou apague o que sobra no Drive.</span></p>` : '';
  return `<section class="painel pilha" aria-labelledby="t-enviado" style="margin-bottom:1rem">
    <h2 id="t-enviado">Vídeo enviado</h2>
    <p class="nota ok" role="status">${ic('check')}<span>${texto}</span></p>
    ${dup}
    <div class="botoes">
      <a class="botao primario" href="#/videos/${esc(enc(id))}">Acompanhar em Vídeos</a>
      <button type="button" class="botao calmo" data-acao="envio-limpar">Fechar</button>
    </div>
  </section>`;
}

/* --------------------------------------------------------------- ações */

const redesenhar = () => window.dispatchEvent(new CustomEvent('motor:anexo')); // main.js redesenha a tela

/** Atualiza só os números do progresso (sem refazer a tela a cada pedaço). */
function pintarProgresso() {
  const p = textoProgresso(ui.prog || {}, formatarBytes);
  const pct = document.getElementById('envio-pct');
  if (!pct) return;
  pct.textContent = `${p.pct}%`;
  document.getElementById('envio-anel')?.setAttribute('aria-valuenow', String(p.pct));
  document.getElementById('envio-anel-valor')?.setAttribute('stroke-dashoffset', (C_ANEL * (1 - p.pct / 100)).toFixed(2));
  const nums = document.getElementById('envio-numeros');
  if (nums) {
    const [a, b, c] = nums.children;
    if (a) a.textContent = p.feito;
    if (b) b.textContent = p.velocidade;
    if (c) c.textContent = `faltam ${p.restante}`;
  }
  if (estado.envio) estado.envio.enviado = ui.prog?.enviados || 0;
}

let telaAcesa = null;
async function manterTelaAcesa(sim) {
  try {
    if (sim && !telaAcesa && navigator.wakeLock && document.visibilityState === 'visible') telaAcesa = await navigator.wakeLock.request('screen');
    if (!sim && telaAcesa) { await telaAcesa.release(); telaAcesa = null; }
  } catch { telaAcesa = null; }
}

function escolher() {
  if (enviando()) return;
  const input = document.getElementById('arquivo');
  if (!input) return;
  input.accept = 'video/*,.mp4,.mov,.m4v';
  input.value = '';
  input.click(); // dentro do toque (o iPhone só abre a escolha assim)
}

function arquivoEscolhido(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f || enviando()) return;
  estado.arquivo = { nome: f.name, total: f.size, file: f };
  if (ui.fase === 'erro' || ui.fase === 'cancelado') ui = vazioUi();
  redesenhar();
}

function enviar(botao) {
  const id = botao.dataset.id;
  const a = estado.arquivo;
  if (enviando() || !id || !a) return; // clique repetido: o primeiro já está enviando
  botao.disabled = true;
  ui = { ...vazioUi(), id, fase: 'verificando', prog: { enviados: 0, total: a.total } };
  const ctl = Integra.drive.enviarVideo({
    id,
    arquivo: a.file,
    aoProgresso: (p) => { ui.prog = p; pintarProgresso(); },
    aoEstado: (fase, mensagem = '') => {
      if (!FASES_ATIVAS.has(fase)) return; // o fim vem pela promessa
      const mudou = fase !== ui.fase || mensagem !== ui.mensagem;
      ui.fase = fase;
      ui.mensagem = mensagem;
      if (estado.envio) estado.envio.fase = fase;
      if (mudou) redesenhar();
    },
  });
  if (ctl.recusado) {
    ctl.promessa.catch((e) => { ui = { ...vazioUi(), id, fase: 'erro', mensagem: e.message, recuperacao: e.recuperacao || '' }; redesenhar(); });
    return;
  }
  ui.ctl = ctl;
  ui.nome = ctl.nome;
  estado.envio = { id, nome: a.nome, nomeFinal: ctl.nome, total: a.total, enviado: 0, fase: 'verificando' };
  manterTelaAcesa(true);
  redesenhar();
  ctl.promessa.then(
    (res) => {
      ui = { ...vazioUi(), id, nome: ctl.nome, fase: 'concluido', resultado: res };
      estado.arquivo = null;
      carregar({ forcar: true }); // relê os dados: o roteiro sai de "esperando gravação"
    },
    (e) => {
      ui = { ...vazioUi(), id, nome: ctl.nome, fase: e?.codigo === 'cancelado' ? 'cancelado' : 'erro', mensagem: e?.message || 'O envio parou.', recuperacao: e?.recuperacao || '' };
    },
  ).finally(() => {
    estado.envio = null;
    manterTelaAcesa(false);
    redesenhar();
  });
}

const ACOES_ENVIO = {
  'envio-escolher': () => escolher(),
  'envio-enviar': (el) => enviar(el),
  'envio-pausar': () => ui.ctl?.pausar(),
  'envio-continuar': () => ui.ctl?.continuar(),
  'envio-cancelar': () => {
    if (!ui.ctl) return;
    if (typeof window.confirm === 'function' && !window.confirm('Cancelar o envio? O que já subiu é descartado.')) return;
    ui.ctl.cancelar();
  },
  'envio-limpar': () => { if (!enviando()) { ui = vazioUi(); redesenhar(); } },
};

if (temNavegador()) {
  document.addEventListener('click', (ev) => {
    const el = ev.target?.closest?.('[data-acao^="envio-"]');
    const acao = el && ACOES_ENVIO[el.dataset.acao];
    if (!acao || el.disabled) return;
    acao(el);
  });
  document.addEventListener('change', (ev) => {
    if (ev.target?.id === 'arquivo') arquivoEscolhido(ev.target);
  });
  // A tela acesa volta quando o app volta a ficar visível (o navegador solta o wake lock ao sair).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && enviando()) { telaAcesa = null; manterTelaAcesa(true); }
  });
}
