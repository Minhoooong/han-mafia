(() => {
  const originalIo = window.io;
  if (typeof originalIo !== 'function') return;

  let socket = null;
  let unlocked = sessionStorage.getItem('hanMafiaAdminUnlocked') === '1';
  let clickCount = 0;
  let clickTimer = null;
  let panel = null;
  let playerList = null;
  let statusText = null;
  let reopenButton = null;
  let enablePending = false;
  let adminActive = false;

  window.io = (...args) => {
    const createdSocket = originalIo(...args);
    if (!socket) {
      socket = createdSocket;
      bindSocket();
    }
    return createdSocket;
  };

  function showToast(message, type = 'success') {
    const container = document.querySelector('#toastContainer');
    if (!container) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .beta.admin-trigger{cursor:pointer;border:1px solid rgba(124,92,255,.25);font:inherit}
      .admin-reopen{position:fixed;z-index:199;right:18px;bottom:18px;width:46px;height:46px;border-radius:15px;color:#fff;background:#6c4fe4;border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 40px rgba(0,0,0,.4);font-weight:900}
      .admin-drawer{position:fixed;z-index:200;right:18px;top:18px;width:min(390px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;padding:18px;border-radius:20px;background:rgba(11,14,21,.97);border:1px solid rgba(169,149,255,.32);box-shadow:0 28px 100px rgba(0,0,0,.58);backdrop-filter:blur(18px)}
      .admin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.admin-head h2{margin:0;font-size:18px}.admin-head p{margin:5px 0 0;color:#9299a8;font-size:12px}.admin-close{width:34px;height:34px;border-radius:10px;color:#c9ced9;background:#202531;border:1px solid rgba(255,255,255,.08)}
      .admin-status{margin:14px 0;padding:10px 12px;border-radius:12px;background:rgba(124,92,255,.1);color:#c7bcff;font-size:12px}
      .admin-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.admin-actions button{min-height:42px;padding:8px;border-radius:11px;color:#fff;background:#252b38;border:1px solid rgba(255,255,255,.08);font-weight:700}.admin-actions .admin-primary{background:#6c4fe4}.admin-actions .admin-danger{color:#ff9baa;border-color:rgba(255,93,115,.3)}
      .admin-players{display:grid;gap:7px;margin-top:14px}.admin-player{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 11px;border-radius:12px;background:rgba(255,255,255,.035)}.admin-player strong{display:block;font-size:13px}.admin-player small{color:#9299a8}.admin-player button{padding:7px 9px;border-radius:9px;color:#fff;background:#303747;border:1px solid rgba(255,255,255,.08);font-size:11px}.admin-dead{opacity:.52}
      @media(max-width:600px){.admin-drawer{right:10px;top:10px;width:calc(100vw - 20px);max-height:calc(100vh - 20px)}}
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (panel) return;
    panel = document.createElement('aside');
    panel.className = 'admin-drawer hidden';
    panel.innerHTML = `
      <div class="admin-head">
        <div><h2>관리자 테스트 모드</h2><p>방장 전용 · 현재 방에만 적용</p></div>
        <button class="admin-close" type="button">×</button>
      </div>
      <div class="admin-status">방을 만든 뒤 자동으로 연결됩니다.</div>
      <div class="admin-actions">
        <button data-admin="fill" class="admin-primary">봇 5명 충원</button>
        <button data-admin="start">테스트 시작</button>
        <button data-admin="next" class="admin-primary">다음 단계</button>
        <button data-admin="refresh">상태 새로고침</button>
        <button data-admin="reset">상태 초기화</button>
        <button data-admin="remove" class="admin-danger">봇 제거</button>
      </div>
      <div class="admin-players"></div>
    `;
    document.body.appendChild(panel);
    reopenButton = document.createElement('button');
    reopenButton.type = 'button';
    reopenButton.className = 'admin-reopen hidden';
    reopenButton.textContent = 'A';
    reopenButton.title = '관리자 테스트 패널 열기';
    reopenButton.addEventListener('click', () => { panel.classList.remove('hidden'); tryEnable(); });
    document.body.appendChild(reopenButton);
    playerList = panel.querySelector('.admin-players');
    statusText = panel.querySelector('.admin-status');
    panel.querySelector('.admin-close').addEventListener('click', () => panel.classList.add('hidden'));
    panel.querySelector('.admin-actions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-admin]');
      if (!button) return;
      const actions = {
        fill: ['admin:fill-bots', { count: 5 }],
        start: ['admin:start', {}],
        next: ['admin:next', {}],
        refresh: ['admin:state', {}],
        reset: ['admin:reset', {}],
        remove: ['admin:remove-bots', {}]
      };
      const [eventName, payload] = actions[button.dataset.admin];
      command(eventName, payload);
    });
    playerList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-player-id]');
      if (button) command('admin:toggle-player', { playerId: button.dataset.playerId });
    });
  }

  function renderState(state) {
    createPanel();
    adminActive = true;
    reopenButton.classList.remove('hidden');
    statusText.textContent = `방 ${state.code} · ${state.phase} · ${state.round || 0}라운드${state.winner ? ` · ${state.winner} 승리` : ''}`;
    playerList.replaceChildren();
    for (const player of state.players) {
      const row = document.createElement('div');
      row.className = `admin-player ${player.alive ? '' : 'admin-dead'}`;
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = `${player.nickname}${player.isHost ? ' · 방장' : ''}${player.isBot ? ' · 봇' : ''}`;
      const role = document.createElement('small');
      role.textContent = `${player.roleName} · ${player.alive ? '생존' : '사망'}`;
      info.append(name, role);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.dataset.playerId = player.id;
      toggle.textContent = player.alive ? '사망' : '부활';
      row.append(info, toggle);
      playerList.appendChild(row);
    }
  }

  function command(eventName, payload) {
    if (!socket) return showToast('게임 서버에 연결되지 않았습니다.', 'error');
    socket.emit(eventName, payload, (result) => {
      if (!result?.ok) return showToast(result?.error ?? '관리자 명령에 실패했습니다.', 'error');
      if (result.state) renderState(result.state);
    });
  }

  function tryEnable() {
    if (!unlocked || !socket || enablePending || adminActive) return;
    enablePending = true;
    socket.emit('admin:enable', {}, (result) => {
      enablePending = false;
      if (!result?.ok) {
        if (statusText) statusText.textContent = result?.error ?? '방장이 방을 만든 뒤 사용할 수 있습니다.';
        return;
      }
      renderState(result.state);
      panel.classList.remove('hidden');
      showToast('관리자 테스트 모드가 활성화되었습니다.');
    });
  }

  function bindSocket() {
    socket.on('room:state', (state) => {
      const myId = sessionStorage.getItem('mafiaPlayerId');
      if (unlocked && state.hostId === myId) tryEnable();
    });
    socket.on('admin:state', renderState);
  }

  function handleTriggerClick() {
    if (unlocked) {
      createPanel();
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) tryEnable();
      return;
    }
    clickCount += 1;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { clickCount = 0; }, 6000);
    if (clickCount < 10) return;
    unlocked = true;
    sessionStorage.setItem('hanMafiaAdminUnlocked', '1');
    if (reopenButton) reopenButton.classList.remove('hidden');
    clickCount = 0;
    createPanel();
    panel.classList.remove('hidden');
    showToast('숨겨진 관리자 테스트 모드를 발견했습니다.');
    tryEnable();
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    createPanel();
    document.querySelectorAll('.admin-trigger').forEach((trigger) => trigger.addEventListener('click', handleTriggerClick));
    if (unlocked) panel.classList.remove('hidden');
  });
})();