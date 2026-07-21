const socket = io();

const $ = (selector) => document.querySelector(selector);
const landing = $('#landing');
const game = $('#game');
const nicknameInput = $('#nickname');
const roomCodeInput = $('#roomCode');
const createRoomButton = $('#createRoom');
const joinRoomButton = $('#joinRoom');
const copyCodeButton = $('#copyCode');
const leaveRoomButton = $('#leaveRoom');
const startGameButton = $('#startGame');
const playersEl = $('#players');
const playerCountEl = $('#playerCount');
const roundLabel = $('#roundLabel');
const phaseTitle = $('#phaseTitle');
const phaseDescription = $('#phaseDescription');
const timerEl = $('#timer');
const roleCard = $('#roleCard');
const roleName = $('#roleName');
const roleDescription = $('#roleDescription');
const teammatesEl = $('#teammates');
const actionArea = $('#actionArea');
const messagesEl = $('#messages');
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatStatus = $('#chatStatus');
const roleReveal = $('#roleReveal');

let roomState = null;
let playerState = null;
let myPlayerId = sessionStorage.getItem('mafiaPlayerId');
let countdownInterval = null;

const phaseContent = {
  lobby: ['플레이어를 기다리는 중', '5명 이상 모이면 방장이 게임을 시작할 수 있습니다.'],
  reveal: ['역할을 확인하세요', '5초 뒤 첫 번째 밤이 시작됩니다.'],
  night: ['밤이 되었습니다', '능력이 있는 플레이어는 조용히 대상을 선택하세요.'],
  dawn: ['동이 트고 있습니다', '간밤의 결과를 확인합니다.'],
  discussion: ['토론 시간입니다', '대화를 통해 숨어 있는 마피아를 찾아내세요.'],
  vote: ['투표가 시작되었습니다', '마피아로 의심되는 플레이어 한 명을 선택하세요.'],
  result: ['투표 결과', '잠시 후 다음 밤이 시작됩니다.'],
  ended: ['게임 종료', '전체 역할과 승리 진영을 확인하세요.']
};

function toast(message, type = 'info') {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function enterGame(code, playerId) {
  myPlayerId = playerId;
  sessionStorage.setItem('mafiaPlayerId', playerId);
  sessionStorage.setItem('mafiaRoomCode', code);
  landing.classList.add('hidden');
  game.classList.remove('hidden');
  copyCodeButton.textContent = code;
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.original ??= button.textContent;
  button.textContent = busy ? '처리 중…' : button.dataset.original;
}

function nickname() {
  return nicknameInput.value.trim();
}

createRoomButton.addEventListener('click', () => {
  setBusy(createRoomButton, true);
  socket.emit('room:create', { nickname: nickname() }, (result) => {
    setBusy(createRoomButton, false);
    if (!result?.ok) return toast(result?.error ?? '방을 만들지 못했습니다.', 'error');
    enterGame(result.code, result.playerId);
  });
});

joinRoomButton.addEventListener('click', () => {
  setBusy(joinRoomButton, true);
  socket.emit('room:join', { nickname: nickname(), code: roomCodeInput.value }, (result) => {
    setBusy(joinRoomButton, false);
    if (!result?.ok) return toast(result?.error ?? '방에 입장하지 못했습니다.', 'error');
    enterGame(result.code, result.playerId);
  });
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
});

copyCodeButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomState?.code ?? copyCodeButton.textContent);
  toast('방 코드를 복사했습니다.', 'success');
});

leaveRoomButton.addEventListener('click', () => {
  socket.emit('room:leave');
  sessionStorage.removeItem('mafiaPlayerId');
  sessionStorage.removeItem('mafiaRoomCode');
  location.reload();
});

startGameButton.addEventListener('click', () => {
  setBusy(startGameButton, true);
  socket.emit('game:start', {}, (result) => {
    setBusy(startGameButton, false);
    if (!result?.ok) toast(result?.error ?? '게임을 시작하지 못했습니다.', 'error');
  });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text }, (result) => {
    if (result?.ok) chatInput.value = '';
    else toast(result?.error ?? '메시지를 보내지 못했습니다.', 'error');
  });
});

