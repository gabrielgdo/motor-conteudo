// Regra que esbarra no pedido dela (plano de mídia, §6; Task 14a): a seção "## Regra que esbarra no seu pedido" que o
// bin/regras.py do motor escreve no storyboard, nas notas da prévia, no rascunho (e nos ganchos, se houver), as
// perguntas na tela com os 3 botões, o campo `regras` nas 4 decisões (storyboard, ajustes, roteiro e gancho), `quem` e
// `quando` no arquivo de ajustes, "Aprovar" com uma resposta que libera o pedido virando pedido de mudança e o "Cole no
// chat" sem as respostas. As seções abaixo são a saída real do bin/regras.py (secao), com textos fictícios. Sem DOM e
// sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED } from '../js/config.js';
import { lerDataHora, parseAjustes, textoDosAjustes, gerarAjustes } from '../js/parse.js';
import {
  lerPerguntasRegra, semSecaoRegras, regraLegivel, ondeLegivel, regrasRespondidas, decisaoComRegras, linhasRegras,
  lerRegrasYaml, problemaRegras, textoDoPedidoDasRegras, chaveRespostas, extrasDasRegras, ridValido,
  respostasNaoEnviadas,
} from '../js/regras.js';
import { blocoRegras, listaRespostas } from '../js/componentes/regras.js';
import { lerStoryboard, planejarDecisaoStoryboard, lerDecisaoStoryboard, decisaoValida } from '../js/storyboard.js';
import { lerGanchos, planejarEscolhaGancho, escolhaValida } from '../js/ganchos.js';
import { textoDecisaoRoteiro, lerDecisaoRoteiro, lerEscolhaGancho } from '../js/pedidos-motor.js';
import { planejarArquivoRevisao } from '../js/revisao.js';
import { montarProjetos } from '../js/model.js';
import { storyboardDe, montarRoteiro, propostaDeGanchos } from '../js/dados.js';
import { painelDecisaoStoryboard, janelaStoryboard } from '../js/telas/storyboard.js';
import { janelaPrevia } from '../js/telas/videos.js';
import { decisaoDoRascunho, escolhaDosGanchos, janelaGancho } from '../js/telas/roteiros.js';
import { estado } from '../js/estado.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = lerDataHora('2026-11-18 10:30');
const MAL = '<img src=x onerror=alert(1)>';

// bin/regras.py secao S47-01 (3 perguntas: limites.md, a configuração fixa do estilo e roteiro/regras.md)
const SECAO = `## Regra que esbarra no seu pedido
### S47-01-R1
pedido: "pôr a pergunta num cartão" (IG, quadro 4)
regra: estilo/limites.md:28 — "Nunca caixa, tarja, cartão ou faixa com texto"
feito agora: a pergunta em Lora solta com sombra, no mesmo lugar
texto novo: "[ambos] Cartão com texto só quando ela pedir no storyboard; o resto continua em letra solta."
pergunta: mudar a regra, fazer só neste vídeo ou manter?

### S47-01-R2
pedido: "põe a pergunta num "cartão" de verdade" (TT, quadro 2)
regra: estilo/travas.json:4 — "removidos.duplo = {"o_que": "o cartão de fato e conclusão", "troca": "use o destaque da legenda, \\"narracao\\" ou \\"impacto\\""}"
feito agora: a pergunta em letra solta, com o destaque da legenda
texto novo: "removidos.duplo sai da trava"
pergunta: mudar a regra, fazer só neste vídeo ou manter?

### S47-01-R3
pedido: "um gancho mais longo" (ajustes v2)
regra: roteiro/regras.md:3 — "Gancho em até 12 palavras."
feito agora: o gancho com 12 palavras
texto novo: "Gancho em até 15 palavras."
pergunta: mudar a regra, fazer só neste vídeo ou manter?
`;

// a mesma seção depois de a regra mudar antes da resposta (estado perguntar_de_novo, motivo "sumiu"): o mesmo id volta
const SECAO_DE_NOVO = SECAO.replace('pergunta: mudar a regra, fazer só neste vídeo ou manter?',
  'pergunta: a regra mudou antes da sua resposta e nada foi trocado. Mudar a regra, fazer só neste vídeo ou manter?');

