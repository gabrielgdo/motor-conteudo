// Testes de js/dados.js: o mapeamento puro projeto (model.js) + roteiro lido (roteiro.js) → objeto
// de roteiro do protótipo (montarRoteiro), a semana atual e os utilitários puros.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarProjetos, MIME_PASTA } from '../js/model.js';
import { lerRoteiro } from '../js/roteiro.js';
import { montarRoteiro, semanaDe, compararIds, emParalelo, arquivoDoRoteiro, precisaDoTexto } from '../js/dados.js';
import { quando, validade, periodoDaSemana } from '../js/util.js';

const DIR = new URL('./fixtures/roteiros/', import.meta.url);
const fixture = (nome) => lerRoteiro(readFileSync(new URL(nome, DIR), 'utf8'), nome);

// Sexta, 20 de novembro de 2026, 12h em São Paulo (semana ISO 47).
const AGORA = new Date('2026-11-20T15:00:00.000Z');

let seq = 0;
function arq(name, quandoIso = '2026-11-18T12:00:00.000Z', extra = {}) {
  seq++;
  return {
    id: `f${seq}`, name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'video/mp4',
    createdTime: quandoIso, modifiedTime: quandoIso, size: '1048576', parents: [], webViewLink: `https://drive.google.com/file/d/f${seq}/view`, ...extra,
  };
}
const pasta = (name, quandoIso) => arq(name, quandoIso, { mimeType: MIME_PASTA, size: undefined });

function projeto(id, listagens) {
  return montarProjetos(listagens).get(id);
}

/* ---------------------------------------------------------------- formato novo */

test('formato novo, mesmo roteiro nas duas redes (T90): falas, ganchos, notas e extras', () => {
  const p = projeto('T90', { rascunhos: [arq('T90 rascunho v1.md'), arq('T90 rascunho v2.md')] });
  const r = montarRoteiro(p, fixture('T90 - Novo mesmo roteiro.md'), AGORA);

  assert.equal(r.id, 'T90');
  assert.equal(r.etapa, 'rascunho');
  assert.equal(r.titulo, 'Por que a gente repete o mesmo tipo de relacionamento');
  assert.equal(r.curto, r.titulo, 'curto = titulo (sem apelidos inventados)');
  assert.equal(r.versaoRoteiro, 2);
  assert.equal(r.valido_ate, 'atemporal');
  assert.equal(r.formato, 'Jung explica');
  assert.equal(r.formatoRoteiro, 'novo');
  assert.equal(r.duracaoEstimada, '48 s');
  assert.equal(r.teste, true);
  assert.equal(r.arquivado, false);

  assert.deepEqual(r.falas.map((f) => [f.parte, f.rede]), [
    ['Abertura', undefined], ['Parte 1', undefined], ['Parte 2', undefined], ['Parte 3', undefined],
  ]);
  assert.ok(r.falas.every((f) => !('rede' in f)), 'sem tt_proprio, nenhuma fala tem rede');
  assert.equal(r.falas[0].texto, 'Você jura que dessa vez escolheu diferente. E, três meses depois, está vivendo a mesma história.');

  const alternativas = ['Não é azar. É um padrão, e ele tem nome.', 'O que as suas últimas três relações têm em comum?'];
  assert.deepEqual(r.ganchos.ig, [r.falas[0].texto, ...alternativas]);
  assert.deepEqual(r.ganchos.tt, [r.falas[0].texto, ...alternativas]);

  assert.deepEqual(r.notas, ['Imagem de fios ou de um nó no ponto do complexo', 'Texto na tela: "o familiar parece seguro"']);
  assert.match(r.entrega, /^Tom acolhedor, ritmo calmo\./);
  assert.match(r.legendas.ig, /^Repetir o mesmo tipo/);
  assert.match(r.legendas.tt, /^Por que eu sempre/);
  assert.equal(r.carrossel.length, 3);
  assert.match(r.threads, /^A gente não repete/);
  assert.deepEqual(r.stories, [
    ['Enquete', 'Você já viveu a mesma história com pessoas diferentes?'],
    ['Caixinha', 'Qual padrão você percebe nas suas relações?'],
    ['Leva ao vídeo', 'Falei sobre isso no vídeo de hoje.'],
  ]);
  assert.deepEqual(r.fontes.map((f) => f.checagem), ['confirmada', 'confirmada']);
  assert.match(r.fontes[0].ref, /^Jung, C\. G\./);
  assert.deepEqual(r.checklist.map((c) => c.marcado), [true, true, false]);
  assert.deepEqual(r.video, { versoes: [], pendentes: [], historico: r.video.historico });
  assert.equal(r.pacote, null);
  assert.equal(r.vencedor, false);
});