socket.on('toast', ({ message, type }) => toast(message, type));
socket.on('room:state', (state) => {
  roomState = state;
  if (game.classList.contains('hidden')) enterGame(state.code, myPlayerId);
  render();
});
socket.on('player:state', (state) => {
  playerState = state;
  myPlayerId = state.id;
  render();
});
socket.on('chat:message', renderMessage);
socket.on('game:roles', (roles) => {
  roleReveal.innerHTML = `
    <h3>전체 역할 공개</h3>
    <div class="reveal-list">${roles.map((item) => `
      <div class="reveal-item"><strong>${escapeHtml(item.nickname)}</strong><span>${escapeHtml(item.roleName)}</span></div>
    `).join('')}</div>`;
  roleReveal.classList.remove('hidden');
});

function render() {
  if (!roomState) return;
  copyCodeButton.textContent = roomState.code;
  renderPlayers();
  renderStatus();
  renderRole();
  renderActions();
  renderChatAvailability();
}

function renderPlayers() {
  playerCountEl.textContent = `${roomState.players.length} / 12`;
  playersEl.innerHTML = roomState.players.map((player) => `
    <div class="player ${player.alive ? '' : 'dead'} ${player.connected ? '' : 'disconnected'}">
      <div class="avatar">${escapeHtml(player.nickname.slice(0, 1))}</div>
      <div class="player-name">${escapeHtml(player.nickname)}${player.id === myPlayerId ? ' (나)' : ''}</div>
      ${player.isHost ? '<span class="player-badge">방장</span>' : ''}
      ${!player.alive && roomState.phase !== 'lobby' ? '<span class="player-badge">사망</span>' : ''}
    </div>
  `).join('');

  const me = roomState.players.find((player) => player.id === myPlayerId);
  const canStart = me?.isHost && ['lobby', 'ended'].includes(roomState.phase);
  startGameButton.classList.toggle('hidden', !canStart);
  startGameButton.disabled = roomState.players.length < 5;
  startGameButton.textContent = roomState.phase === 'ended' ? '다시 시작' : `게임 시작 (${roomState.players.length}/5)`;
}

