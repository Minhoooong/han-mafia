import test from 'node:test';
import assert from 'node:assert/strict';
import { FAST_TIMERS, isLoopbackAddress, randomItem, safeTokenEquals } from '../src/admin.js';

test('로컬 루프백 주소를 식별한다', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.0.10'), false);
});

test('관리자 토큰을 일정 시간 비교한다', () => {
  assert.equal(safeTokenEquals('secret-token', 'secret-token'), true);
  assert.equal(safeTokenEquals('secret-token', 'wrong-token'), false);
  assert.equal(safeTokenEquals('', ''), false);
});

test('빠른 진행 타이머가 일반 플레이보다 짧다', () => {
  assert.equal(FAST_TIMERS.reveal, 2);
  assert.ok(FAST_TIMERS.discussion < 120);
  assert.ok(FAST_TIMERS.night < 45);
});

test('빈 배열에서는 무작위 대상을 반환하지 않는다', () => {
  assert.equal(randomItem([]), null);
  assert.equal(randomItem(['only']), 'only');
});
