// Estado da tela (como no desenho aprovado):
//   estado   = onde a pessoa está e o que escolheu
//   rascunho = o que foi digitado nos campos (atributo data-modelo), para não se perder quando a
//              tela é redesenhada
//   estado.erros = mensagens de validação por campo

const inicial = () => ({
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
});

export const estado = inicial();

export const rascunho = {};

/** Ao sair da conta: estado da tela como no começo e rascunhos dos campos apagados (os mesmos objetos). */
export function reiniciarEstado() {
  for (const k of Object.keys(estado)) delete estado[k];
  Object.assign(estado, inicial());
  for (const k of Object.keys(rascunho)) delete rascunho[k];
}