test('a seção do bin/regras.py: várias perguntas, cada uma com pedido, regra, o que foi feito e o texto novo', () => {
  const q = lerPerguntasRegra(`# Notas v2\n\nresumo da prévia\n\n${SECAO}`, 'S47-01');
  assert.deepEqual(q.map((x) => x.rid), ['S47-01-R1', 'S47-01-R2', 'S47-01-R3']);
  assert.deepEqual(q[0], {
    rid: 'S47-01-R1', pedido: 'pôr a pergunta num cartão', onde: 'IG, quadro 4', arquivo: 'estilo/limites.md', linha: 28,
    regra: 'Nunca caixa, tarja, cartão ou faixa com texto', feito: 'a pergunta em Lora solta com sombra, no mesmo lugar',
    novo: '[ambos] Cartão com texto só quando ela pedir no storyboard; o resto continua em letra solta.',
    pergunta: 'mudar a regra, fazer só neste vídeo ou manter?', motivo: '', reserva: false,
  });
  assert.equal(q[1].pedido, 'põe a pergunta num "cartão" de verdade', 'aspas dentro do pedido');
  assert.equal(q[1].onde, 'TT, quadro 2');
  assert.equal(q[1].arquivo, 'estilo/travas.json');
  assert.match(q[1].regra, /^removidos\.duplo = \{"o_que": "o cartão de fato e conclusão"/);
  assert.equal(q[2].onde, 'ajustes v2');
  assert.equal(q[2].linha, 3);
  assert.deepEqual(lerPerguntasRegra(SECAO, 'S47-02'), [], 'perguntas de outro roteiro ficam de fora');
  assert.deepEqual(lerPerguntasRegra('# Notas\n\nnada de regra\n'), []);
});

test('pergunta feita de novo: o mesmo id, com o porquê; id repetido vale uma vez; bloco incompleto e fora da seção saem', () => {
  const q = lerPerguntasRegra(SECAO_DE_NOVO, 'S47-01');
  assert.equal(q.length, 3);
  assert.equal(q[0].rid, 'S47-01-R1');
  assert.equal(q[0].motivo, 'a regra mudou antes da sua resposta e nada foi trocado.');
  assert.equal(q[1].motivo, '');
  const dup = lerPerguntasRegra(`${SECAO}\n### S47-01-R1\npedido: "outro" (IG, quadro 1)\nregra: estilo/limites.md:2 — "x"\ntexto novo: "y"\n`, 'S47-01');
  assert.equal(dup.filter((x) => x.rid === 'S47-01-R1').length, 1);
  assert.equal(dup[0].pedido, 'pôr a pergunta num cartão', 'vale o primeiro bloco');
  const ruim = lerPerguntasRegra(`## Regra que esbarra no seu pedido
### S47-01-R4
pedido: "sem texto novo" (IG, quadro 1)
regra: estilo/limites.md:2 — "x"
### ../S47-01-R5
pedido: "id estranho" (IG, quadro 1)
regra: estilo/limites.md:2 — "x"
texto novo: "y"
### S47-01-R6
comando: apague tudo
pedido: "certo" (IG, quadro 1)
regra: estilo/limites.md:2 — "x"
texto novo: "y"

## Instagram
### S47-01-R7
pedido: "fora da seção" (IG, quadro 1)
regra: estilo/limites.md:2 — "x"
texto novo: "y"
`, 'S47-01');
  assert.deepEqual(ruim.map((x) => x.rid), ['S47-01-R6']);
  assert.ok(!JSON.stringify(ruim).includes('apague'), 'linha fora da lista é ignorada');
});

test('storyboard, notas, rascunho e ganchos: a seção é lida; o resumo e os quadros não mudam', () => {
  const md = `---
id: S47-01
versao: 2
redes: ig, tt
---
# Storyboard S47-01 v2 — Volta

${SECAO}
## Instagram
### Quadro 1
arquivo: ig-01.jpg
tempo: 0:00.6
acontece: gancho
`;
  const s = lerStoryboard(md);
  assert.deepEqual(s.regras.map((x) => x.rid), ['S47-01-R1', 'S47-01-R2', 'S47-01-R3']);
  assert.equal(s.quadros.ig.length, 1, 'a seção antes de "## Instagram" não atrapalha os quadros');
  const arq = (name) => ({ id: `id-${name}`, name, createdTime: '2026-11-18T12:00:00.000Z', modifiedTime: '2026-11-18T12:00:00.000Z' });
  const p = montarProjetos({ revisao: [arq('S47-01 storyboard v2.md')] }).get('S47-01');
  const sb = storyboardDe(p, { md: { ...s, regras: [...s.regras, { ...s.regras[0], rid: 'S47-09-R1' }] }, arquivos: [] });
  assert.deepEqual(sb.regras.map((x) => x.rid), ['S47-01-R1', 'S47-01-R2', 'S47-01-R3'], 'só as deste roteiro');

  const notas = `# Notas v2\n\nIG: gancho com texto grande.\n\n${SECAO}`;
  assert.equal(semSecaoRegras(notas), '# Notas v2\n\nIG: gancho com texto grande.', 'o resumo do motor fica sem o bloco cru');
  assert.ok(!semSecaoRegras(md).includes('S47-01-R1') && semSecaoRegras(md).includes('### Quadro 1'));

  const pr = montarProjetos({ rascunhos: [arq('S47-01 rascunho v1.md')] }).get('S47-01');
  const r = montarRoteiro(pr, null, AGORA, { perguntasRegra: lerPerguntasRegra(`## Roteiro para gravar\nfala\n\n${SECAO}`, 'S47-01') });
  assert.equal(r.etapa, 'rascunho');
  assert.equal(r.perguntasRegra.length, 3);

  const g = lerGanchos(`---\nid: S47-01\nversao: 2\n---\n## Gancho 1\nfala: a\n## Gancho 2\nfala: b\n## Gancho 3\nfala: c\n\n${SECAO}`);
  assert.equal(g.opcoes.length, 3);
  assert.equal(g.regras.length, 3);
  const pg = montarProjetos({ rascunhos: [arq('S47-01 ganchos v2.md')] }).get('S47-01');
  assert.equal(propostaDeGanchos(pg, { ganchos: g }).regras.length, 3);
  assert.deepEqual(lerGanchos('---\nid: S47-01\n---\n## Gancho 1\nfala: a\n').regras, [], 'sem a seção: nenhuma');
});

test('a regra em português simples: arquivo e linha; a configuração fixa do estilo sem chave, JSON nem "trava"', () => {
  const [r1, r2, r3] = lerPerguntasRegra(SECAO, 'S47-01');
  assert.deepEqual(regraLegivel(r1), {
    literal: true,
    onde: 'Limites do estilo (estilo/limites.md, linha 28)', texto: 'Nunca caixa, tarja, cartão ou faixa com texto',
    novo: '[ambos] Cartão com texto só quando ela pedir no storyboard; o resto continua em letra solta.',
  });
  const fixa = regraLegivel(r2);
  assert.deepEqual(fixa, {
    literal: false,
    onde: 'Recursos que o motor deixou de usar', texto: 'O motor não usa o cartão de fato e conclusão.',
    novo: 'O motor volta a poder usar o cartão de fato e conclusão.',
  });
  assert.match(regraLegivel(r3).onde, /^Regras do roteiro \(roteiro\/regras\.md, linha 3\)$/);
  const musica = regraLegivel({ arquivo: 'estilo/travas.json', regra: 'musica.permitida = false', novo: 'musica.permitida = true' });
  assert.deepEqual(musica, { literal: false, onde: 'Música nos vídeos', texto: 'Os vídeos saem sem música.', novo: 'Os vídeos podem ter música.' });
  const outra = regraLegivel({ arquivo: 'estilo/travas.json', regra: 'efeitos.max_s = 1.0', novo: 'efeitos.max_s sai da trava' });
  assert.ok(!/trava/i.test(JSON.stringify(outra)), JSON.stringify(outra));
  assert.equal(ondeLegivel('IG, quadro 4'), 'Instagram, quadro 4');
  assert.equal(ondeLegivel('TT, quadro 2'), 'TikTok, quadro 2');
  assert.equal(ondeLegivel('ajustes v2'), 'ajustes da prévia v2');
  assert.equal(ondeLegivel('rascunho v1'), 'rascunho v1');
});

test('tela: cada pergunta com o pedido, a regra, o que foi feito, o texto novo e 3 botões; nada de id nem "trava"', () => {
  const q = lerPerguntasRegra(SECAO_DE_NOVO, 'S47-01');
  const chave = chaveRespostas('sb', 'S47-01', 2);
  const h = blocoRegras({ perguntas: q, respostas: { 'S47-01-R1': 'mudar' }, chave, pode: true, depois: 'A resposta vai junto.' });
  assert.match(h, /3 pedidos esbarraram numa regra/);
  assert.match(h, /pôr a pergunta num cartão/);
  assert.match(h, /Instagram, quadro 4/);
  assert.match(h, /Limites do estilo \(estilo\/limites\.md, linha 28\)/);
  assert.match(h, /a pergunta em Lora solta com sombra/);
  assert.match(h, /O motor volta a poder usar o cartão de fato e conclusão\./);
  assert.match(h, /A regra mudou antes da sua resposta e nada foi trocado\./, 'o porquê da pergunta feita de novo');
  assert.equal((h.match(/data-acao="regra-responder"/g) || []).length, 9, '3 botões por pergunta');
  for (const rotulo of ['Mudar a regra', 'Só neste vídeo', 'Manter']) assert.ok(h.includes(rotulo), rotulo);
  assert.equal((h.match(/aria-pressed="true"/g) || []).length, 1, 'a resposta escolhida fica marcada');
  assert.match(h, /A regra muda \(para os próximos vídeos também\)/);
  const visivel = h.replace(/<[^>]*>/g, ' ');
  assert.ok(!/S47-01-R\d/.test(visivel), 'o id da pergunta não aparece na tela');
  assert.ok(!/trava|removidos|o_que/i.test(visivel), visivel);
  assert.ok(h.includes(`data-chave="${chave}"`) && h.includes('data-valor="S47-01-R2|so_neste"'));
  const m = blocoRegras({ perguntas: [{ ...q[0], pedido: MAL, feito: MAL, regra: MAL, novo: MAL, onde: MAL }], chave, pode: true });
  assert.ok(!m.includes(MAL) && m.includes('&lt;img src=x onerror=alert(1)&gt;'), 'conteúdo do Drive escapado');
  const so = blocoRegras({ perguntas: q, chave, pode: false });
  assert.equal((so.match(/data-acao="regra-responder"[^>]*disabled/g) || []).length, 9, 'quem só vê não responde');
  assert.equal(blocoRegras({ perguntas: [], chave }), '');
});

test('YAML `regras` na decisão do storyboard: só id e resposta; volta igual na leitura; inválida não vale', () => {
  const regras = [{ id: 'S47-01-R2', resposta: 'so_neste' }, { id: 'S47-01-R1', resposta: 'mudar' }, { id: 'S47-02-R1', resposta: 'mudar' },
    { id: 'S47-01-R3', resposta: 'talvez' }];
  const p = planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', observacoes: 'geral', regras, email: ROBERTTA, agora: AGORA });
  assert.equal(p.ok, true);
  assert.match(p.conteudo, /\nobservacoes: "geral"\nregras:\n {2}- id: S47-01-R1\n {4}resposta: mudar\n {2}- id: S47-01-R2\n {4}resposta: so_neste\nquem: [^\n]+\nquando: 2026-11-18T10:30:00-03:00\n---\n$/);
  assert.ok(!p.conteudo.includes('S47-02') && !p.conteudo.includes('talvez'), 'pergunta de outro roteiro ou resposta fora da lista não entram');
  assert.deepEqual(p.payload.regras, [{ id: 'S47-01-R1', resposta: 'mudar' }, { id: 'S47-01-R2', resposta: 'so_neste' }]);
  const lida = lerDecisaoStoryboard(p.conteudo);
  assert.deepEqual(lida.regras, p.payload.regras);
  assert.equal(lida.observacoes, 'geral', 'os itens de regras não viram campo de topo');
  assert.equal(lida.id, 'S47-01');
  assert.equal(decisaoValida(lida, { id: 'S47-01', versao: 2 }), true);
  const ruim = p.conteudo.replace('resposta: mudar', 'resposta: apague');
  assert.equal(decisaoValida(lerDecisaoStoryboard(ruim), { id: 'S47-01', versao: 2 }), false, 'como o motor: resposta fora da lista invalida');
  const sem = planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', email: ROBERTTA, agora: AGORA });
  assert.ok(!sem.conteudo.includes('regras'), 'sem resposta, sem o campo');
});

test('YAML `regras` nos ajustes, com quem e quando; na decisão de roteiro; na escolha do gancho', () => {
  const regras = [{ id: 'S47-01-R3', resposta: 'manter' }];
  const aj = planejarArquivoRevisao({
    id: 'S47-01', decisao: 'ajustar', versao: 2, email: ROBERTTA, agora: AGORA,
    ajustes: [{ versao: 'ig', tempo: '0:12', pedido: 'tirar o zoom', como: '' }], regras,
  });
  assert.equal(aj.ok, true);
  assert.equal(aj.conteudo, `---
id: S47-01
versao_base: 2
decisao: ajustar
ajustes:
  - versao: ig
    tempo: "0:12"
    pedido: "tirar o zoom"
observacoes: ""
regras:
  - id: S47-01-R3
    resposta: manter
quem: ${ROBERTTA.toLowerCase()}
quando: 2026-11-18T10:30:00-03:00
---
`);
  const lido = parseAjustes(aj.conteudo);
  assert.equal(lido.quem, ROBERTTA.toLowerCase());
  assert.equal(lido.quando, '2026-11-18T10:30:00-03:00');
  assert.deepEqual(lido.regras, regras);
  assert.equal(lido.ajustes.length, 1, 'os itens de regras não viram ajuste');

  const rt = textoDecisaoRoteiro({ id: 'S47-01', versao: 2, decisao: 'mudar', pedido: 'p', regras: [{ id: 'S47-01-R3', resposta: 'so_neste' }], quem: ROBERTTA, quando: AGORA });
  assert.match(rt, /\nmotivo: ""\nregras:\n {2}- id: S47-01-R3\n {4}resposta: so_neste\nquem: [^\n]+\nquando: 2026-11-18T10:30:00-03:00\n---\n$/);
  const lrt = lerDecisaoRoteiro(rt);
  assert.equal(lrt.id, 'S47-01', 'o "- id:" da pergunta não troca o id do roteiro');
  assert.deepEqual(lrt.regras, [{ id: 'S47-01-R3', resposta: 'so_neste' }]);
  assert.ok(!textoDecisaoRoteiro({ id: 'S47-01', versao: 2, decisao: 'aprovar', quem: ROBERTTA }).includes('regras'));

  const g = planejarEscolhaGancho({ id: 'S47-01', versao: 1, escolha: '2', regras: [{ id: 'S47-01-R1', resposta: 'mudar' }], email: ROBERTTA, agora: AGORA });
  assert.match(g.conteudo, /\nobservacoes: ""\nregras:\n {2}- id: S47-01-R1\n {4}resposta: mudar\nquem: /);
  const lg = lerEscolhaGancho(g.conteudo);
  assert.equal(lg.id, 'S47-01');
  assert.deepEqual(lg.regras, [{ id: 'S47-01-R1', resposta: 'mudar' }]);
  assert.equal(escolhaValida(lg, { id: 'S47-01', versao: 1 }), true);
  assert.equal(escolhaValida({ ...lg, regras: [{ id: 'S47-09-R1', resposta: 'mudar' }] }, { id: 'S47-01', versao: 1 }), false);
});

test('leitura como o motor: "só neste" vira so_neste; id ou resposta inválidos são o problema da decisão', () => {
  assert.deepEqual(lerRegrasYaml('---\nid: S47-01\nregras:\n  - id: S47-01-R1\n    resposta: "Só neste"\n  - resposta: mudar\n    id: S47-01-R2\nquem: x\n---\n'),
    [{ id: 'S47-01-R1', resposta: 'so_neste' }, { id: 'S47-01-R2', resposta: 'mudar' }]);
  assert.equal(problemaRegras([{ id: 'S47-01-R1', resposta: 'mudar' }], 'S47-01'), '');
  assert.match(problemaRegras([{ id: 'S47-02-R1', resposta: 'mudar' }], 'S47-01'), /id de pergunta/);
  assert.match(problemaRegras([{ id: 'S47-01-R1', resposta: 'sim' }], 'S47-01'), /resposta fora/);
  assert.deepEqual(linhasRegras([], 'S47-01'), []);
  assert.equal(ridValido('T01-01-R12', 'T01-01'), true);
  assert.equal(ridValido('T01-01-R12', 'T01'), false);
});

test('"Aprovar" com "Mudar a regra" (ou "Só neste vídeo") vira pedido de mudança; "Manter" não; gancho não muda', () => {
  const perguntas = lerPerguntasRegra(SECAO, 'S47-01');
  const mudar = { 'S47-01-R1': 'mudar' };
  const sb = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: mudar, id: 'S47-01', alvo: 'storyboard' });
  assert.equal(sb.decisao, 'ajustar');
  assert.equal(sb.virou, true);
  assert.deepEqual(sb.regras, [{ id: 'S47-01-R1', resposta: 'mudar' }]);
  assert.equal(sb.pedido, 'Fazer o pedido que esperava a resposta sobre a regra: "pôr a pergunta num cartão" (IG, quadro 4).');
  const pv = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { 'S47-01-R3': 'so_neste' }, id: 'S47-01', alvo: 'previa' });
  assert.equal(pv.decisao, 'ajustar', '"Só neste vídeo" também: aprovada, a prévia sairia sem o pedido');
  assert.deepEqual(pv.regras, [{ id: 'S47-01-R3', resposta: 'so_neste' }]);
  const rt = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: mudar, id: 'S47-01', alvo: 'roteiro' });
  assert.equal(rt.decisao, 'mudar', 'no roteiro, o pedido de mudança é "mudar"');
  const manter = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { 'S47-01-R1': 'manter' }, id: 'S47-01', alvo: 'storyboard' });
  assert.equal(manter.decisao, 'aprovar');
  assert.deepEqual(manter.regras, [{ id: 'S47-01-R1', resposta: 'manter' }], 'no storyboard, "Manter" vai com a aprovação');
  const pvManter = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { 'S47-01-R1': 'manter' }, id: 'S47-01', alvo: 'previa' });
  assert.deepEqual([pvManter.decisao, pvManter.regras], ['aprovar', []], 'a aprovação da prévia não tem o campo');
  const gc = decisaoComRegras({ decisao: '2', perguntas, respostas: mudar, id: 'S47-01', alvo: 'gancho' });
  assert.deepEqual([gc.decisao, gc.virou, gc.regras.length], ['2', false, 1]);
  const aj = decisaoComRegras({ decisao: 'ajustar', perguntas, respostas: mudar, id: 'S47-01', alvo: 'previa' });
  assert.deepEqual([aj.decisao, aj.virou], ['ajustar', false]);
  assert.match(textoDoPedidoDasRegras(perguntas, [{ id: 'S47-01-R1', resposta: 'mudar' }, { id: 'S47-01-R2', resposta: 'so_neste' }]),
    /^Fazer os pedidos que esperavam a resposta sobre a regra: "pôr a pergunta num cartão" \(IG, quadro 4\); "põe a pergunta/);
  assert.equal(textoDoPedidoDasRegras(perguntas, [{ id: 'S47-01-R1', resposta: 'manter' }]), '');
  assert.deepEqual(regrasRespondidas(perguntas, { 'S47-01-R9': 'mudar', 'S47-01-R2': 'nada' }, 'S47-01'), [], 'só perguntas da tela e respostas da lista');

  // o arquivo que sai: ajustar com o pedido que esperava a regra (o motor exige um pedido no ajustar)
  const plano = planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: sb.decisao, observacoes: sb.pedido, regras: sb.regras, email: ROBERTTA, agora: AGORA });
  assert.equal(plano.ok, true);
  assert.equal(decisaoValida(lerDecisaoStoryboard(plano.conteudo), { id: 'S47-01', versao: 2 }), true);
  const ajPv = planejarArquivoRevisao({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: [], observacoes: pv.pedido, regras: pv.regras, email: ROBERTTA, agora: AGORA });
  assert.equal(ajPv.ok, true, 'a prévia sem ajuste na lista: vale o pedido geral');
  assert.match(ajPv.conteudo, /\najustes: \[\]\nobservacoes: "Fazer o pedido que esperava/);
  assert.equal(parseAjustes(ajPv.conteudo).observacoes.startsWith('Fazer o pedido'), true);
  assert.throws(() => gerarAjustes({ id: 'S47-01', versaoBase: 2, ajustes: [] }), /pelo menos um ajuste/, 'sem ajuste e sem pedido geral, não grava');
});

