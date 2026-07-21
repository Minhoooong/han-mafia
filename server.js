import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import {
  DEFAULT_TIMERS,
  PHASES,
  ROLE_META,
  alivePlayers,
  checkWinner,
  createPlayer,
  createRoom,
  createRoomCode,
  getPlayer,
  privatePlayerState,
  publicRoomState,
  resolveNight,
  resolveVote,
  sanitizeNickname,
  startGame
} from './src/game.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  transports: ['websocket', 'polling']
});

const PORT = Number(process.env.PORT || 7860);
const rooms = new Map();
const socketRoom = new Map();
const socketPlayer = new Map();

app.disable('x-powered-by');
app.use(express.static('public', { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function emitError(socket, message) {
  socket.emit('toast', { type: 'error', message });
}

function emitRoom(room) {
  io.to(room.code).emit('room:state', publicRoomState(room));
  for (const player of room.players) {
    io.to(player.id).emit('player:state', privatePlayerState(room, player.id));
  }
}

function addSystemMessage(room, text) {
  const message = { id: crypto.randomUUID(), type: 'system', text, at: Date.now() };
  room.messages.push(message);
  if (room.messages.length > 100) room.messages.shift();
  io.to(room.code).emit('chat:message', message);
}

function clearPhaseTimer(room) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  room.phaseEndsAt = null;
}

function setPhase(room, phase, seconds, onEnd) {
  clearPhaseTimer(room);
  room.phase = phase;
  room.phaseEndsAt = Date.now() + seconds * 1000;
  emitRoom(room);
  room.phaseTimer = setTimeout(onEnd, seconds * 1000);
}

function phaseLabel(phase) {
  return {
    [PHASES.NIGHT]: '밤',
    [PHASES.DAWN]: '새벽 결과',
    [PHASES.DISCUSSION]: '낮 토론',
    [PHASES.VOTE]: '투표',
    [PHASES.RESULT]: '투표 결과'
  }[phase] ?? phase;
}

function beginNight(room) {
  room.nightActions.clear();
  addSystemMessage(room, `${room.round}번째 밤입니다. 능력이 있는 플레이어는 대상을 선택하세요.`);
  setPhase(room, PHASES.NIGHT, DEFAULT_TIMERS.night, () => finishNight(room));
}

function finishNight(room) {
  if (!rooms.has(room.code) || room.phase !== PHASES.NIGHT) return;
  const result = resolveNight(room);
  const victim = result.killedId ? getPlayer(room, result.killedId) : null;
  addSystemMessage(room, victim ? `${victim.nickname}님이 밤에 사망했습니다.` : '간밤에 아무도 사망하지 않았습니다.');

  const winner = checkWinner(room);
  if (winner) return endGame(room, winner);

  setPhase(room, PHASES.DAWN, DEFAULT_TIMERS.dawn, () => beginDiscussion(room));
}

function beginDiscussion(room) {
  addSystemMessage(room, `토론을 시작합니다. ${DEFAULT_TIMERS.discussion}초 뒤 투표가 시작됩니다.`);
  setPhase(room, PHASES.DISCUSSION, DEFAULT_TIMERS.discussion, () => beginVote(room));
}

function beginVote(room) {
  room.votes.clear();
  addSystemMessage(room, '마피아로 의심되는 플레이어에게 투표하세요.');
  setPhase(room, PHASES.VOTE, DEFAULT_TIMERS.vote, () => finishVote(room));
}

function finishVote(room) {
  if (!rooms.has(room.code) || room.phase !== PHASES.VOTE) return;
  const result = resolveVote(room);
  const executed = result.executedId ? getPlayer(room, result.executedId) : null;
  addSystemMessage(room, executed ? `${executed.nickname}님이 투표로 처형되었습니다.` : '표가 갈려 아무도 처형되지 않았습니다.');

  const winner = checkWinner(room);
  if (winner) return endGame(room, winner);

  setPhase(room, PHASES.RESULT, DEFAULT_TIMERS.result, () => {
    room.round += 1;
    beginNight(room);
  });
}

function endGame(room, winner) {
  clearPhaseTimer(room);
  room.phase = PHASES.ENDED;
  room.winner = winner;
  room.phaseEndsAt = null;
  addSystemMessage(room, winner === 'mafia' ? '마피아 팀이 승리했습니다.' : '시민 팀이 승리했습니다.');
  emitRoom(room);
  io.to(room.code).emit('game:roles', room.players.map((player) => ({
    id: player.id,
    nickname: player.nickname,
    role: player.role,
    roleName: ROLE_META[player.role]?.name ?? player.role
  })));
}

function allRequiredNightActionsDone(room) {
  const required = alivePlayers(room).filter((player) => ['mafia', 'doctor', 'police'].includes(player.role));
  return required.length > 0 && required.every((player) => room.nightActions.has(player.id));
}

function allVotesDone(room) {
  const living = alivePlayers(room);
  return living.length > 0 && living.every((player) => room.votes.has(player.id));
}

function attachPlayerSocket(socket, room, player) {
  socket.join(room.code);
  socket.join(player.id);
  socketRoom.set(socket.id, room.code);
  socketPlayer.set(socket.id, player.id);
  player.connected = true;
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ nickname }, ack = () => {}) => {
    const safeName = sanitizeNickname(nickname);
    if (safeName.length < 2) return ack({ ok: false, error: '닉네임은 2자 이상 입력하세요.' });

    if (rooms.size >= 500) return ack({ ok: false, error: '현재 생성 가능한 방 수를 초과했습니다. 잠시 후 다시 시도하세요.' });

    const code = createRoomCode(new Set(rooms.keys()));
    const playerId = crypto.randomUUID();
    const room = createRoom({ code, hostId: playerId, hostNickname: safeName });
    rooms.set(code, room);
    attachPlayerSocket(socket, room, room.players[0]);
    addSystemMessage(room, `${safeName}님이 방을 만들었습니다.`);
    emitRoom(room);
    ack({ ok: true, code, playerId });
  });

  socket.on('room:join', ({ code, nickname }, ack = () => {}) => {
    const roomCode = String(code ?? '').toUpperCase().trim();
    const safeName = sanitizeNickname(nickname);
    const room = rooms.get(roomCode);

    if (!room) return ack({ ok: false, error: '존재하지 않는 방입니다.' });
    if (room.phase !== PHASES.LOBBY) return ack({ ok: false, error: '이미 게임이 시작된 방입니다.' });
    if (room.players.length >= 12) return ack({ ok: false, error: '방이 가득 찼습니다.' });
    if (safeName.length < 2) return ack({ ok: false, error: '닉네임은 2자 이상 입력하세요.' });
    if (room.players.some((player) => player.nickname.toLowerCase() === safeName.toLowerCase())) {
      return ack({ ok: false, error: '이미 사용 중인 닉네임입니다.' });
    }

    const player = createPlayer({ id: crypto.randomUUID(), nickname: safeName });
    room.players.push(player);
    attachPlayerSocket(socket, room, player);
    addSystemMessage(room, `${safeName}님이 입장했습니다.`);
    emitRoom(room);
    ack({ ok: true, code: roomCode, playerId: player.id });
  });

  socket.on('game:start', (_payload, ack = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const playerId = socketPlayer.get(socket.id);
    if (!room || room.hostId !== playerId) return ack({ ok: false, error: '방장만 시작할 수 있습니다.' });
    if (room.players.length < 5) return ack({ ok: false, error: '최소 5명이 필요합니다.' });
    if (room.phase !== PHASES.LOBBY && room.phase !== PHASES.ENDED) {
      return ack({ ok: false, error: '이미 게임이 진행 중입니다.' });
    }

    startGame(room);
    addSystemMessage(room, '게임이 시작되었습니다. 역할 카드를 확인하세요.');
    emitRoom(room);
    setTimeout(() => beginNight(room), 5000);
    ack({ ok: true });
  });

  socket.on('night:action', ({ targetId }, ack = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const playerId = socketPlayer.get(socket.id);
    const player = room && getPlayer(room, playerId);
    const target = room && getPlayer(room, targetId);

    if (!room || room.phase !== PHASES.NIGHT) return ack({ ok: false, error: '지금은 밤 행동 시간이 아닙니다.' });
    if (!player?.alive || !target?.alive) return ack({ ok: false, error: '유효하지 않은 대상입니다.' });
    if (!['mafia', 'doctor', 'police'].includes(player.role)) return ack({ ok: false, error: '사용할 수 있는 능력이 없습니다.' });
    if (player.role === 'mafia' && target.role === 'mafia') return ack({ ok: false, error: '같은 마피아는 공격할 수 없습니다.' });

    room.nightActions.set(playerId, { targetId, at: Date.now() });
    emitRoom(room);
    ack({ ok: true });
    if (allRequiredNightActionsDone(room)) setTimeout(() => finishNight(room), 800);
  });

  socket.on('vote:cast', ({ targetId }, ack = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const playerId = socketPlayer.get(socket.id);
    const player = room && getPlayer(room, playerId);
    const target = room && getPlayer(room, targetId);

    if (!room || room.phase !== PHASES.VOTE) return ack({ ok: false, error: '지금은 투표 시간이 아닙니다.' });
    if (!player?.alive || !target?.alive) return ack({ ok: false, error: '유효하지 않은 투표입니다.' });

    room.votes.set(playerId, targetId);
    emitRoom(room);
    ack({ ok: true });
    if (allVotesDone(room)) setTimeout(() => finishVote(room), 800);
  });

  socket.on('chat:send', ({ text }, ack = () => {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const playerId = socketPlayer.get(socket.id);
    const player = room && getPlayer(room, playerId);
    const safeText = String(text ?? '').replace(/[<>]/g, '').trim().slice(0, 240);

    if (!room || !player || !safeText) return ack({ ok: false });
    const canTalk = room.phase === PHASES.LOBBY || room.phase === PHASES.DISCUSSION || room.phase === PHASES.VOTE || room.phase === PHASES.ENDED;
    if (!canTalk || (!player.alive && room.phase !== PHASES.ENDED)) {
      return ack({ ok: false, error: '지금은 채팅할 수 없습니다.' });
    }

    const message = {
      id: crypto.randomUUID(),
      type: 'player',
      playerId,
      nickname: player.nickname,
      text: safeText,
      at: Date.now()
    };
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();
    io.to(room.code).emit('chat:message', message);
    ack({ ok: true });
  });

  socket.on('room:leave', () => socket.disconnect(true));

  socket.on('disconnect', () => {
    const roomCode = socketRoom.get(socket.id);
    const playerId = socketPlayer.get(socket.id);
    const room = rooms.get(roomCode);
    socketRoom.delete(socket.id);
    socketPlayer.delete(socket.id);
    if (!room || !playerId) return;

    const player = getPlayer(room, playerId);
    if (!player) return;
    player.connected = false;

    if (room.phase === PHASES.LOBBY) {
      room.players = room.players.filter((candidate) => candidate.id !== playerId);
      addSystemMessage(room, `${player.nickname}님이 퇴장했습니다.`);
      if (room.players.length === 0) {
        clearPhaseTimer(room);
        rooms.delete(room.code);
        return;
      }
      if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
        room.players.forEach((candidate) => { candidate.isHost = candidate.id === room.hostId; });
        addSystemMessage(room, `${room.players[0].nickname}님이 새 방장이 되었습니다.`);
      }
    }

    emitRoom(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const nobodyConnected = room.players.every((player) => !player.connected);
    const expired = now - room.createdAt > 6 * 60 * 60 * 1000;
    if (nobodyConnected || expired) {
      clearPhaseTimer(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Han Mafia listening on http://0.0.0.0:${PORT}`);
});
