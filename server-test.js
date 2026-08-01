import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { PHASES, ROLE_META, alivePlayers, checkWinner, createPlayer, createRoom, getPlayer, resolveNight, resolveVote, startGame } from './src/game.js';

const app=express();const server=http.createServer(app);const io=new Server(server);const PORT=Number(process.env.ADMIN_TEST_PORT||7861);const rooms=new Map();
app.use(express.static('public'));app.get('/health',(_q,r)=>r.json({ok:true,mode:'admin-test',rooms:rooms.size}));
const emit=(room)=>io.to(room.code).emit('test:state',state(room));
const msg=(room,text)=>{room.log.push({at:Date.now(),text});if(room.log.length>80)room.log.shift();emit(room)};
function makeRoom(){const id=crypto.randomUUID(),room=createRoom({code:'TEST1',hostId:id,hostNickname:'관리자'});room.log=[];room.testMode=true;room.players[0].role=null;rooms.set(room.code,room);return room}
function bots(room,count=5){while(room.players.length<count){const n=room.players.filter(p=>p.isBot).length+1;{const b=createPlayer({id:`bot-${crypto.randomUUID()}`,nickname:`테스트봇 ${n}`});b.isBot=true;room.players.push(b)}}}
function roleList(room){return room.players.map(p=>({id:p.id,nickname:p.nickname,role:p.role,roleName:p.role?ROLE_META[p.role]?.name:'미배정',alive:p.alive,isBot:!!p.isBot}))}
function state(room){return{code:room.code,phase:room.phase,round:room.round,winner:room.winner,players:roleList(room),log:room.log,lastNightResult:room.lastNightResult,lastVoteResult:room.lastVoteResult}}
function botNight(room){for(const p of alivePlayers(room).filter(x=>x.isBot)){let c=[];if(p.role==='mafia')c=alivePlayers(room).filter(x=>x.role!=='mafia');if(p.role==='doctor')c=alivePlayers(room);if(p.role==='police')c=alivePlayers(room).filter(x=>x.id!==p.id);if(c.length)room.nightActions.set(p.id,{targetId:c[crypto.randomInt(c.length)].id,at:Date.now()})}}
function botVote(room){const living=alivePlayers(room);for(const p of living.filter(x=>x.isBot)){const c=living.filter(x=>x.id!==p.id);if(c.length)room.votes.set(p.id,c[crypto.randomInt(c.length)].id)}}
function start(room){if(room.players.length<5)bots(room,5);startGame(room);room.phase=PHASES.REVEAL;msg(room,'역할을 배정했습니다.')}
function next(room){switch(room.phase){case PHASES.LOBBY:start(room);break;case PHASES.REVEAL:room.phase=PHASES.NIGHT;room.nightActions.clear();botNight(room);msg(room,`${room.round}번째 밤: 봇 행동을 자동 입력했습니다.`);break;case PHASES.NIGHT:{const r=resolveNight(room),v=r.killedId&&getPlayer(room,r.killedId);room.phase=PHASES.DAWN;msg(room,v?`${v.nickname} 사망`:'사망자 없음');endIf(room);break}case PHASES.DAWN:room.phase=PHASES.DISCUSSION;msg(room,'토론 단계로 이동했습니다.');break;case PHASES.DISCUSSION:room.phase=PHASES.VOTE;room.votes.clear();botVote(room);msg(room,'투표 단계: 봇 투표를 자동 입력했습니다.');break;case PHASES.VOTE:{const r=resolveVote(room),v=r.executedId&&getPlayer(room,r.executedId);room.phase=PHASES.RESULT;msg(room,v?`${v.nickname} 처형`:'동률: 처형 없음');endIf(room);break}case PHASES.RESULT:room.round++;room.phase=PHASES.NIGHT;room.nightActions.clear();botNight(room);msg(room,`${room.round}번째 밤으로 이동했습니다.`);break;case PHASES.ENDED:reset(room);break}}
function endIf(room){const w=checkWinner(room);if(w){room.phase=PHASES.ENDED;room.winner=w;msg(room,w==='mafia'?'마피아 승리':'시민 승리')}}
function reset(room){room.phase=PHASES.LOBBY;room.round=0;room.winner=null;room.nightActions.clear();room.votes.clear();room.lastNightResult=null;room.lastVoteResult=null;for(const p of room.players){p.role=null;p.alive=true}msg(room,'테스트 상태를 초기화했습니다.')}
function kill(room,id){const p=getPlayer(room,id);if(p){p.alive=false;msg(room,`${p.nickname}을(를) 강제 사망 처리했습니다.`);endIf(room)}}
function revive(room,id){const p=getPlayer(room,id);if(p){p.alive=true;room.winner=null;if(room.phase===PHASES.ENDED)room.phase=PHASES.DISCUSSION;msg(room,`${p.nickname}을(를) 부활시켰습니다.`)}}
io.on('connection',socket=>{let room=rooms.get('TEST1')||makeRoom();socket.join(room.code);emit(room);socket.on('test:command',({cmd,id,count}={},ack=()=>{})=>{try{if(cmd==='bots'){bots(room,Math.min(12,Math.max(5,Number(count)||5)));msg(room,'테스트봇을 충원했습니다.')}else if(cmd==='removeBots'){room.players=room.players.filter(p=>!p.isBot);reset(room)}else if(cmd==='start')start(room);else if(cmd==='next')next(room);else if(cmd==='reset')reset(room);else if(cmd==='kill')kill(room,id);else if(cmd==='revive')revive(room,id);else if(cmd==='new'){rooms.delete(room.code);room=makeRoom();socket.join(room.code);emit(room)}else throw new Error('알 수 없는 명령');ack({ok:true})}catch(e){ack({ok:false,error:e.message})}})});
server.listen(PORT,'0.0.0.0',()=>console.log(`Admin test server: http://localhost:${PORT}/admin-test.html`));