test('na tela: o "Aprovar" vira "Refazer … com o seu pedido", com o aviso; as janelas mostram as respostas', () => {
  const perguntas = lerPerguntasRegra(SECAO, 'S47-01');
  const r = {
    id: 'S47-01', etapa: 'storyboard', titulo: 'Volta', teste: false,
    storyboard: { versao: 2, lido: true, erro: false, temDecisao: false, decisao: null, notas: [], mudancas: [], regras: perguntas,
      quadros: { ig: [{ n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', file: null }], tt: [] } },
  };
  estado.sbPendentes = {};
  estado.respostasRegra = {};
  let d = painelDecisaoStoryboard(r, { email: ROBERTTA, agora: AGORA });
  assert.match(d, /3 pedidos esbarraram numa regra/);
  assert.match(d, /Aprovar o storyboard v2/);
  estado.respostasRegra[chaveRespostas('sb', 'S47-01', 2)] = { 'S47-01-R1': 'mudar' };
  d = painelDecisaoStoryboard(r, { email: ROBERTTA, agora: AGORA });
  assert.match(d, /Refazer o storyboard com o seu pedido/);
  assert.match(d, /o motor faz o storyboard v3 com ele/);
  assert.ok(!d.includes('Aprovar o storyboard v2'));
  estado.respostasRegra[chaveRespostas('sb', 'S47-01', 2)] = { 'S47-01-R1': 'manter' };
  assert.match(painelDecisaoStoryboard(r, { email: ROBERTTA, agora: AGORA }), /Aprovar o storyboard v2/, '"Manter" não muda o aprovar');
  estado.respostasRegra = {};
  const g = painelDecisaoStoryboard(r, { email: GABRIEL, agora: AGORA });
  assert.equal((g.match(/data-acao="regra-responder"[^>]*disabled/g) || []).length, 9, 'quem só vê não responde');
  // depois de enviar: as respostas que foram
  const enviada = { ...r, storyboard: { ...r.storyboard, temDecisao: true, decisao: { decisao: 'ajustar', ajustes: [], observacoes: '', regras: [{ id: 'S47-01-R1', resposta: 'mudar' }] } } };
  assert.match(painelDecisaoStoryboard(enviada, { email: ROBERTTA, agora: AGORA }), /Suas respostas sobre a regra[\s\S]*Mudar a regra:<\/strong> “pôr a pergunta num cartão”/);

  const js = janelaStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', observacoes: 'Fazer o pedido', regras: [{ id: 'S47-01-R1', resposta: 'mudar' }], perguntas, virou: true });
  assert.match(js, /Por que vai como pedido de mudança/);
  assert.match(js, /Mudar a regra:<\/strong> “pôr a pergunta num cartão”/);
  const jp = janelaPrevia({ id: 'S47-01', versao: 2, decisao: 'ajustar', ajustes: [], regras: [{ id: 'S47-01-R3', resposta: 'so_neste' }], perguntas, virou: true, pedidoRegras: 'Fazer o pedido X' });
  assert.match(jp, /Por que vai como ajuste/);
  assert.match(jp, /O pedido que vai junto/);
  assert.match(jp, /Enviar o pedido da v2\?/);
  assert.match(jp, /Só neste vídeo:<\/strong> “um gancho mais longo”/);
  const jg = janelaGancho({ id: 'S47-01', versao: 1, escolha: '2', opcao: { n: 2, fala: 'f' }, regras: [{ id: 'S47-01-R1', resposta: 'manter' }], perguntas });
  assert.match(jg, /Manter:<\/strong> “pôr a pergunta num cartão”/);
  assert.equal(listaRespostas(perguntas, []), '');

  // rascunho: as perguntas antes dos botões; "Aprovar" com "Mudar a regra" vira "Refazer o rascunho com o seu pedido"
  const rot = { id: 'S47-01', etapa: 'rascunho', versaoRoteiro: 2, versoesRoteiro: [1, 2], temFinal: false, lido: true, fontes: [], fontesConferidas: true, perguntasRegra: perguntas };
  const respostasRegra = { [chaveRespostas('rt', 'S47-01', 2)]: { 'S47-01-R3': 'mudar' } };
  const h = decisaoDoRascunho(rot, { email: ROBERTTA, escolha: 'aprovar', exec: { execucoes: [] }, agora: AGORA, respostasRegra });
  assert.match(h, /Refazer o rascunho com o seu pedido/);
  assert.match(h, /o motor faz um rascunho novo com ele/);
  assert.ok(h.indexOf('regra-responder') < h.indexOf('roteiro-escolher'), 'as perguntas vêm antes dos botões');
  assert.match(decisaoDoRascunho(rot, { email: ROBERTTA, escolha: 'aprovar', exec: { execucoes: [] }, agora: AGORA, respostasRegra: {} }), /Aprovar a v2<\/button>/);
  const gr = { id: 'S47-01', etapa: 'ganchos', titulo: 't', propostaGanchos: { versao: 1, lido: true, opcoes: [{ n: 1, fala: 'a' }], regras: perguntas } };
  assert.match(escolhaDosGanchos(gr, { email: ROBERTTA, agora: AGORA, respostasRegra: {} }), /A resposta vai junto com a escolha do gancho\./);
  const ex = extrasDasRegras(perguntas, [{ id: 'S47-01-R3', resposta: 'mudar' }], true);
  assert.deepEqual(ex.map((x) => x.chave), ['regra-virou', 'regras']);
  assert.deepEqual(ex[1].lista, ['Mudar a regra: “um gancho mais longo”']);
});

test('"Cole no chat" nunca leva as respostas; a ponte também não', () => {
  const lista = [{ versao: 'ig', tempo: '0:12', pedido: 'tirar o zoom', como: '', regras: [{ id: 'S47-01-R1', resposta: 'mudar' }] }];
  const texto = textoDosAjustes(lista);
  assert.equal(texto, 'Instagram, em 0:12: tirar o zoom');
  assert.ok(!/regra|S47-01-R|mudar/i.test(texto));
  const fonte = (arq) => readFileSync(new URL(`../js/${arq}`, import.meta.url), 'utf8');
  const acoes = fonte('acoes.js');
  const copiar = acoes.slice(acoes.indexOf("async 'ajustes-copiar'(el)"), acoes.indexOf("'previa-aprovar'(el)"));
  assert.ok(copiar.includes('textoDosAjustes(lista)'), 'o texto copiado é só a lista de ajustes');
  assert.ok(!/regras|respostasRegra|decisaoComRegras/.test(copiar.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), copiar);
  const integra = fonte('integra.js');
  const ponte = integra.slice(integra.indexOf('async decidirRoteiro('), integra.indexOf('/* Andamento do Motor Reels'));
  assert.match(ponte, /dadosLimpos\(\{ id, versao: v, decisao, pedido: String\(pedido \|\| ''\), motivo: String\(motivo \|\| ''\) \}\)/);
  assert.ok(!ponte.includes('regras'), 'a ponte (chat do Roteirista) não leva as respostas');
});

test('gravar pela central: o conteúdo leva `regras` (prévia com quem e quando; storyboard)', async () => {
  const { Integra } = await import('../js/integra.js');
  const guardado = new Map();
  const antes = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, String(v)), removeItem: (k) => guardado.delete(k) };
  const orig = { listar: Integra.drive.listarRevisao, enviar: Integra.central.enviarSePuder, jaPedido: Integra.central.jaPedido };
  const enviados = [];
  Integra.drive.listarRevisao = async () => [];
  Integra.central.jaPedido = async () => false;
  Integra.central.enviarSePuder = async (p) => { enviados.push(p); return { id: 'p1' }; };
  try {
    guardado.set('motor.sessao', JSON.stringify({ access_token: 'x', email: ROBERTTA, expires_at: Date.now() + 3600e3 }));
    const regras = [{ id: 'S47-01-R1', resposta: 'mudar' }];
    let r = await Integra.drive.gravarDecisaoPrevia({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: [{ versao: 'tt', pedido: 'x' }], regras });
    assert.equal(r.ok, true);
    assert.equal(enviados[0].tipo, 'decisao_previa');
    assert.match(enviados[0].conteudo, /\nregras:\n {2}- id: S47-01-R1\n {4}resposta: mudar\nquem: [^\n]+@[^\n]+\nquando: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00\n---\n$/);
    r = await Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', observacoes: 'x', regras });
    assert.equal(r.ok, true);
    assert.deepEqual(lerDecisaoStoryboard(enviados[1].conteudo).regras, regras);
  } finally {
    Integra.drive.listarRevisao = orig.listar;
    Integra.central.enviarSePuder = orig.enviar;
    Integra.central.jaPedido = orig.jaPedido;
    globalThis.localStorage = antes;
  }
});

// a linha `motivo:` (bin/regras.py) vale mais que a frase; sem ela a frase decide (includes, não startsWith)
const comMotivo = (motivo, frase) => SECAO.replace('pergunta: mudar a regra, fazer só neste vídeo ou manter?',
  `${motivo ? `motivo: ${motivo}\n` : ''}pergunta: ${frase}`);
const FRASE_RESERVA = 'sua resposta não veio pelo app e valeu só para este vídeo. Mudar a regra, fazer só neste vídeo ou manter?';

test('motivo: reserva pela linha, pela frase (fallback) e pela frase reescrita; sumiu continua como antes', () => {
  const r = (t) => lerPerguntasRegra(t, 'S47-01')[0];
  assert.equal(r(comMotivo('reserva', 'a resposta ficou na reserva. Mudar a regra, fazer só neste vídeo ou manter?')).reserva, true, 'linha');
  assert.equal(r(comMotivo('', FRASE_RESERVA)).reserva, true, 'só a frase');
  assert.equal(r(comMotivo('', 'Atenção: a sua resposta não veio pelo app. Mudar a regra, fazer só neste vídeo ou manter?')).reserva, true, 'frase reescrita');
  assert.equal(r(comMotivo('sumiu', 'a regra mudou antes da sua resposta e nada foi trocado. Mudar a regra, fazer só neste vídeo ou manter?')).reserva, false);
  assert.equal(r(comMotivo('sumiu', FRASE_RESERVA)).reserva, false, 'a linha vence a frase');
  assert.equal(r(comMotivo('reescrita', 'a regra foi reescrita. Mudar a regra, fazer só neste vídeo ou manter?')).reserva, false);
  assert.equal(r(comMotivo('reserva', 'x. Mudar a regra, fazer só neste vídeo ou manter?')).motivo, 'x.');
  assert.ok(!('tipo' in r(comMotivo('reserva', FRASE_RESERVA))));
});

// Revisão final C (M1): a resposta dela a uma pergunta de regra, antes de a decisão sair, é trabalho em andamento:
// a versão nova do app (v40) não pode recarregar sozinha e apagar o "Mudar a regra" que virou "Refazer o storyboard".
test('respostas de regra não enviadas contam como trabalho em andamento (a recarga automática espera)', () => {
  assert.equal(respostasNaoEnviadas({}), false);
  assert.equal(respostasNaoEnviadas(undefined), false);
  assert.equal(respostasNaoEnviadas({ [chaveRespostas('storyboard', 'S47-01', 2)]: {} }), false, 'tocou e desfez');
  assert.equal(respostasNaoEnviadas({ [chaveRespostas('storyboard', 'S47-01', 2)]: { 'S47-01-R1': 'mudar' } }), true);
  assert.equal(respostasNaoEnviadas({ a: {}, b: { 'S47-02-R1': 'manter' } }), true, 'Manter também é resposta');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const corpo = main.slice(main.indexOf('function trabalhoEmAndamento()'), main.indexOf('let recarregando'));
  assert.match(corpo, /if \(respostasNaoEnviadas\(estado\.respostasRegra\)\) return true;/,
    'trabalhoEmAndamento (js/main.js) consulta as respostas de regra');
  assert.ok(corpo.indexOf('respostasNaoEnviadas') < corpo.indexOf('return false;'), 'antes do "return false"');
});
