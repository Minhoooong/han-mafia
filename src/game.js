import crypto from 'node:crypto';

export const PHASES = Object.freeze({
  LOBBY: 'lobby',
  REVEAL: 'reveal',
  NIGHT: 'night',
  DAWN: 'dawn',
  DISCUSSION: 'discussion',
  VOTE: 'vote',
  RESULT: 'result',
  ENDED: 'ended'
});

export const ROLE_META = Object.freeze({
  mafia: {
    name: '마피아',
    team: 'mafia',
    description: '밤마다 시민 한 명을 제거합니다. 마피아끼리는 서로를 알아볼 수 있습니다.'
  },
  police: {
    name: '경찰',
    team: 'citizen',
    description: '밤마다 한 명을 조사해 마피아 여부를 확인합니다.'
  },
  doctor: {
    name: '의사',
    team: 'citizen',
    description: '밤마다 한 명을 선택해 마피아의 공격으로부터 보호합니다.'
  },
  citizen: {
    name: '시민',
    team: 'citizen',
    description: '토론과 투표로 마피아를 모두 찾아내세요.'
  }
});

export const DEFAULT_TIMERS = Object.freeze({
  night: 45,
  dawn: 7,
  discussion: 120,
  vote: 45,
  result: 8
});

export function createRoomCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  throw new Error('방 코드를 생성하지 못했습니다.');
}

export function sanitizeNickname(value) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

export function buildRoleDeck(playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 12) {
    throw new Error('게임은 5명부터 12명까지 시작할 수 있습니다.');
  }

  const mafiaCount = playerCount >= 9 ? 3 : playerCount >= 7 ? 2 : 1;
  const roles = Array(mafiaCount).fill('mafia');
  roles.push('doctor');
  if (playerCount >= 6) roles.push('police');
  while (roles.length < playerCount) roles.push('citizen');
  return shuffle(roles);
}

export function shuffle(items) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function createPlayer({ id, nickname, isHost = false }) {
  return {
    id,
    nickname,
    isHost,
    alive: true,
    role: null,
    connected: true,
    joinedAt: Date.now()
  };
}

export function createRoom({ code, hostId, hostNickname }) {
  return {
    code,
    hostId,
    phase: PHASES.LOBBY,
    round: 0,
    players: [createPlayer({ id: hostId, nickname: hostNickname, isHost: true })],
    messages: [],
    nightActions: new Map(),
    votes: new Map(),
    phaseEndsAt: null,
    phaseTimer: null,
    lastNightResult: null,
    lastVoteResult: null,
    winner: null,
    createdAt: Date.now()
  };
}

export function alivePlayers(room) {
  return room.players.filter((player) => player.alive);
}

export function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

export function startGame(room) {
  const deck = buildRoleDeck(room.players.length);
  room.players.forEach((player, index) => {
    player.role = deck[index];
    player.alive = true;
  });
  room.round = 1;
  room.winner = null;
  room.lastNightResult = null;
  room.lastVoteResult = null;
  room.nightActions.clear();
  room.votes.clear();
  room.phase = PHASES.REVEAL;
}

export function resolveNight(room) {
  const living = alivePlayers(room);
  const livingById = new Map(living.map((player) => [player.id, player]));

  const mafiaTargets = [];
  let protectedId = null;
  const investigations = [];

  for (const [actorId, action] of room.nightActions.entries()) {
    const actor = livingById.get(actorId);
    const target = livingById.get(action.targetId);
    if (!actor || !target) continue;

    if (actor.role === 'mafia' && target.role !== 'mafia') {
      mafiaTargets.push(target.id);
    } else if (actor.role === 'doctor') {
      protectedId = target.id;
    } else if (actor.role === 'police') {
      investigations.push({
        policeId: actor.id,
        targetId: target.id,
        isMafia: target.role === 'mafia'
      });
    }
  }

  const attackedId = pluralityWinner(mafiaTargets);
  let killedId = null;
  if (attackedId && attackedId !== protectedId) {
    const victim = livingById.get(attackedId);
    if (victim) {
      victim.alive = false;
      killedId = victim.id;
    }
  }

  const result = {
    attackedId,
    protectedId,
    killedId,
    investigations
  };
  room.lastNightResult = result;
  room.nightActions.clear();
  return result;
}

export function resolveVote(room) {
  const living = alivePlayers(room);
  const livingIds = new Set(living.map((player) => player.id));
  const targets = [];

  for (const [voterId, targetId] of room.votes.entries()) {
    if (livingIds.has(voterId) && livingIds.has(targetId)) targets.push(targetId);
  }

  const counts = countValues(targets);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  let executedId = null;
  let tie = true;

  if (sorted.length > 0) {
    const top = sorted[0][1];
    const topTargets = sorted.filter(([, count]) => count === top);
    if (topTargets.length === 1) {
      executedId = topTargets[0][0];
      const executed = getPlayer(room, executedId);
      if (executed) executed.alive = false;
      tie = false;
    }
  }

  const result = { executedId, tie, counts: Object.fromEntries(counts) };
  room.lastVoteResult = result;
  room.votes.clear();
  return result;
}

export function checkWinner(room) {
  const living = alivePlayers(room);
  const mafia = living.filter((player) => player.role === 'mafia').length;
  const citizens = living.length - mafia;

  if (mafia === 0) return 'citizen';
  if (mafia >= citizens) return 'mafia';
  return null;
}

export function pluralityWinner(values) {
  const counts = countValues(values);
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

export function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.isHost,
      alive: player.alive,
      connected: player.connected
    })),
    lastNightResult: room.lastNightResult
      ? { killedId: room.lastNightResult.killedId }
      : null,
    lastVoteResult: room.lastVoteResult
      ? { executedId: room.lastVoteResult.executedId, tie: room.lastVoteResult.tie }
      : null,
    winner: room.winner
  };
}

export function privatePlayerState(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) return null;
  const teammates = player.role === 'mafia'
    ? room.players
        .filter((candidate) => candidate.role === 'mafia' && candidate.id !== player.id)
        .map(({ id, nickname, alive }) => ({ id, nickname, alive }))
    : [];

  const investigation = room.lastNightResult?.investigations
    ?.find((item) => item.policeId === player.id) ?? null;

  return {
    id: player.id,
    role: player.role,
    roleMeta: player.role ? ROLE_META[player.role] : null,
    alive: player.alive,
    teammates,
    investigation,
    hasActed: room.nightActions.has(player.id),
    hasVoted: room.votes.has(player.id)
  };
}