function renderStatus() {
  const [title, description] = phaseContent[roomState.phase] ?? ['', ''];
  roundLabel.textContent = roomState.phase === 'lobby' ? '대기실' : `${roomState.round} 라운드`;
  phaseTitle.textContent = title;
  phaseDescription.textContent = description;

  clearInterval(countdownInterval);
  if (!roomState.phaseEndsAt) {
    timerEl.classList.add('hidden');
    return;
  }
  timerEl.classList.remove('hidden');
  const update = () => {
    const seconds = Math.max(0, Math.ceil((roomState.phaseEndsAt - Date.now()) / 1000));
    timerEl.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  update();
  countdownInterval = setInterval(update, 250);
}

function renderRole() {
  if (!playerState?.role || roomState.phase === 'lobby') {
    roleCard.classList.add('hidden');
    return;
  }
  roleCard.classList.remove('hidden');
  roleName.textContent = playerState.roleMeta.name;
  roleDescription.textContent = playerState.roleMeta.description;
  if (playerState.teammates?.length) {
    teammatesEl.textContent = `동료 마피아: ${playerState.teammates.map((player) => player.nickname).join(', ')}`;
    teammatesEl.classList.remove('hidden');
  } else {
    teammatesEl.classList.add('hidden');
  }
}

function renderActions() {
  roleReveal.classList.toggle('hidden', roomState.phase !== 'ended');
  if (!playerState || roomState.phase === 'lobby') return renderEmpty();
  if (roomState.phase === 'reveal') {
    actionArea.innerHTML = resultCard('◈', '역할을 확인하세요', '잠시 후 첫 번째 밤이 시작됩니다.');
    return;
  }
  if (!playerState.alive && roomState.phase !== 'ended') {
    actionArea.innerHTML = resultCard('☁', '사망했습니다', '남은 플레이어의 경기를 관전하세요.');
    return;
  }

  if (roomState.phase === 'night') {
    if (!['mafia', 'doctor', 'police'].includes(playerState.role)) {
      actionArea.innerHTML = resultCard('◐', '조용한 밤입니다', '시민은 밤이 끝날 때까지 기다려야 합니다.');
      return;
    }
    const verbs = { mafia: ['공격할 대상', '마피아가 제거할 플레이어를 선택하세요.'], doctor: ['보호할 대상', '이번 밤에 보호할 플레이어를 선택하세요.'], police: ['조사할 대상', '마피아인지 조사할 플레이어를 선택하세요.'] };
    renderTargets(verbs[playerState.role][0], verbs[playerState.role][1], 'night');
    return;
  }

  if (roomState.phase === 'dawn' && playerState.investigation) {
    const target = roomState.players.find((player) => player.id === playerState.investigation.targetId);
    actionArea.innerHTML = resultCard(
      playerState.investigation.isMafia ? '!' : '✓',
      `${target?.nickname ?? '대상'}님은 ${playerState.investigation.isMafia ? '마피아입니다' : '마피아가 아닙니다'}`,
      '이 정보는 경찰인 본인에게만 표시됩니다.'
    );
    return;
  }

  if (roomState.phase === 'vote') {
    renderTargets('처형할 대상', '가장 의심되는 플레이어에게 투표하세요.', 'vote');
    return;
  }

  if (roomState.phase === 'discussion') {
    actionArea.innerHTML = resultCard('⌁', '토론 중', '채팅을 통해 알리바이와 의심되는 정황을 공유하세요.');
    return;
  }

  if (roomState.phase === 'ended') {
    actionArea.innerHTML = resultCard(roomState.winner === 'mafia' ? '♠' : '◇', roomState.winner === 'mafia' ? '마피아 승리' : '시민 승리', '오른쪽 역할 공개 화면에서 모든 역할을 확인할 수 있습니다.');
    return;
  }

  renderEmpty();
}

function renderTargets(title, description, mode) {
  const mafiaTeammateIds = new Set([myPlayerId, ...(playerState.teammates ?? []).map((player) => player.id)]);
  const targets = roomState.players.filter((player) => {
    if (!player.alive) return false;
    if (mode === 'night' && playerState.role === 'mafia' && mafiaTeammateIds.has(player.id)) return false;
    return true;
  });
  actionArea.innerHTML = `
    <div class="action-title"><h3>${title}</h3><p>${description}</p></div>
    <div class="target-grid">${targets.map((player) => `
      <button class="target-button" data-target="${player.id}">
        <strong>${escapeHtml(player.nickname)}</strong>
        <small>${player.id === myPlayerId ? '나 자신' : '선택하기'}</small>
      </button>
    `).join('')}</div>`;

  actionArea.querySelectorAll('.target-button').forEach((button) => {
    button.addEventListener('click', () => {
      const eventName = mode === 'night' ? 'night:action' : 'vote:cast';
      socket.emit(eventName, { targetId: button.dataset.target }, (result) => {
        if (!result?.ok) return toast(result?.error ?? '선택하지 못했습니다.', 'error');
        actionArea.querySelectorAll('.target-button').forEach((item) => item.classList.remove('selected'));
        button.classList.add('selected');
        toast(mode === 'night' ? '밤 행동을 선택했습니다.' : '투표를 완료했습니다.', 'success');
      });
    });
  });
}

function renderEmpty() {
  actionArea.innerHTML = `
    <div class="empty-state"><div class="moon">◐</div><h3>게임이 시작되면 이곳에서 행동합니다.</h3><p>밤에는 능력 대상을, 낮에는 처형할 플레이어를 선택하세요.</p></div>`;
}

function resultCard(icon, title, description) {
  return `<div class="result-card"><div class="result-icon">${icon}</div><h3>${title}</h3><p>${description}</p></div>`;
}

function renderChatAvailability() {
  const allowed = ['lobby', 'discussion', 'vote', 'ended'].includes(roomState.phase) && (playerState?.alive !== false || roomState.phase === 'ended');
  chatInput.disabled = !allowed;
  chatInput.placeholder = allowed ? '메시지 입력' : '지금은 채팅할 수 없습니다';
  chatStatus.textContent = allowed ? '대화 가능' : '대화 제한';
}

function renderMessage(message) {
  const element = document.createElement('div');
  if (message.type === 'system') {
    element.className = 'message system';
    element.textContent = message.text;
  } else {
    element.className = 'message';
    element.innerHTML = `<span class="author">${escapeHtml(message.nickname)}</span>${escapeHtml(message.text)}`;
  }
  messagesEl.appendChild(element);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
