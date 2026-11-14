// INÍCIO: o que espera por ela, a chamada para enviar a gravação, o ciclo e a esteira da semana.

import { esc, ic, dataLonga, hoje, saudacao, validade } from '../util.js';
import { nomeDe } from '../config.js';
import { Integra } from '../integra.js';
import { porEtapa, semPostar, ultima, daSemana, semana, estadoDados, temDados, postouTudo } from '../dados.js';
import { selo, vt, passoDe, destinoDe, painelErro, vazio, rodapeAtualizado } from './pecas.js';
import { contarParaDecidir } from './pautas.js';

const enc = encodeURIComponent;
const comTeste = (tipo, r) => (r.teste ? `${tipo} · teste` : tipo);

function pendencias() {
  const p = [];
  // Pautas: o cartão só aparece com dado real da aba Seleção (pautas para decidir, sem os testes).
  const nPautas = contarParaDecidir();
  if (nPautas) {
    p.push({
      href: '#/pautas', icone: 'pautas', tipo: 'Pautas', titulo: 'Escolher as pautas da semana',
      detalhe: nPautas === 1 ? '1 sugestão do Radar para aprovar ou recusar' : `${nPautas} sugestões do Radar para aprovar ou recusar`,
      ir: 'Escolher',
    });
  }
  porEtapa('rascunho').forEach((r) => p.push({
    href: `#/roteiros/${enc(r.id)}`, icone: 'roteiros', tipo: comTeste('Roteiro', r), titulo: `Aprovar “${r.curto}”`,
    detalhe: r.fontesConferidas ? `Rascunho v${r.versaoRoteiro}, com as fontes conferidas` : `Rascunho v${r.versaoRoteiro}, com as fontes ainda em checagem`,
    ir: 'Ler',
  }));
  porEtapa('previa').forEach((r) => {
    const v = ultima(r);
    p.push({
      href: `#/videos/${enc(r.id)}`, icone: 'videos', tipo: comTeste('Prévia', r), titulo: `Ver a v${v.n} de “${r.curto}”`,
      detalhe: v.ig && v.tt ? 'Instagram e TikTok, lado a lado' : `Só a versão do ${v.ig ? 'Instagram' : 'TikTok'} chegou`,
      ir: 'Assistir',
    });
  });
  semPostar().forEach((r) => p.push({
    href: '#/prontos', icone: 'prontos', tipo: comTeste('Pacote pronto', r), titulo: `Postar “${r.curto}”`,
    detalhe: 'Vídeos, capas e legendas prontos para baixar', ir: 'Abrir',
  }));
  return p;
}