test('formato novo com TikTok próprio (T91): falas de cada rede levam rede ig/tt', () => {
  const p = projeto('T91', { roteiros: [arq('T91 - Síndrome do impostor.md')] });
  const r = montarRoteiro(p, fixture('T91 - Novo TikTok proprio.md'), AGORA);
  assert.equal(r.etapa, 'aprovado');
  assert.equal(r.versaoRoteiro, 1, 'só o aprovado: versão 1');
  assert.deepEqual(r.falas.map((f) => `${f.parte}/${f.rede}`), [
    'Abertura/ig', 'Parte 1/ig', 'Parte 2/ig', 'Abertura/tt', 'Parte 1/tt', 'Parte 2/tt',
  ]);
  assert.equal(r.ganchos.ig[0], 'Você recebe um elogio e a primeira coisa que pensa é: uma hora vão descobrir.');
  assert.equal(r.ganchos.tt[0], 'Uma hora vão descobrir que você não sabe nada? Calma.');
  assert.deepEqual(r.stories.map(([tipo]) => tipo), ['Enquete', 'Caixinha', 'Story']);
  assert.deepEqual(r.fontes.map((f) => f.checagem), ['divergente', 'nao-encontrada', 'confirmada']);
  assert.equal(r.notas.length, 3, 'apoio visual: no máximo 3 itens');
});

/* ----------------------------------------------------------- formato com etiquetas */

test('formato com etiquetas (S46-01): partes e redes das falas, ganchos e notas de intenção', () => {
  const p = projeto('S46-01', { roteiros: [arq('S46-01 - Ansiedade de domingo.md')], brutos: [arq('S46-01 bruto.MOV')] });
  const r = montarRoteiro(p, fixture('S46-01 - Formato com etiquetas.md'), AGORA);
  assert.equal(r.etapa, 'recebido');
  assert.equal(r.formatoRoteiro, 'etiquetas');
  assert.equal(r.titulo, 'Ansiedade de domingo à noite', 'o título do cabeçalho vence o do nome do arquivo');
  assert.deepEqual(r.falas.map((f) => [f.parte, f.rede]), [
    ['Gancho', 'ig'], ['Gancho', 'tt'], ['Promessa', undefined], ['Ponto 1', undefined], ['Ponto 2', undefined],
    ['Virada', undefined], ['Fechamento', 'ig'], ['Fechamento', 'tt'],
  ]);
  assert.equal(r.falas[3].texto, 'A antecipação ativa o mesmo alarme que a ameaça real. O corpo não sabe que segunda ainda não chegou.');
  assert.deepEqual(r.ganchos.ig, ['Domingo à noite dá um aperto no peito?', 'O domingo não é o problema. Continua aqui.']);
  assert.deepEqual(r.ganchos.tt, ['Por que o domingo à noite pesa tanto?', 'Sem tipo nenhum.']);
  assert.deepEqual(r.notas, ['Ênfase em "mesmo alarme".', 'Tom acolhedor na virada.']);
  assert.deepEqual(r.stories, [['Enquete', 'Domingo à noite pesa para você?'], ['Leva ao vídeo', 'Expliquei no vídeo de hoje.']]);
  assert.deepEqual(r.legendas, { ig: 'Salva para o próximo domingo.', tt: 'O que pesa no seu domingo?' });
});

test('etiquetas: sem [GANCHO TT] o gancho do IG vale nas duas redes (como no roteiro.py)', () => {
  const md = '---\nid: S47-09\ntitulo: Teste\n---\n## Falas\n[GANCHO IG] Abre aqui.\n[PONTO 3] Terceiro.\n[FECHAMENTO IG] Tchau IG.\n[FECHAMENTO TT] Tchau TT.\n[CTA] Siga.\nSem rótulo continua.\n';
  const p = projeto('S47-09', { roteiros: [arq('S47-09 - Teste.md')] });
  const r = montarRoteiro(p, lerRoteiro(md, 'S47-09 - Teste.md'), AGORA);
  assert.deepEqual(r.falas, [
    { parte: 'Gancho', texto: 'Abre aqui.' },
    { parte: 'Ponto 3', texto: 'Terceiro.' },
    { parte: 'Fechamento', rede: 'ig', texto: 'Tchau IG.' },
    { parte: 'Fechamento', rede: 'tt', texto: 'Tchau TT.' },
    { parte: 'Cta', texto: 'Siga. Sem rótulo continua.' },
  ]);
  assert.deepEqual(r.ganchos, { ig: ['Abre aqui.'], tt: ['Abre aqui.'] }, 'sem ## Ganchos: a abertura de cada rede');
  assert.deepEqual(r.legendas, { ig: '', tt: '' });
});

