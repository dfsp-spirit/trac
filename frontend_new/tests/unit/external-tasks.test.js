/**
 * `domain/externalTasks.js`: the two URL-contract jobs the client owns.
 *
 * Which task may be opened is *not* decided here - the server sends
 * `locked_reason`. These tests pin that `taskState` renders that answer and
 * never invents a link the server withheld.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_DONE,
  TASK_LOCKED,
  TASK_OPEN,
  parseCallbackParams,
  taskState,
  withoutCallbackParams,
} from '../../src/js/domain/externalTasks.js';

test('a callback URL is the task key plus the assigned token', () => {
  assert.deepEqual(
    parseCallbackParams('?study=adult&pid=bernd&callback_task_key=payment&callback_token=abc'),
    { taskKey: 'payment', assignedToken: 'abc', hmac: null }
  );
});

test('the documented short names work and the prefixed names win', () => {
  assert.deepEqual(parseCallbackParams('?task_key=payment&token=abc'), {
    taskKey: 'payment',
    assignedToken: 'abc',
    hmac: null,
  });
  assert.deepEqual(
    parseCallbackParams('?task_key=wrong&token=wrong&callback_task_key=payment&callback_token=abc'),
    { taskKey: 'payment', assignedToken: 'abc', hmac: null }
  );
});

test('half a callback is not a callback', () => {
  assert.equal(parseCallbackParams('?callback_task_key=payment'), null);
  assert.equal(parseCallbackParams('?callback_token=abc'), null);
  assert.equal(parseCallbackParams('?callback_token=%20'), null, 'whitespace is not a token');
  assert.equal(parseCallbackParams(''), null);
});

test('the HMAC is forwarded when the provider signed the return', () => {
  assert.deepEqual(
    parseCallbackParams('?callback_task_key=payment&callback_token=abc&hmac=deadbeef'),
    { taskKey: 'payment', assignedToken: 'abc', hmac: 'deadbeef' }
  );
});

test('redeeming a callback leaves the rest of the query string alone', () => {
  assert.equal(
    withoutCallbackParams(
      '?study=adult&pid=bernd&callback_task_key=payment&callback_token=abc&hmac=dead'
    ),
    '?study=adult&pid=bernd'
  );
  assert.equal(
    withoutCallbackParams('?study=adult&pid=bernd&task_key=payment&token=abc'),
    '?study=adult&pid=bernd',
    'the short names go too, or a reload would re-post'
  );
  assert.equal(withoutCallbackParams('?callback_task_key=payment&callback_token=abc'), '');
});

test('a confirmed task is done, whatever the lock fields say', () => {
  assert.deepEqual(taskState({ is_confirmed: true, continuation_url: '' }), {
    state: TASK_DONE,
    reason: null,
  });
});

test('a task the server locked carries the reason it gave', () => {
  assert.deepEqual(
    taskState({ locked_reason: 'task_level', continuation_url: '' }),
    { state: TASK_LOCKED, reason: 'task_level' }
  );
  assert.deepEqual(
    taskState({ locked_reason: 'diary', continuation_url: '' }),
    { state: TASK_LOCKED, reason: 'diary' }
  );
});

test('an unlocked task with a link is open', () => {
  assert.deepEqual(
    taskState({ locked_reason: null, continuation_url: '/api/launch?assigned_token=t' }),
    { state: TASK_OPEN, reason: null }
  );
});

test('a task without a link is never rendered as a link', () => {
  assert.deepEqual(taskState({ continuation_url: '' }), {
    state: TASK_LOCKED,
    reason: 'task_level',
  });
  assert.deepEqual(taskState({}), { state: TASK_LOCKED, reason: 'task_level' });
});
