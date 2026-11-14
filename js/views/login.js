// Tela de login: logo, título em Lora e botão "Entrar com Google".

import { el, limpar } from '../ui.js';
import { carregarGis, entrar } from '../auth.js';

export function render(container, aoEntrar) {
  const mensagem = el('p', { class: 'login-msg', role: 'status', 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'btn btn-principal btn-grande', disabled: true }, 'Carregando…');

  const pronto = () => { btn.disabled = false; btn.textContent = 'Entrar com Google'; };
  const prepararGis = () => {
    btn.disabled = true;
    btn.textContent = 'Carregando…';
    carregarGis().then(() => { pronto(); mensagem.textContent = ''; }, (e) => {
      mensagem.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Tentar de novo';
      btn.dataset.recarregar = '1';
    });
  };

  btn.addEventListener('click', async () => {
    if (btn.dataset.recarregar) { delete btn.dataset.recarregar; prepararGis(); return; }
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    mensagem.textContent = '';
    try {
      await entrar();
      aoEntrar();
    } catch (e) {
      mensagem.textContent = e?.message || 'Não foi possível entrar agora. Tente de novo.';
      pronto();
    }
  });

  limpar(container).append(
    el('div', { class: 'login' },
      el('div', { class: 'login-card' },
        el('img', { src: './icons/icon-192.png', alt: '', class: 'login-logo', width: '96', height: '96' }),
        el('h1', {}, 'Motor de Conteúdo'),
        el('p', { class: 'suave' }, 'Seus vídeos, roteiros e pacotes em um só lugar.'),
        btn,
        mensagem)));

  prepararGis();
}
