// Estado da tela (como no desenho aprovado):
//   estado   = onde a pessoa está e o que escolheu
//   rascunho = o que foi digitado nos campos (atributo data-modelo), para não se perder quando a
//              tela é redesenhada
//   estado.erros = mensagens de validação por campo

const inicial = () => ({
  logada: false,
  rota: { nome: 'inicio', id: null },
  filtroPautas: 'decidir', // candidatos | decidir | decididas | todas
  filtroRoteiros: 'aprovar',
  abaRoteiro: 'ig',
  versaoVista: {}, // id do roteiro -> número da versão do vídeo que está na tela
  pendentes: {}, // "<id> v<N>" -> ajustes que ela juntou na lista nesta sessão (só em memória)
  metrica: 'views',
  arquivo: null, // { nome, total, file } do vídeo escolhido (etapa 2)
  envio: null, // { id, nome, nomeFinal, total, enviado, fase } (etapa 2)
  erros: {},
  // Controle manual (só em memória, somem ao sair):
  decisoesPauta: {}, // id_pauta -> 'aprovada' | 'recusada' (ainda não confirmada)
  mudandoPauta: {}, // id_pauta -> true: pauta já decidida aberta para mudar a decisão
  resultadoPautas: {}, // id_pauta -> {acao, mensagem} da última gravação
  decisaoRoteiro: {}, // id do roteiro -> 'aprovar' | 'mudar' | 'recusar' (ainda não enviada)
  versaoRoteiroVista: {}, // id do roteiro -> número da versão do RASCUNHO que está na tela (abas v1 · v2)
  // Decisão de roteiro aceita pela ponte e ainda não vista em Execuções (registro otimista, só em
  // memória): id -> {desde: ms, chave, decisao, versao} (js/decisoes-roteiro.js).
  decisoesEnviadas: {},
  // Escolha de gancho enviada e ainda não vista no Drive (registro otimista, só em memória):
  // id -> {versao, escolha: '1'|'2'|'3'|'outros', desde: ms} (js/ganchos.js).
  ganchosEnviados: {},
  // Storyboard antes das prévias (desde 15/11/2026, só em memória): os pedidos que ela junta por quadro
  // ("<id> sb<N>" -> [{rede, quadro, tempo, pedido}]), o quadro com o campo aberto (id -> "ig:3"), o quadro ampliado
  // (id -> "tt:2") e a decisão enviada ainda não vista no Drive (id -> {versao, decisao, desde}; js/storyboard.js).
  sbPendentes: {},
  sbQuadro: {},
  sbAmpliado: {},
  storyboardsEnviados: {},
  // Perguntas de regra (plano de mídia, §6; só em memória): as respostas dela por decisão, até a decisão sair
  // ("<tipo>:<id>:v<N>" -> {<id da pergunta>: 'mudar' | 'so_neste' | 'manter'}; js/regras.js chaveRespostas).
  respostasRegra: {},
  candidatosVisiveis: 30, // chip Candidatos: quantos cartões aparecem antes do "Mostrar mais"
  janela: null, // janela de confirmação aberta: {tipo, ...} (js/acoes.js)
  // Envio ao Roteirista aceito pela ponte e ainda não visto em Execuções (registro otimista, só em
  // memória): id_pauta -> {desde: ms}. Some quando a releitura mostra a linha (js/envios.js).
  enviosLocais: {},
  // Estado do candidato no app (`_motor/app/candidatos/<id>.json`) gravado nesta sessão (registro
  // otimista: id -> {id, estado, motivo, historico, quando, pendente?}); o lido do Drive vale quando
  // for mais novo (js/candidatos.js: mesclarEstadosApp).
  candidatosLocais: {},
  errosCandidato: {}, // id -> {mensagem, para}: a gravação falhou (o cartão mostra "Tentar de novo")
  verExcluidos: false, // chip Candidatos: a lista "Excluídos (n)" aberta
});

export const estado = inicial();

export const rascunho = {};

/** Ao sair da conta: estado da tela como no começo e rascunhos dos campos apagados (os mesmos objetos). */
export function reiniciarEstado() {
  for (const k of Object.keys(estado)) delete estado[k];
  Object.assign(estado, inicial());
  for (const k of Object.keys(rascunho)) delete rascunho[k];
}
