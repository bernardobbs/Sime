// Menu do usuário (🔑 Trocar senha / 🚪 Sair do sistema) — dependurado no
// chip de nome/perfil do topbar. Compartilhado por toda a camada Admin
// (login por e-mail/senha via Supabase Auth), pra não duplicar a mesma
// lógica de dropdown + modal de senha em cada módulo. Pedido direto:
// "ao clicar em cima do seu nome, deve mostrar um menu para ele trocar
// senha ou sair do sistema. essa barra superior deve ficar aberta em todas
// as janelas" — janelas de campo (QR+PIN) ficam de fora de propósito: não
// têm sessão do Supabase Auth, então "trocar senha" não se aplica a elas.
(function () {
  const CSS = `
  .sime-um-wrap{position:relative;display:inline-flex;}
  .sime-um-trigger{cursor:pointer;}
  .sime-um-chip-default{display:flex;align-items:center;gap:6px;padding:6px 10px;
    border-radius:8px;border:1px solid var(--border2,var(--border));background:var(--bg2);
    color:var(--text);font-size:.74rem;font-weight:700;cursor:pointer;white-space:nowrap;}
  .sime-um-chip-role{font-weight:600;color:var(--text2);}
  .sime-um-caret{opacity:.55;font-size:.7em;}
  .sime-um-dropdown{position:absolute;top:calc(100% + 6px);right:0;background:var(--card);
    border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.18);
    min-width:200px;padding:6px;z-index:400;display:none;}
  .sime-um-dropdown.open{display:block;}
  .sime-um-dropdown button{width:100%;text-align:left;padding:9px 11px;border:none;
    background:transparent;border-radius:7px;font-size:.78rem;font-weight:700;
    color:var(--text);cursor:pointer;display:flex;align-items:center;gap:8px;}
  .sime-um-dropdown button:hover{background:var(--bg2);}
  .sime-um-dropdown button.sime-um-sair{color:var(--red,#c0392b);}
  .sime-um-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;
    align-items:center;justify-content:center;z-index:600;padding:16px;}
  .sime-um-modal{background:var(--card);border-radius:13px;width:100%;max-width:360px;
    padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);color:var(--text);}
  .sime-um-modal h3{font-size:.92rem;margin-bottom:4px;}
  .sime-um-modal label{font-size:.74rem;font-weight:700;color:var(--text2);display:block;margin:10px 0 4px;}
  .sime-um-modal input{width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--border2,var(--border));
    background:var(--bg2);color:var(--text);font-size:.85rem;outline:none;box-sizing:border-box;}
  .sime-um-erro{font-size:.72rem;color:var(--red,#c0392b);min-height:1em;margin-top:8px;}
  .sime-um-botoes{display:flex;gap:8px;margin-top:14px;}
  .sime-um-botoes button{flex:1;padding:9px;border-radius:8px;font-size:.8rem;
    font-weight:700;cursor:pointer;border:none;}
  .sime-um-btn-cancelar{background:var(--bg2);color:var(--text2);border:1px solid var(--border2,var(--border)) !important;}
  .sime-um-btn-salvar{background:#2a2a2a;color:#fff;}
  `;

  function ensureCss() {
    if (document.getElementById('sime-um-css')) return;
    const style = document.createElement('style');
    style.id = 'sime-um-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function fecharTodos() {
    document.querySelectorAll('.sime-um-dropdown.open').forEach((d) => d.classList.remove('open'));
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sime-um-wrap')) fecharTodos();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharTodos(); });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function abrirModalSenha(supabase) {
    fecharTodos();
    const overlay = document.createElement('div');
    overlay.className = 'sime-um-overlay';
    overlay.innerHTML = `
      <div class="sime-um-modal">
        <h3>🔑 Trocar senha</h3>
        <label for="sime-um-senha1">Nova senha</label>
        <input type="password" id="sime-um-senha1" autocomplete="new-password">
        <label for="sime-um-senha2">Confirmar nova senha</label>
        <input type="password" id="sime-um-senha2" autocomplete="new-password">
        <div class="sime-um-erro" id="sime-um-erro" role="alert" aria-live="polite"></div>
        <div class="sime-um-botoes">
          <button type="button" class="sime-um-btn-cancelar" id="sime-um-cancelar">Cancelar</button>
          <button type="button" class="sime-um-btn-salvar" id="sime-um-salvar">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const fechar = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    overlay.querySelector('#sime-um-cancelar').onclick = fechar;
    overlay.querySelector('#sime-um-salvar').onclick = async () => {
      const s1 = overlay.querySelector('#sime-um-senha1').value;
      const s2 = overlay.querySelector('#sime-um-senha2').value;
      const erroEl = overlay.querySelector('#sime-um-erro');
      erroEl.textContent = '';
      if (!s1 || s1.length < 6) { erroEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
      if (s1 !== s2) { erroEl.textContent = 'As senhas não coincidem.'; return; }
      const btn = overlay.querySelector('#sime-um-salvar');
      btn.disabled = true; btn.textContent = 'Salvando…';
      try {
        const { error } = await supabase.auth.updateUser({ password: s1 });
        if (error) throw error;
        fechar();
        if (window.showToast) window.showToast('✓ Senha alterada');
      } catch (e) {
        erroEl.textContent = 'Não foi possível trocar a senha — verifique a conexão e tente de novo.';
        btn.disabled = false; btn.textContent = 'Salvar';
      }
    };
    overlay.querySelector('#sime-um-senha1').focus();
  }

  // opts: { chipEl } — usa um elemento já pronto (nome/perfil que a própria
  // página já renderiza, ex.: SIME_admin/SIME_principal) como gatilho; OU
  // { slotEl, nome, perfil } — monta um chip padrão dentro de um container
  // vazio (páginas que ainda não mostravam nome nenhum no topbar). onLogout
  // é opcional (default: recarrega a página, mesmo padrão de sempre).
  window.initSimeUserMenu = function (supabase, opts) {
    try {
      montarMenu(supabase, opts);
    } catch (e) {
      // Menu de conta é sempre um extra sobre a tela principal — uma falha
      // aqui (elemento ausente, stub de teste incompleto) nunca deve
      // impedir o resto da página de terminar de carregar.
    }
  };

  function montarMenu(supabase, opts) {
    ensureCss();
    const { chipEl, slotEl, nome, perfil, onLogout, sairEl } = opts || {};
    let trigger = chipEl || null;
    if (!trigger && slotEl) {
      slotEl.innerHTML = `<button type="button" class="sime-um-chip-default">`
        + `${escapeHtml(nome || 'Usuário')}`
        + `${perfil ? ' <span class="sime-um-chip-role">(' + escapeHtml(perfil) + ')</span>' : ''}`
        + ` <span class="sime-um-caret">▾</span></button>`;
      slotEl.style.display = '';
      trigger = slotEl.querySelector('.sime-um-chip-default');
    }
    if (!trigger) return;

    let wrap = trigger.closest('.sime-um-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sime-um-wrap';
      trigger.parentNode.insertBefore(wrap, trigger);
      wrap.appendChild(trigger);
    }
    trigger.classList.add('sime-um-trigger');

    let dropdown = wrap.querySelector('.sime-um-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'sime-um-dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.innerHTML = `<button type="button" role="menuitem" data-acao="senha">🔑 Trocar senha</button>`;
      wrap.appendChild(dropdown);
      dropdown.querySelector('[data-acao="senha"]').onclick = () => { fecharTodos(); abrirModalSenha(supabase); };

      // sairEl: reaproveita um botão de "Sair" que a própria página já tem
      // (com seu próprio onclick=simeLogout, ver SIME_admin.html) — evita
      // duas ações de logout diferentes na mesma tela. Sem sairEl, o menu
      // cria a própria opção padrão de saída.
      if (sairEl) {
        // Limpa o estilo inline (o botão original era um botão solto no
        // topbar) — dentro do menu ele deve seguir o mesmo visual dos
        // demais itens, via .sime-um-dropdown button no CSS injetado acima.
        sairEl.removeAttribute('style');
        sairEl.classList.add('sime-um-sair');
        sairEl.setAttribute('role', 'menuitem');
        dropdown.appendChild(sairEl);
      } else {
        const btnSair = document.createElement('button');
        btnSair.type = 'button';
        btnSair.setAttribute('role', 'menuitem');
        btnSair.className = 'sime-um-sair';
        btnSair.textContent = '🚪 Sair do sistema';
        btnSair.onclick = async () => {
          fecharTodos();
          try { await supabase.auth.signOut(); } catch (e) { /* segue pro reload mesmo assim */ }
          if (typeof onLogout === 'function') onLogout();
          else location.reload();
        };
        dropdown.appendChild(btnSair);
      }
    }
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.onclick = (e) => {
      e.stopPropagation();
      const jaAberto = dropdown.classList.contains('open');
      fecharTodos();
      if (!jaAberto) dropdown.classList.add('open');
    };
  }
})();
