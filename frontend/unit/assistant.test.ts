// Run with `npm run test:unit` (Node's own test runner; no browser, no server, nothing to install).
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_QUESTION_CHARS, askBody, canSend, canUseAssistant, limitHint, messages, noticeFor, replyFor, replyForFailure, sourcesOf, statusNotice } from '../src/ai/assistant.ts'

const answer = {
  available: true, answer: '  Students must maintain at least 75% attendance.  ', model: 'some-model-name', finish: 'completed',
  sources: [{ number: 1, documentId: '7c1d0000-0000-4000-8000-0000000000d1', title: 'Attendance Policy', source: 'attendance-policy.md', section: 'Attendance', page: null }],
  usage: { inputTokens: 239, outputTokens: 23, estimated: false },
}

test('only school users holding the permission see the assistant', () => {
  assert.equal(canUseAssistant({ dataScope: 'teacher', permissions: ['ai.assistant.use'] }), true)
  assert.equal(canUseAssistant({ dataScope: 'school', permissions: ['students.view', 'ai.assistant.use'] }), true)
  assert.equal(canUseAssistant({ dataScope: 'teacher', permissions: ['ai.knowledge.manage', 'ai.usage.view'] }), false)
  assert.equal(canUseAssistant({ dataScope: 'platform', permissions: ['ai.assistant.use'] }), false)
  assert.equal(canUseAssistant(null), false)
  assert.equal(canUseAssistant(undefined), false)
})

test('the request is the question and nothing else', () => {
  assert.deepEqual(askBody('  What attendance is required?  '), { question: 'What attendance is required?' })
  assert.deepEqual(Object.keys(askBody('x')), ['question'])
})

test('sending needs a question within the limit and no request in progress', () => {
  assert.equal(canSend('', false), false)
  assert.equal(canSend('   \n ', false), false)
  assert.equal(canSend('When is sports day?', false), true)
  assert.equal(canSend('When is sports day?', true), false)
  assert.equal(canSend('q'.repeat(MAX_QUESTION_CHARS), false), true)
  assert.equal(canSend('q'.repeat(MAX_QUESTION_CHARS + 1), false), false)
  assert.equal(MAX_QUESTION_CHARS, 1000)
})

test('the remaining length is shown only near the limit', () => {
  assert.equal(limitHint('short question'), null)
  assert.equal(limitHint('q'.repeat(799)), null)
  assert.equal(limitHint('q'.repeat(800)), '200 characters left')
  assert.equal(limitHint('q'.repeat(999)), '1 character left')
  assert.equal(limitHint('q'.repeat(1000)), 'Limit reached (1000 characters)')
})

test('an answer keeps its text and only the reader-facing parts of its sources', () => {
  const reply = replyFor(answer)
  assert.deepEqual(reply, { kind: 'answer', text: 'Students must maintain at least 75% attendance.', shortened: false, sources: [{ number: 1, title: 'Attendance Policy', label: 'attendance-policy.md', section: 'Attendance', page: null }] })
  // No identifier, model name or usage figure is carried into what is displayed.
  assert.doesNotMatch(JSON.stringify(reply), /7c1d0000|documentId|some-model-name|inputTokens|239/)
  assert.equal((replyFor({ ...answer, finish: 'length' }) as { shortened: boolean }).shortened, true)
})

test('sources come only from the list the backend sent', () => {
  assert.deepEqual(sourcesOf(undefined), [])
  assert.deepEqual(sourcesOf('Attendance Policy'), [])
  assert.deepEqual(sourcesOf([{ title: '' }, { section: 'No title' }, null, 7]), [])
  assert.deepEqual(sourcesOf([{ number: 2, title: ' Handbook ', source: 'handbook.pdf', section: null, page: 4, schoolId: 'x', chunkId: 'y', similarity: 0.91, path: 'C:\\docs\\handbook.pdf' }]),
    [{ number: 2, title: 'Handbook', label: 'handbook.pdf', section: null, page: 4 }])
  assert.equal(sourcesOf(Array.from({ length: 50 }, (_, i) => ({ number: i + 1, title: 'T' + i }))).length, 20)
  // An answer that mentions a document does not create a source.
  assert.deepEqual((replyFor({ available: true, answer: 'See [source 9] Principal orders, page 3.', sources: [] }) as { sources: unknown[] }).sources, [])
})

test('every backend reason has a fixed friendly sentence and the reason itself is never shown', () => {
  assert.equal(noticeFor('insufficient-knowledge'), "I couldn't find enough information in your school's available knowledge to answer that.")
  for (const reason of ['provider-unavailable', 'provider-timeout', 'retrieval-unavailable', 'database-unavailable'])
    assert.equal(noticeFor(reason), 'EduOS AI is temporarily unavailable. Please try again later.')
  assert.equal(noticeFor('rate-limited', 45), "You're asking quickly. Please wait 45 seconds and try again.")
  assert.equal(noticeFor('rate-limited', 1), "You're asking quickly. Please wait 1 second and try again.")
  assert.equal(noticeFor('rate-limited'), "You're asking quickly. Please wait a moment and try again.")
  assert.match(noticeFor('school-disabled'), /not currently enabled for your school/)
  assert.match(noticeFor('quota-exceeded'), /allowance for this month/)
  assert.equal(noticeFor('something-new: Npgsql.PostgresException at db.internal'), messages.generic)
  const reasons = ['insufficient-knowledge', 'provider-unavailable', 'provider-timeout', 'retrieval-unavailable', 'database-unavailable', 'rate-limited', 'school-disabled', 'quota-exceeded', 'not-configured', 'not-permitted', 'unknown']
  for (const reason of reasons) assert.doesNotMatch(noticeFor(reason), /provider|retrieval|database|quota|configured|model|llama|qwen|bge|embedding|exception|-/i)
  assert.deepEqual(replyFor({ available: false, reason: 'rate-limited', retryAfterSeconds: 30 }), { kind: 'notice', text: "You're asking quickly. Please wait 30 seconds and try again." })
  assert.deepEqual(replyFor({ available: false, reason: 'insufficient-knowledge' }), { kind: 'notice', text: messages.insufficient })
})

test('a malformed or empty response becomes a generic notice, never a made-up answer', () => {
  for (const data of [undefined, null, {}, 'text', { available: true }, { available: true, answer: '   ' }, { available: true, answer: 42 }, { available: 'true', answer: 'x' }])
    assert.deepEqual(replyFor(data), { kind: 'notice', text: messages.generic })
})

test('a failed request shows a fixed sentence and nothing from the response', () => {
  assert.equal(replyForFailure(400).text, messages.tooLong)
  assert.equal(replyForFailure(413).text, messages.tooLong)
  assert.equal(replyForFailure(403).text, messages.notForAccount)
  assert.equal(replyForFailure(502).text, messages.unavailable)
  assert.equal(replyForFailure(503).text, messages.unavailable)
  assert.equal(replyForFailure(undefined).text, messages.generic)
  assert.equal(replyForFailure(undefined, true).text, messages.slow)
})

test('the status banner blocks asking only when asking cannot work', () => {
  assert.equal(statusNotice({ enabled: true, reason: null }), null)
  assert.equal(statusNotice(undefined), null)
  assert.deepEqual(statusNotice({ enabled: false, reason: 'school-disabled' }), { text: messages.disabled, blocks: true })
  assert.deepEqual(statusNotice({ enabled: false, reason: 'quota-exceeded' }), { text: messages.allowance, blocks: true })
  assert.deepEqual(statusNotice({ enabled: false, reason: 'provider-unavailable' }), { text: messages.unavailable, blocks: false })
})