/* ------------------------------------------------------------- vídeo e histórico */

test('vídeo: versões com arquivos e datas no fuso de São Paulo; histórico no estilo do protótipo', () => {
  const p = projeto('S47-01', {
    roteiros: [arq('S47-01 - Repetir relacionamentos.md', '2026-11-03T13:00:00.000Z')],
    brutos: [arq('S47-01 bruto.mov', '2026-11-17T21:20:00.000Z')], // terça 18h20 em SP
    revisao: [
      arq('S47-01 IG v1.mp4', '2026-11-18T19:42:00.000Z'), // quarta 16h42 em SP
      arq('S47-01 TT v1.mp4', '2026-11-18T19:43:00.000Z'),
      arq('S47-01 notas v1.md', '2026-11-18T19:44:00.000Z'),
      arq('S47-01 storyboard IG v1.jpg', '2026-11-18T19:44:00.000Z'),
      arq('S47-01 ajustes v1.md', '2026-11-20T02:30:00.000Z'), // quinta 23h30 em SP = ontem
      arq('S47-01 IG v2.mp4', '2026-11-20T12:10:00.000Z'), // hoje 9h10
      arq('S47-01 TT v2.mp4', '2026-11-20T12:10:00.000Z'),
    ],
  });
  const r = montarRoteiro(p, null, AGORA);
  assert.equal(r.etapa, 'previa');
  assert.equal(r.titulo, 'Repetir relacionamentos', 'sem roteiro lido: o título do nome do arquivo');
  assert.equal(r.lido, false);
  assert.deepEqual(r.falas, []);
  assert.deepEqual(r.video.versoes.map((v) => [v.n, v.quando, !!v.ig, !!v.tt, !!v.notas, !!v.ajustes]), [
    [1, 'quarta, 16h42', true, true, true, true],
    [2, 'hoje, 9h10', true, true, false, false],
  ]);
  assert.equal(r.video.versoes[0].criadoEm, '2026-11-18T19:42:00.000Z');
  assert.equal(r.video.versoes[0].storyboard.ig.name, 'S47-01 storyboard IG v1.jpg');
  assert.deepEqual(r.video.pendentes, []);
  assert.deepEqual(r.video.historico, [
    ['3 de nov, 10h', 'Roteiro aprovado'],
    ['terça, 18h20', 'Gravação enviada (S47-01 bruto.mov)'],
    ['quarta, 16h42', 'Prévia v1 pronta'],
    ['ontem, 23h30', 'Ajustes pedidos na v1'],
    ['hoje, 9h10', 'Prévia v2 pronta'],
  ]);
});

/* -------------------------------------------------------------------- pacote */

const listagensPronto = (id) => {
  const pk = pasta(`${id} - Persona`, '2026-11-12T12:00:00.000Z');
  const sub = (name, s) => ({ ...arq(name), sub: s });
  return {
    prontos: [pk],
    pacotes: {
      [pk.id]: [arq(`${id} TT.mp4`), arq('legenda-instagram.txt'), arq(`${id} IG.mp4`), arq('capa-instagram.jpg'),
        sub('02.png', 'carrossel'), sub('01.png', 'carrossel'), arq('threads.txt'), arq('leia-me.pdf')],
    },
    vencedores: [arq(`${id} vencedor.md`)],
  };
};

test('pacote: arquivos com tipo legível, na ordem; postado da planilha; vencedor; arquivado fora da semana', () => {
  const postados = new Map([['S46-01', '2026-11-13']]);
  const p = projeto('S46-01', { ...listagensPronto('S46-01'), postados });
  const r = montarRoteiro(p, null, AGORA);
  assert.equal(r.etapa, 'pronto');
  assert.equal(r.titulo, 'Persona');
  assert.equal(r.vencedor, true);
  assert.equal(r.arquivado, true, 'pronto de outra semana sai dos ativos');
  assert.equal(r.pacote.pasta.name, 'S46-01 - Persona');
  assert.deepEqual(r.pacote.arquivos.map((a) => [a.tipo, a.nome]), [
    ['Vídeo do Instagram', 'S46-01 IG.mp4'],
    ['Vídeo do TikTok', 'S46-01 TT.mp4'],
    ['Capa do Instagram', 'capa-instagram.jpg'],
    ['Legenda do Instagram', 'legenda-instagram.txt'],
    ['Carrossel, imagem 1', 'carrossel/01.png'],
    ['Carrossel, imagem 2', 'carrossel/02.png'],
    ['Texto do Threads', 'threads.txt'],
    ['Outro arquivo', 'leia-me.pdf'],
  ]);
  assert.equal(r.pacote.arquivos[0].tam, '1 MB');
  assert.ok(r.pacote.arquivos[0].file.id);
  assert.deepEqual(r.pacote.postado, { ig: '2026-11-13', tt: '2026-11-13' });
  assert.equal(r.pacote.postadoConhecido, true);
});