/* Anel de cinco arcos: cada arco é uma etapa da semana, preenchido conforme os roteiros avançam */
function ciclo(lista) {
  const total = lista.length;
  const { numero } = semana();
  const lidos = estadoDados().postadosLidos;
  const conta = (etapas) => lista.filter((r) => etapas.includes(r.etapa)).length;
  const passos = [
    ['Pautas', total],
    ['Roteiros', conta(['aprovado', 'recebido', 'previa', 'ajustes', 'video-aprovado', 'pronto'])],
    ['Gravação', conta(['recebido', 'previa', 'ajustes', 'video-aprovado', 'pronto'])],
    ['Revisão', conta(['video-aprovado', 'pronto'])],
    ['Postagem', lidos ? lista.filter(postouTudo).length : null], // null: a planilha não respondeu
  ];
  const R = 84; const C = 2 * Math.PI * R; const VAO = 16; const arco = C / 5 - VAO; const folga = (VAO / C) * 180;
  const arcos = passos.map(([, n], i) => {
    const f = total && n ? n / total : 0; const gira = `transform="rotate(${-90 + i * 72 + folga} 100 100)"`;
    return `<circle class="arco-trilho" cx="100" cy="100" r="${R}" stroke-dasharray="${arco.toFixed(1)} ${C.toFixed(1)}" ${gira}/>`
      + (f > 0 ? `<circle class="arco ${f >= 1 ? 'cheio' : ''}" style="--i:${i}" cx="100" cy="100" r="${R}" stroke-dasharray="${(arco * f).toFixed(1)} ${C.toFixed(1)}" ${gira}/>` : '');
  }).join('');
  const rotulo = total
    ? passos.map(([nome, n]) => (n === null ? `${nome} sem dados da planilha` : `${nome} ${n} de ${total}`)).join(', ')
    : 'nenhum roteiro ainda';
  const listaHTML = total
    ? `<ol class="ciclo-lista" aria-hidden="true">${passos.map(([nome, n]) => `<li class="${n !== null && n >= total ? 'cheio' : n > 0 ? 'andando' : ''}"><i></i>${nome}<span>${n === null ? 'sem a planilha' : `${n} de ${total}`}</span></li>`).join('')}</ol>`
    : `<p class="apagado pequeno">Nada começou na semana ${numero} ainda. Quando o Radar e o Roteirista começarem, cada etapa vai se preenchendo aqui.</p>`;
  return `<div class="ciclo">
    <svg viewBox="0 0 200 200" role="img" aria-label="Andamento da semana ${numero}: ${esc(rotulo)}">
      ${arcos}<text x="100" y="92" text-anchor="middle" class="ciclo-sub">semana</text><text x="100" y="126" text-anchor="middle" class="ciclo-meio">${numero}</text>
    </svg>
    ${listaHTML}
  </div>`;
}

/* Os quatro nós de cada roteiro na esteira: feito, sua vez, com os bots ou ainda não */
function nosDe(r) {
  const e = r.etapa;
  const gravado = ['recebido', 'previa', 'ajustes', 'video-aprovado', 'pronto'].includes(e);
  const postagem = postouTudo(r) ? 'feito' : e === 'pronto' ? (r.pacote?.postadoConhecido ? 'vez' : 'sem-dados') : '';
  const lista = [
    ['Texto', e === 'rascunho' ? 'vez' : e === 'mudanca' ? 'espera' : 'feito'],
    ['Gravação', gravado ? 'feito' : e === 'aprovado' ? 'vez' : ''],
    ['Vídeos', e === 'pronto' ? 'feito' : e === 'previa' ? 'vez' : ['recebido', 'ajustes', 'video-aprovado'].includes(e) ? 'espera' : ''],
    ['Postagem', postagem],
  ];
  const fala = { feito: 'feito', vez: 'sua vez', espera: 'com os bots', '': 'ainda não', 'sem-dados': 'a planilha não respondeu' };
  return `<div class="nos">${lista.map(([nome, st]) => `<span class="no ${st === 'sem-dados' ? '' : st}"><i>${st === 'feito' ? ic('check', 14) : ''}</i>${nome}<span class="vh">: ${fala[st]}</span></span>`).join('')}</div>`;
}

/* O "Sair" fica na ilha, em todas as telas e larguras (index.html, #botao-sair). */
function hero(frase) {
  const nome = nomeDe(Integra.email());
  return `<section class="hero" aria-labelledby="t-hero">
    <p class="hero-data">${esc(dataLonga(hoje()))}, semana ${semana().numero}</p>
    <h1 id="t-hero">${saudacao()}${nome ? `, ${esc(nome)}` : ''}.</h1>
    <p class="hero-frase">${frase}</p>
  </section>`;
}

/* Esqueleto discreto no lugar dos cards, com o mesmo visual de painel */
function esqueleto() {
  const carta = (i) => `<div class="carta esqueleto" style="--i:${i}" aria-hidden="true"><span class="carta-topo"><span class="esq linha" style="width:40%"></span><span class="esq circulo"></span></span><span class="esq titulo" style="width:85%;margin-top:auto"></span><span class="esq linha" style="width:60%"></span><span class="esq linha" style="width:30%"></span></div>`;
  const painel = (classe, n) => `<div class="painel ${classe}" aria-hidden="true"><div class="pilha" style="gap:.875rem"><span class="esq titulo" style="width:55%"></span>${Array.from({ length: n }, (_, i) => `<span class="esq linha" style="width:${90 - i * 12}%"></span>`).join('')}</div></div>`;
  return `${hero('Buscando o que há de novo no Drive…')}
  <div aria-busy="true"><span class="vh">Carregando o que espera por você.</span>
    <div class="cartas">${[0, 1, 2].map(carta).join('')}</div>
    <div class="bento" style="margin-top:1rem">${painel('b5', 3)}${painel('b7', 5)}${painel('', 4)}</div>
  </div>`;
}

