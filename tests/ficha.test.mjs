// Ficha (js/telas/ficha.js): o texto livre do Radar separado pelos rótulos em MAIÚSCULAS, os números
// tirados da frase e o HTML seguro dos trechos. Sem DOM; textos de exemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separarTextoRadar, fichaDoTexto, numerosDoTexto, referenciasEmLista, htmlTextoRadar } from '../js/telas/ficha.js';

export const RADAR = "PÚBLICO/SITUAÇÃO: adultos que querem se vincular, mas vivem à espera de que a pessoa desista deles. PERGUNTA: por que o medo de ser abandonado(a) faz ler sinais neutros do parceiro como rejeição, e o que isso faz com a relação? ENTREGA: distinguir o medo de abandono (sensibilidade à rejeição) do risco real de a relação acabar. ORIGENS: sinal editorial = post no X de 12/11/2026; sem documento CFP/CRP. DATAS: coleta 14/11/2026; pauta perene. REFERÊNCIAS (consultado só o resumo, não o texto integral): (1) Rejection sensitivity and romantic relationships, 2023, https://doi.org/10.1016/j.paid.2023.112186 (60 estudos) - sustenta com limites; (2) Li & Chan 2012, https://onlinelibrary.wiley.com/doi/10.1002/ejsp.1842 (DOI 10.1002/ejsp.1842; 73 estudos) - sustenta com limites; (3) Rejection sensitivity and adult attachment (http://hdl.handle.net/10871/127156) - só estudos transversais. LIMITES: correlacional; autorrelato; sem promessa de cura. Recorte novo frente a 2026-11-10-05.";

const sp = (s) => String(s).replace(/ /g, ' ');

test('separa nos rótulos do Radar, com nota no parêntese', () => {
  const p = separarTextoRadar(RADAR);
  assert.deepEqual(p.map((x) => x.chave), ['PÚBLICO/SITUAÇÃO', 'PERGUNTA', 'ENTREGA', 'ORIGENS', 'DATAS', 'REFERÊNCIAS', 'LIMITES']);
  assert.equal(p[5].nota, 'consultado só o resumo, não o texto integral');
  assert.match(p[3].texto, /sem documento CFP\/CRP\.$/);
  assert.match(p[5].texto, /DOI 10\.1002\/ejsp\.1842/);
  assert.match(p[6].texto, /Recorte novo frente a 2026-11-10-05\.$/);
  assert.equal(p[0].rotulo, 'Para quem');
  assert.equal(p[0].texto, 'adultos que querem se vincular, mas vivem à espera de que a pessoa desista deles.');
});

test('sem rótulos: uma parte só; vazio: nada', () => {
  assert.deepEqual(separarTextoRadar('Ângulo curto'), [{ chave: '', rotulo: '', nota: '', texto: 'Ângulo curto' }]);
  assert.deepEqual(separarTextoRadar('  '), []);
  assert.deepEqual(separarTextoRadar(undefined), []);
});

test('rótulo desconhecido vira nome com só a primeira letra maiúscula', () => {
  const p = separarTextoRadar('GANCHO EXTRA: algo');
  assert.equal(p[0].rotulo, 'Gancho extra');
});

test('ficha: pergunta vira título (primeira letra maiúscula), entrega à parte, seções na ordem', () => {
  const f = fichaDoTexto(RADAR);
  assert.match(f.titulo, /^Por que o medo de ser abandonado\(a\)/);
  assert.match(f.entrega, /^distinguir o medo/);
  assert.deepEqual(f.secoes.map((s) => s.rotulo), ['Para quem', 'Referências', 'Limites', 'Origem', 'Datas']);
  assert.equal(f.secoes[1].nota, 'consultado só o resumo, não o texto integral');
});

test('ficha sem rótulos: curto fica inteiro; longo vira primeira frase + Resumo', () => {
  assert.deepEqual(fichaDoTexto('Ângulo curto'), { titulo: 'Ângulo curto', entrega: '', secoes: [] });
  const longo = 'Primeira frase com sentido. ' + 'x'.repeat(200);
  const f = fichaDoTexto(longo);
  assert.equal(f.titulo, 'Primeira frase com sentido.');
  assert.deepEqual(f.secoes.map((s) => s.rotulo), ['Resumo']);
  assert.equal(f.secoes[0].texto, 'x'.repeat(200));
});

test('números tirados da frase livre, compactos', () => {
  const n = numerosDoTexto('Visualizações: 230.111 impressões, 16.000 curtidas, 4.618 reposts, 929 salvamentos (X, coleta 14/11/2026)');
  assert.deepEqual(n.map((x) => [sp(x.valor), x.rotulo]),
    [['230,1 mil', 'impressões'], ['16 mil', 'curtidas'], ['4,6 mil', 'reposts'], ['929', 'salvamentos']]);
  assert.deepEqual(numerosDoTexto('muitas'), []);
  assert.deepEqual(numerosDoTexto('120000'), []);
});

test('referências numeradas viram lista', () => {
  const r = referenciasEmLista(separarTextoRadar(RADAR)[5].texto);
  assert.equal(r.length, 3);
  assert.match(r[1], /^Li & Chan 2012/);
  assert.doesNotMatch(r[0], /;$/);
  assert.deepEqual(referenciasEmLista('sem numeração'), ['sem numeração']);
});

test('htmlTextoRadar: escapa tudo, link só https', () => {
  const h = htmlTextoRadar('veja https://a.org/x?y=1&z=2, http://b.org e <img src=x onerror=alert(1)> javascript:alert(1)');
  assert.match(h, /<a href="https:\/\/a\.org\/x\?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">https:\/\/a\.org\/x\?y=1&amp;z=2<\/a>, /);
  assert.doesNotMatch(h, /href="http:/);
  assert.match(h, /http:\/\/b\.org/);
  assert.ok(!h.includes('<img'));
  assert.doesNotMatch(h, /href="javascript/);
  assert.match(htmlTextoRadar('(https://a.org/y)'), /\(<a href="https:\/\/a\.org\/y"[^>]*>https:\/\/a\.org\/y<\/a>\)/);
  const aspas = htmlTextoRadar('https://x.org/"onmouseover=alert(1)');
  assert.doesNotMatch(aspas, /"onmouseover/); // a aspa nunca fecha o atributo
  assert.match(aspas, /&quot;onmouseover/);
});

test('rótulo com HTML continua texto puro (quem monta o HTML escapa)', () => {
  const f = fichaDoTexto('PERGUNTA: <b>oi</b>? ENTREGA: x');
  assert.equal(f.titulo, '<b>oi</b>?');
  assert.equal(f.entrega, 'x');
});

test('palavra em maiúscula colada antes de um rótulo conhecido não engole o rótulo', () => {
  const p = separarTextoRadar('ORIGENS: sem documento CFP/CRP DATAS: coleta 14/11');
  assert.deepEqual(p.map((x) => [x.chave, x.texto]), [['ORIGENS', 'sem documento CFP/CRP'], ['DATAS', 'coleta 14/11']]);
});
