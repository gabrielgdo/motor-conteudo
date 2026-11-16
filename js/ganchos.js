// GANCHOS ANTES DO ROTEIRO (puro, sem DOM nem rede). Pedido dela de 15/11/2026: antes do roteiro, o motor propõe 3
// ganchos ("<id> ganchos vN.md" em 2-Roteiros/rascunhos) e ela escolhe um no app; o rascunho v1 nasce do escolhido.
// "Quero outros 3" também é uma escolha: o motor grava os ganchos v(N+1). A escolha vira "<id> gancho vN.md" (pela
// central, tipo decisao_gancho, com o Drive como reserva) e vale a primeira escolha VÁLIDA de cada versão (como no
// motor: um arquivo inválido antes não bloqueia uma escolha válida depois; escolhaValida).
//
//   lerGanchos(texto)                  o arquivo do motor → {id, versao, titulo, opcoes:[{n, fala, tela, porque}], regras}
//   escolhaValida(lida, {id, versao, opcoes})  a escolha lida vale sozinha? (os critérios do motor)
//   estadoDosGanchos(r, {local, agora}) em que pé está a escolha (escolher | escolhido | outros | sem-texto)
//   planejarEscolhaGancho(...)          nome e conteúdo do arquivo da escolha, conferindo se ela já existe
//
// Os arquivos são DADOS: só a lista fechada de campos é lida (formatos.md do motor) e tudo vai para a tela por esc().

import { idValido, ehTeste } from './parse.js';
import { podeDecidir } from './controle.js';
import { ESCOLHAS_GANCHO, nomeEscolhaGancho, textoEscolhaGancho } from './pedidos-motor.js';
import { lerPerguntasRegra, problemaRegras, regrasValidas } from './regras.js';

export { ESCOLHAS_GANCHO };
/** Depois de 2 h sem resposta do motor, a espera ganha o tom de alerta; o registro otimista deixa de valer. */
export const ESPERA_GANCHO_MS = 2 * 60 * 60 * 1000;
const MAX_CAMPO = 400;

const ms = (d) => (d instanceof Date ? d.getTime() : d == null || d === '' ? NaN : new Date(d).getTime());

/** Valor de uma linha `chave: valor` sem as aspas de YAML. */
function valor(v) {
  let s = String(v ?? '').trim();
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) {
    s = s.slice(1, -1);
    if (s.includes('\\')) s = s.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s.trim();
}

/**
 * `<id> ganchos vN.md` → {id, versao, titulo, opcoes, regras}. Cabeçalho: só id, versao e titulo. Corpo: só as seções
 * `## Gancho 1..3` e, em cada uma, as linhas `fala:`, `tela:` e `por que:`. Opção sem fala fica de fora. `regras`: as
 * perguntas de regra, se o arquivo trouxer a seção "## Regra que esbarra no seu pedido" (js/regras.js).
 */