export function vInicio() {
  const { fase, erro } = estadoDados();
  if (fase === 'erro') return `${hero('Não consegui ler o Drive agora.')}${painelErro(erro)}`;
  if (!temDados()) return esqueleto();

  const fila = pendencias(); const gravar = porEtapa('aprovado');
  const extenso = ['', 'Uma coisa espera', 'Duas coisas esperam', 'Três coisas esperam', 'Quatro coisas esperam', 'Cinco coisas esperam', 'Seis coisas esperam', 'Sete coisas esperam'];
  const frase = !fila.length ? 'Tudo em dia. Os bots avisam quando precisarem de você.' : `${extenso[fila.length] || fila.length + ' coisas esperam'} você.`;
  const urgente = gravar.find((r) => validade(r).perto);
  const lista = daSemana();
  const { numero } = semana();
  return `
  ${hero(frase)}
  ${fila.length ? `<section aria-label="Esperando você"><div class="cartas">${fila.map((p, i) => `
    <a class="carta luz ${i === 0 ? 'primeira' : ''}" href="${p.href}" style="--i:${i}">
      <span class="carta-topo">${esc(p.tipo)}<span class="carta-icone">${ic(p.icone, 20)}</span></span>
      <h3>${esc(p.titulo)}</h3><p>${esc(p.detalhe)}</p>
      <span class="carta-ir">${p.ir} ${ic('seta', 16)}</span>
    </a>`).join('')}</div></section>` : ''}
  <div class="bento" style="margin-top:1rem">
    <section class="painel chamada b5" aria-labelledby="t-enviar">
      <span class="chamada-onda" aria-hidden="true"></span>
      <h2 id="t-enviar">Gravou? Envie por aqui.</h2>
      <p>${gravar.length ? `${gravar.length === 1 ? '1 roteiro aprovado espera' : gravar.length + ' roteiros aprovados esperam'} a gravação. O vídeo sobe no tamanho original.` : 'Nenhum roteiro esperando gravação agora.'}</p>
      ${urgente ? `<p class="chamada-aviso">${ic('alerta', 18)}<span>“${esc(urgente.curto)}” vale ${esc(validade(urgente).texto.toLowerCase())}.</span></p>` : ''}
      <a class="botao" href="#/enviar">${ic('enviar')} Enviar gravação</a>
    </section>
    <section class="painel b7" aria-labelledby="t-ciclo">
      <h2 id="t-ciclo">O ciclo da semana</h2>
      ${ciclo(lista)}
    </section>
    <section class="painel" aria-labelledby="t-esteira">
      <h2 id="t-esteira">Cada roteiro, etapa por etapa</h2>
      ${lista.length ? `<ol class="esteira">${lista.map((r) => { const [texto, tom] = passoDe(r); const v = validade(r); return `
        <li><div><span class="id">${esc(r.id)}</span><a class="esteira-titulo" href="${destinoDe(r)}" ${vt(r.id)}>${esc(r.titulo)}</a></div>
          ${nosDe(r)}
          <div class="meta fim">${selo(texto, tom)}${v.perto && r.etapa === 'aprovado' ? selo(v.texto, 'alerta') : ''}</div></li>`; }).join('')}</ol>`
        : vazio(`Nenhum roteiro da semana ${numero} ainda`, 'Quando o Radar e o Roteirista começarem a semana, cada roteiro aparece aqui, etapa por etapa.')}
    </section>
  </div>
  ${rodapeAtualizado()}`;
}