test('pacote: sem a planilha lida, não afirma nada sobre postado', () => {
  const p = projeto('S47-02', listagensPronto('S47-02'));
  const r = montarRoteiro(p, null, AGORA, { postadosLidos: false });
  assert.deepEqual(r.pacote.postado, { ig: null, tt: null });
  assert.equal(r.pacote.postadoConhecido, false);
  assert.equal(r.arquivado, false, 'pronto da semana atual continua no ciclo');
});

/* ------------------------------------------------------------------- títulos */

test('título: do nome do rascunho quando o texto não foi lido; senão o id', () => {
  const p = projeto('S47-05', { rascunhos: [arq('S47-05 Saudade de casa rascunho v1.md')] });
  assert.equal(montarRoteiro(p, null, AGORA).titulo, 'Saudade de casa');
  const q = projeto('S47-06', { rascunhos: [arq('S47-06 rascunho v3.md')] });
  const r = montarRoteiro(q, null, AGORA);
  assert.equal(r.titulo, 'S47-06');
  assert.equal(r.versaoRoteiro, 3);
  assert.equal(arquivoDoRoteiro(q).name, 'S47-06 rascunho v3.md');
});

test('arquivo do roteiro: o aprovado vence o rascunho; pronto não baixa texto', () => {
  const p = projeto('S47-03', { roteiros: [arq('S47-03 - Depois do ENEM.md')], rascunhos: [arq('S47-03 rascunho v2.md')] });
  assert.equal(arquivoDoRoteiro(p).name, 'S47-03 - Depois do ENEM.md');
  assert.equal(precisaDoTexto('aprovado'), true);
  assert.equal(precisaDoTexto('pronto'), false);
  assert.equal(precisaDoTexto(''), false);
});

/* ------------------------------------------------------- semana, datas e ordem */

test('semana atual e período a partir do relógio real (fuso de São Paulo)', () => {
  assert.deepEqual(semanaDe(new Date('2026-11-14T15:00:00.000Z')), { ano: 2026, numero: 46, codigo: 'S46', periodo: '9 a 15 de novembro' });
  assert.deepEqual(semanaDe(AGORA), { ano: 2026, numero: 47, codigo: 'S47', periodo: '16 a 22 de novembro' });
  // Domingo 23h em SP (segunda 02h UTC) ainda é a semana 47.
  assert.equal(semanaDe(new Date('2026-11-23T02:00:00.000Z')).codigo, 'S47');
  assert.equal(periodoDaSemana(new Date('2026-12-30T15:00:00.000Z')), '28 de dezembro a 3 de janeiro');
});

test('quando e validade', () => {
  assert.equal(quando('2026-11-20T12:00:00.000Z', AGORA), 'hoje, 9h');
  assert.equal(quando('2026-11-16T15:05:00.000Z', AGORA), 'segunda, 12h05');
  assert.equal(quando('2026-11-13T15:05:00.000Z', AGORA), '13 de nov, 12h05');
  assert.equal(validade({ valido_ate: 'atemporal' }, AGORA).texto, 'Atemporal');
  assert.equal(validade({ valido_ate: '' }, AGORA).perto, false);
  assert.deepEqual(validade({ valido_ate: '2026-11-22' }, AGORA), { texto: 'Até 22 de nov (2 dias)', tom: 'alerta', perto: true });
  assert.deepEqual(validade({ valido_ate: '2026-11-19' }, AGORA), { texto: 'Venceu em 19 de nov', tom: 'alerta', perto: true });
  assert.equal(validade({ valido_ate: '2026-12-01' }, AGORA).texto, 'Vale até 1 de dez');
});

test('ordem: semana mais nova primeiro, depois o número; testes e R no fim', () => {
  const ids = ['T01', 'S46-02', 'R001', 'S47-02', 'S46-01', 'S47-01', 'T02-01'];
  assert.deepEqual([...ids].sort(compararIds), ['S47-01', 'S47-02', 'S46-01', 'S46-02', 'T02-01', 'T01', 'R001']);
});

test('emParalelo respeita o limite e passa por todos', async () => {
  let agora = 0; let max = 0; const vistos = [];
  await emParalelo([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
    agora++; max = Math.max(max, agora);
    await new Promise((r) => setTimeout(r, 5));
    vistos.push(n); agora--;
  });
  assert.equal(max, 4);
  assert.deepEqual(vistos.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