export function lerGanchos(texto) {
  const out = { id: '', versao: 0, titulo: '', opcoes: [], regras: [] };
  const s = String(texto ?? '');
  const fm = s.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  let corpo = s;
  if (fm) {
    corpo = s.slice(fm[0].length);
    for (const linha of fm[1].split(/\r?\n/)) {
      const m = linha.match(/^([A-Za-z_]+)\s*:\s*(.*)$/); // só campos de topo
      if (!m) continue;
      const k = m[1].toLowerCase();
      const v = valor(m[2]);
      if (k === 'id' && !out.id) out.id = v.slice(0, 20);
      else if (k === 'versao' && !out.versao) out.versao = Number(v.replace(/^v/i, '')) || 0;
      else if (k === 'titulo' && !out.titulo) out.titulo = v.slice(0, 200);
    }
  }
  const porN = new Map();
  let atual = null;
  for (const linha of corpo.split(/\r?\n/)) {
    const sec = linha.trim().match(/^##\s+Gancho\s+(\d+)\s*$/i);
    if (sec) {
      const n = Number(sec[1]);
      atual = n >= 1 && n <= 3 && !porN.has(n) ? { n, fala: '', tela: '', porque: '' } : null;
      if (atual) porN.set(n, atual);
      continue;
    }
    if (/^\s*#/.test(linha)) { atual = null; continue; }
    const c = linha.match(/^\s*(?:[-*]\s+)?(fala|tela|por\s*qu[eê])\s*:\s*(.*?)\s*$/i);
    if (c && atual) {
      const k = /^por/i.test(c[1]) ? 'porque' : c[1].toLowerCase();
      if (!atual[k]) atual[k] = valor(c[2]).slice(0, MAX_CAMPO);
    }
  }
  out.opcoes = [...porN.values()].filter((o) => o.fala).sort((a, b) => a.n - b.n);
  out.regras = lerPerguntasRegra(corpo, idValido(out.id) ? out.id : '');
  return out;
}

/** Quem pode decidir, como no motor (fila_roteiro.tipo_quem): o e-mail da conta que decide; "test" só em id T. */
export function quemDecide(quem, id) {
  const q = String(quem ?? '').trim().toLowerCase();
  return podeDecidir(q) || (q === 'test' && ehTeste(id));
}

/**
 * A escolha lida (lerEscolhaGancho) vale sozinha? Os critérios do motor (fila_roteiro.escolha_invalida): id e versão do
 * conteúdo iguais aos do nome (ou vazios), escolha 1|2|3|outros, quem que decide, em `regras` só perguntas deste
 * roteiro com resposta mudar|so_neste|manter e, em 1|2|3, o gancho está nas opções daquela versão (quando elas foram
 * lidas). Só uma escolha válida conta para "a primeira de cada versão".
 */
export function escolhaValida(lida, { id, versao, opcoes = null } = {}) {
  if (!lida || typeof lida !== 'object') return false;
  if (lida.id && lida.id !== id) return false;
  if (lida.versao && Number(lida.versao) !== Number(versao)) return false;
  if (!ESCOLHAS_GANCHO.includes(String(lida.escolha))) return false;
  if (!quemDecide(lida.quem, id)) return false;
  if (problemaRegras(lida.regras, id)) return false;
  if (lida.escolha !== 'outros' && Array.isArray(opcoes) && opcoes.length
      && !opcoes.some((o) => String(o.n) === String(lida.escolha))) return false;
  return true;
}

/** O registro otimista {versao, escolha, desde} ainda vale para esta versão dos ganchos? */
function localValido(local, versao, t) {
  if (!local || Number(local.versao) !== Number(versao) || !ESCOLHAS_GANCHO.includes(String(local.escolha))) return false;
  const desde = ms(local.desde);
  return !Number.isFinite(desde) || t - desde < ESPERA_GANCHO_MS;
}

/**
 * Em que pé está a escolha do gancho de um roteiro na etapa 'ganchos'. `r.propostaGanchos` (js/dados.js):
 * {versao, opcoes, lido, erro, temEscolha, escolhaEm, escolha:{escolha, observacoes}|null}. `local`:
 * estado.ganchosEnviados[id] = {versao, escolha, desde}, logo depois de enviar (até a escolha aparecer no Drive).
 * → {estado, escolha, bloqueia, texto, tom, explicacao}. Textos puros: esc() na tela.
 *   escolher   a vez é dela (os botões ligam)
 *   escolhido  ela escolheu 1, 2 ou 3: o motor escreve o rascunho v1
 *   outros     ela pediu outros 3: o motor escreve os ganchos v(N+1)
 *   sem-texto  o arquivo dos ganchos não foi lido (ou veio sem opção): nada a escolher agora
 */
export function estadoDosGanchos(r, { local = null, agora = new Date() } = {}) {
  const g = r?.propostaGanchos || {};
  const v = Number(g.versao) || 0;
  const t = ms(agora);
  const doDrive = g.temEscolha ? String(g.escolha?.escolha || '') : '';
  const otimista = !g.temEscolha && localValido(local, v, t);
  if (g.temEscolha || otimista) {
    const escolha = g.temEscolha ? doDrive : String(local.escolha);
    const desde = g.temEscolha ? ms(g.escolhaEm) : ms(local?.desde);
    const demorou = Number.isFinite(desde) && t - desde >= ESPERA_GANCHO_MS;
    const atraso = demorou ? ' Já passou de 2 h sem resposta do motor: se algo falhou, o Gabriel recebe o aviso.' : '';
    const tom = demorou ? 'alerta' : 'espera';
    if (escolha === 'outros') {
      return {
        estado: 'outros', escolha, bloqueia: true, tom, texto: 'Você pediu outros 3 ganchos',
        explicacao: `O motor está escrevendo 3 ganchos novos (v${v + 1}); eles aparecem aqui quando ficarem prontos.${atraso}`,
      };
    }
    return {
      estado: 'escolhido', escolha, bloqueia: true, tom,
      texto: /^[123]$/.test(escolha) ? `Gancho ${escolha} escolhido` : 'Escolha enviada',
      explicacao: `O motor está escrevendo o rascunho v1 a partir dele. O rascunho passa pela checagem de fontes e aparece aqui para você aprovar.${atraso}`,
    };
  }
  if (!g.lido || !(g.opcoes || []).length) {
    return {
      estado: 'sem-texto', escolha: '', bloqueia: true, tom: 'alerta', texto: 'Ganchos ilegíveis agora',
      explicacao: g.erro ? 'O Google Drive não entregou o arquivo dos ganchos agora.' : 'O arquivo dos ganchos não trouxe opções que eu consiga ler.',
    };
  }
  return { estado: 'escolher', escolha: '', bloqueia: false, tom: 'acao', texto: 'Escolher o gancho', explicacao: '' };
}

/** Roteiros na etapa 'ganchos' em que a vez é dela (para o Início e o número da navegação). */
export function ganchosParaEscolher(roteiros = [], locais = {}, agora = new Date()) {
  return (roteiros || []).filter((r) => r?.etapa === 'ganchos'
    && estadoDosGanchos(r, { local: locais?.[r.id] || null, agora }).estado === 'escolher');
}

/**
 * Plano da escolha: nome e conteúdo de `<id> gancho vN.md`. `existentes`: os arquivos de rascunhos* lidos agora
 * (vale a primeira escolha de cada versão, como na central). `regras`: as respostas dela às perguntas de regra.
 * → {ok:true, nome, conteudo, payload} | {ok:false, motivo, mensagem}.
 */
export function planejarEscolhaGancho({ id, versao, escolha, observacoes = '', regras = [], email = '', existentes = [], agora = new Date() } = {}) {
  if (!idValido(id)) return { ok: false, motivo: 'id-invalido', mensagem: `Id inválido: ${id}` };
  const v = Number(versao);
  if (!Number.isInteger(v) || v < 1) return { ok: false, motivo: 'versao-invalida', mensagem: `Versão inválida: ${versao}` };
  const e = String(escolha ?? '').trim().toLowerCase();
  if (!ESCOLHAS_GANCHO.includes(e)) return { ok: false, motivo: 'escolha-invalida', mensagem: 'A escolha precisa ser o gancho 1, 2 ou 3, ou outros 3.' };
  const obs = String(observacoes ?? '').trim().slice(0, 1000);
  const nome = nomeEscolhaGancho(id, v);
  if ((existentes || []).some((f) => String(f?.name ?? f ?? '').trim() === nome)) {
    return { ok: false, motivo: 'ja-escolhido', mensagem: `A escolha dos ganchos v${v} de ${id} já está no Drive (vale a primeira). Atualize a tela.` };
  }
  return {
    ok: true, nome,
    conteudo: textoEscolhaGancho({ id, versao: v, escolha: e, observacoes: obs, regras, quem: email, quando: agora }),
    payload: { id, versao: v, escolha: e, observacoes: obs, regras: regrasValidas(regras, id) },
  };
}

/** Aviso depois de a escolha sair (pela central ou pelo Drive). */
export function textoDaEscolhaAceita(id, { escolha, versao } = {}, viaCentral = false) {
  const por = viaCentral ? 'pela central: ele recebe em segundos' : 'pelo Drive: ele pega o arquivo em alguns minutos';
  if (String(escolha) === 'outros') return `${id}: pedido de outros 3 ganchos enviado ao motor ${por}. Os ganchos v${Number(versao) + 1} aparecem aqui quando ficarem prontos.`;
  return `${id}: gancho ${escolha} escolhido e enviado ao motor ${por}. Ele escreve o rascunho v1 com essa abertura.`;
}
