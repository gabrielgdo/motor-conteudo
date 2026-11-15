// SINAL DE VIDA DO MOTOR (puro, sem DOM nem rede): lê o `_motor/saude.json` que o Motor Reels publica
// a cada passada do vigia (~5 min) e no começo de cada tarefa (bin/saude.py), e resume para o Início:
// "Motor funcionando", "trabalhando", "em pausa" ou "sem sinal há X". Formato (versao 1):
//   {versao:1, atualizado_em, intervalo_s, vigia:{estado:'ok'|'pausado'|'pausa_limite', pausa_ate},
//    rodando: null | {skill, arquivo, desde, limite_s}, fila: N | null, ultimo_erro: null | {quando, texto},
//    coletas: {x|instagram|tiktok: {arquivo, data, dias} | null}, gatilhos: {pedido_busca, radar_7h, decisoes},
//    commit, git_pull_falhou_em}
// Campo fora do formato é ignorado; todo texto vindo do arquivo passa por esc() no HTML.

import { esc, horaCurta, hoje, dataCurta } from './util.js';
import { lerDataHora } from './parse.js';

export const VERSAO_SAUDE = 1;
export const FOLGA_MS = 10 * 60 * 1000; // passada atrasada ou tarefa além do limite: +10 min antes do alerta
const INTERVALO_PADRAO_S = 300;
const LIMITE_PADRAO_S = 5400;
const MAX_TEXTO = 200;
const ESTADOS_VIGIA = ['ok', 'pausado', 'pausa_limite'];
const REDES = [['x', 'X'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']];
const NOMES_SKILL = {
  editar: 'editando um vídeo', revisar: 'refazendo uma prévia com os ajustes', finalizar: 'montando um pacote final',
  radar: 'buscando pautas', roteirizar: 'escrevendo roteiros', 'revisar-roteiro': 'revisando um roteiro',
  'decisao-roteiro': 'aplicando uma decisão de roteiro', 'checar-fontes': 'conferindo as fontes de um roteiro',
  consolidar: 'consolidando a semana', 'limpar-teste': 'limpando um teste', 'bruto-teste': 'gerando um bruto de teste',
};

const texto = (v, n = MAX_TEXTO) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const inteiro = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
function data(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  return lerDataHora(v);
}

/** Texto do arquivo → {ok:true, dados} | {ok:false, motivo: 'json'|'versao'|'data'}. */
export function validarSaude(conteudo) {
  let j;
  try { j = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo; } catch { return { ok: false, motivo: 'json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, motivo: 'json' };
  if (j.versao !== VERSAO_SAUDE) return { ok: false, motivo: 'versao' };
  const atualizadoEm = data(j.atualizado_em);
  if (!atualizadoEm) return { ok: false, motivo: 'data' };
  const v = j.vigia && typeof j.vigia === 'object' ? j.vigia : {};
  const r = j.rodando && typeof j.rodando === 'object' ? j.rodando : null;
  const e = j.ultimo_erro && typeof j.ultimo_erro === 'object' ? j.ultimo_erro : null;
  const c = j.coletas && typeof j.coletas === 'object' ? j.coletas : {};
  const g = j.gatilhos && typeof j.gatilhos === 'object' ? j.gatilhos : {};
  const lerRodando = (x) => (x && typeof x === 'object' && texto(x.skill, 40) && data(x.desde)
    ? { skill: texto(x.skill, 40), arquivo: texto(x.arquivo, 120), desde: data(x.desde),
      limite_s: Number.isFinite(x.limite_s) && x.limite_s > 0 ? x.limite_s : null }
    : null);
  const rodando = lerRodando(r);
  const rodandoTodas = (Array.isArray(j.rodando_todas) ? j.rodando_todas : []).map(lerRodando).filter(Boolean).slice(0, 3);
  const u = j.uso && typeof j.uso === 'object' ? j.uso : null;
  const numero = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const uso = u && inteiro(u.execucoes) !== null ? {
    dias: inteiro(u.dias) || 7, execucoes: u.execucoes, custoUsd: numero(u.custo_usd),
    porSkill: (Array.isArray(u.por_skill) ? u.por_skill : []).filter((x) => x && texto(x.skill, 40)).slice(0, 12)
      .map((x) => ({ skill: texto(x.skill, 40), n: inteiro(x.n) || 0, falhas: inteiro(x.falhas) || 0, minMedio: numero(x.min_medio) })),
    revisoesPorVideo: numero(u.revisoes_por_video_30d), videos30d: inteiro(u.videos_30d),
  } : null;
  const coletas = {};
  for (const [rede] of REDES) {
    const x = c[rede];
    coletas[rede] = x && typeof x === 'object' && inteiro(x.dias) !== null && /^\d{4}-\d{2}-\d{2}$/.test(String(x.data))
      ? { data: x.data, dias: x.dias } : null;
  }
  const gatilhos = {};
  for (const k of ['pedido_busca', 'radar_7h', 'decisoes']) gatilhos[k] = typeof g[k] === 'boolean' ? g[k] : null;
  return {
    ok: true,
    dados: {
      atualizadoEm,
      intervalo_s: Number.isFinite(j.intervalo_s) && j.intervalo_s > 0 ? j.intervalo_s : INTERVALO_PADRAO_S,
      vigia: { estado: ESTADOS_VIGIA.includes(v.estado) ? v.estado : 'ok', pausaAte: data(v.pausa_ate) },
      rodando,
      rodandoTodas: rodandoTodas.length ? rodandoTodas : (rodando ? [rodando] : []),
      fila: inteiro(j.fila),
      avisosPendentes: inteiro(j.avisos_pendentes) || 0,
      uso,
      ultimoErro: e && texto(e.texto) ? { quando: data(e.quando), texto: texto(e.texto) } : null,
      coletas,
      gatilhos,
      gitPullFalhouEm: data(j.git_pull_falhou_em),
    },
  };
}

/** "às 9h10" no mesmo dia; "em 14 de nov às 9h10" em outro dia (fuso de São Paulo). */
const as = (d, agora) => (hoje(d) === hoje(agora) ? `às ${horaCurta(d)}` : `em ${dataCurta(hoje(d))} às ${horaCurta(d)}`);

/** 75 s → "1 min"; 3 h 20 → "3 h"; 2 dias → "2 dias". */
export function duracao(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

const idadeColeta = (dias) => (dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`);

/**
 * Dados validados + agora → {tom: 'ok'|'espera'|'alerta', titulo, frase, detalhes: [{texto, tom}]}.
 * Sem sinal: a última notícia passou do intervalo + 10 min (ou a tarefa rodando passou do limite + 10 min).
 */
export function resumirSaude(d, agora = new Date()) {
  const idade = agora - d.atualizadoEm;
  const intervalo = d.intervalo_s * 1000;
  let tom; let titulo; let frase;
  if (d.rodando) {
    const limite = (d.rodando.limite_s || LIMITE_PADRAO_S) * 1000;
    const passou = agora - d.rodando.desde > limite + FOLGA_MS;
    const oque = NOMES_SKILL[d.rodando.skill] || `rodando /${d.rodando.skill}`;
    tom = passou ? 'alerta' : 'espera';
    titulo = passou ? 'Motor parece parado' : 'Motor trabalhando';
    const outras = (d.rodandoTodas || []).filter((x) => x !== d.rodando && !(x.skill === d.rodando.skill && +x.desde === +d.rodando.desde))
      .map((x) => NOMES_SKILL[x.skill] || `rodando /${x.skill}`);
    frase = `${oque.charAt(0).toUpperCase()}${oque.slice(1)}${d.rodando.arquivo ? ` (${d.rodando.arquivo})` : ''} desde ${horaCurta(d.rodando.desde)}`
      + (outras.length ? ` · ao mesmo tempo, ${outras.join(' e ')}` : '')
      + (passou ? `, mais que o tempo-limite. Avise o Programador.` : '');
  } else if (idade > intervalo + FOLGA_MS) {
    tom = 'alerta'; titulo = 'Sem sinal do motor';
    frase = `Nenhuma notícia há ${duracao(idade)} (a última foi ${as(d.atualizadoEm, agora)}). O computador do Grok pode ter parado: avise o Programador.`;
  } else if (d.vigia.estado === 'pausa_limite') {
    tom = 'espera'; titulo = 'Motor em pausa';
    frase = `O limite de uso do Claude acabou${d.vigia.pausaAte ? `; volta sozinho ${as(d.vigia.pausaAte, agora)}` : '; volta sozinho quando renovar'}.`;
  } else if (d.vigia.estado === 'pausado') {
    tom = 'alerta'; titulo = 'Motor pausado';
    frase = 'O vigia foi pausado à mão: nada novo é atendido até alguém tirar a pausa.';
  } else {
    tom = 'ok'; titulo = 'Motor funcionando';
    frase = `Última passada ${as(d.atualizadoEm, agora)}${d.fila ? ` · ${d.fila === 1 ? '1 tarefa' : `${d.fila} tarefas`} na fila` : ''}.`;
  }

  const detalhes = [];
  const col = REDES.map(([rede, nome]) => {
    const c = d.coletas[rede];
    return { texto: `${nome}: ${c ? idadeColeta(c.dias) : 'sem coleta'}`, tom: !c || c.dias >= 2 ? 'alerta' : 'ok' };
  });
  detalhes.push({ texto: `Coletas do Diretor: ${col.map((c) => c.texto).join(' · ')}`, tom: col.some((c) => c.tom === 'alerta') ? 'alerta' : 'ok' });
  const desligados = [['pedido_busca', 'busca pedida pelo app'], ['radar_7h', 'busca das 7h'], ['decisoes', 'decisões de roteiro']]
    .filter(([k]) => d.gatilhos[k] === false).map(([, n]) => n);
  if (desligados.length) {
    detalhes.push({ texto: `Desligado no motor: ${desligados.join(', ')} (os pedidos ficam esperando no Drive).`, tom: 'espera' });
  }
  if (d.ultimoErro && (!d.ultimoErro.quando || agora - d.ultimoErro.quando < 24 * 3600 * 1000)) {
    detalhes.push({ texto: `Último erro${d.ultimoErro.quando ? ` ${as(d.ultimoErro.quando, agora)}` : ''}: ${d.ultimoErro.texto}`, tom: 'alerta' });
  }
  if (d.avisosPendentes) {
    detalhes.push({ texto: `${d.avisosPendentes === 1 ? '1 aviso ainda não chegou' : `${d.avisosPendentes} avisos ainda não chegaram`} ao Diretor; o motor reenvia sozinho a cada passada.`, tom: 'alerta' });
  }
  if (d.uso && d.uso.execucoes) {
    const pesada = [...d.uso.porSkill].filter((x) => x.minMedio !== null).sort((a, b) => b.minMedio - a.minMedio)[0];
    const falhas = d.uso.porSkill.reduce((n, x) => n + x.falhas, 0);
    detalhes.push({ texto: `Últimos ${d.uso.dias} dias: ${d.uso.execucoes} ${d.uso.execucoes === 1 ? 'tarefa' : 'tarefas'}`
      + (falhas ? ` (${falhas} com falha)` : '')
      + (d.uso.custoUsd !== null ? `, custo estimado US$ ${d.uso.custoUsd.toFixed(2).replace('.', ',')}` : '')
      + (pesada ? `; a mais demorada é ${NOMES_SKILL[pesada.skill] || pesada.skill} (média de ${String(pesada.minMedio).replace('.', ',')} min)` : '') + '.',
    tom: falhas ? 'alerta' : 'ok' });
  }
  if (d.uso && d.uso.revisoesPorVideo !== null && d.uso.videos30d) {
    detalhes.push({ texto: `Em 30 dias: ${String(d.uso.revisoesPorVideo).replace('.', ',')} ${d.uso.revisoesPorVideo === 1 ? 'rodada' : 'rodadas'} de ajuste por vídeo, em média (${d.uso.videos30d} ${d.uso.videos30d === 1 ? 'vídeo' : 'vídeos'}).`, tom: 'ok' });
  }
  if (d.gitPullFalhouEm && agora - d.gitPullFalhouEm < 3600 * 1000) {
    detalhes.push({ texto: `A atualização do código do motor falhou ${as(d.gitPullFalhouEm, agora)}.`, tom: 'alerta' });
  }
  return { tom, titulo, frase, detalhes };
}

/** Texto + agora → {ok:true, ...resumo} | {ok:false, motivo}. */
export function lerSaude(conteudo, agora = new Date()) {
  const v = validarSaude(conteudo);
  return v.ok ? { ok: true, ...resumirSaude(v.dados, agora) } : v;
}

const selo = (t, tom = 'neutro') => `<span class="selo ${esc(tom)}">${esc(t)}</span>`;

/**
 * Faixa "Motor" do Início. `leitura`: {fase:'carregando'} | {fase:'sem-arquivo'} | {fase:'indisponivel'}
 * | {fase:'ok', saude: resultado de resumirSaude}. Carregando e sem arquivo não mostram nada (o motor
 * ainda não publicou): a faixa só aparece com notícia de verdade ou com a falha da leitura.
 */
export function htmlSaude(leitura) {
  if (!leitura || leitura.fase === 'carregando' || leitura.fase === 'sem-arquivo') return '';
  const faixa = (itens) => `<div class="faixa" role="group" aria-label="Motor de edição: sinal de vida">${itens}</div>`;
  if (leitura.fase !== 'ok' || !leitura.saude) {
    return `<section class="painel andamento saude" aria-label="Motor">${faixa('<span class="faixa-nome">Motor</span><span class="faixa-item apagado">Não consegui ler o sinal de vida agora</span>')}</section>`;
  }
  const s = leitura.saude;
  const det = s.detalhes.length
    ? `<details class="andamento-mais"><summary class="pequeno">Detalhes do motor</summary><ul class="andamento-lista">${
      s.detalhes.map((x) => `<li>${selo(x.tom === 'ok' ? 'ok' : x.tom === 'alerta' ? 'atenção' : 'info', x.tom)} <span>${esc(x.texto)}</span></li>`).join('')
    }</ul></details>`
    : '';
  return `<section class="painel andamento saude" aria-label="Motor"${s.tom === 'alerta' ? ' role="status"' : ''}>${faixa(
    `<span class="faixa-nome">Motor</span><span class="faixa-item">${selo(s.titulo, s.tom)}</span><span class="faixa-item andamento-frase">${esc(s.frase)}</span>`,
  )}${det}</section>`;
}
