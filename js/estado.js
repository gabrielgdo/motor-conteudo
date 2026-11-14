// Estado da tela (como no desenho aprovado):
//   estado   = onde a pessoa está e o que escolheu
//   rascunho = o que foi digitado nos campos (atributo data-modelo), para não se perder quando a
//              tela é redesenhada
//   estado.erros = mensagens de validação por campo

export const estado = {
  logada: false,
  rota: { nome: 'inicio', id: null },
  filtroPautas: 'todas',
  filtroRoteiros: 'aprovar',
  abaRoteiro: 'ig',
  versaoVista: {}, // id do roteiro -> número da versão do vídeo que está na tela
  pendentes: {}, // "<id> v<N>" -> ajustes que ela juntou na lista nesta sessão (só em memória)
  metrica: 'views',
  arquivo: null, // { nome, total, file } do vídeo escolhido (etapa 2)
  envio: null, // { id, nome, nomeFinal, total, enviado, fase } (etapa 2)
  erros: {},
};

export const rascunho = {};
