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
  candidatosVisiveis: 30, // chip Candidatos: quantos cartões aparecem antes do "Mostrar mais"
  janela: null, // janela de confirmação aberta: {tipo, ...} (js/acoes.js)
  // Envio ao Roteirista aceito pela ponte e ainda não visto em Execuções (registro otimista, só em
  // memória): id_pauta -> {desde: ms}. Some quando a releitura mostra a linha (js/envios.js).
  enviosLocais: {},
});

export const estado = inicial();

export const rascunho = {};

/** Ao sair da conta: estado da tela como no começo e rascunhos dos campos apagados (os mesmos objetos). */
export function reiniciarEstado() {
  for (const k of Object.keys(estado)) delete estado[k];
  Object.assign(estado, inicial());
  for (const k of Object.keys(rascunho)) delete rascunho[k];
}
