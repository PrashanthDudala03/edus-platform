import test from 'node:test'
import assert from 'node:assert/strict'
import {schoolInstant,schoolLocal} from '../src/pages/suite/schoolClock.ts'
test('school scheduling is independent of the browser timezone and round trips',()=>{
 assert.equal(schoolInstant('2030-10-07T09:00','Asia/Kolkata'),'2030-10-07T03:30:00.000Z')
 assert.equal(schoolLocal('2030-10-07T03:30:00.000Z','Asia/Kolkata'),'2030-10-07T09:00')
 assert.equal(schoolInstant('2030-10-07T09:00','UTC'),'2030-10-07T09:00:00.000Z')
})
test('nonexistent and repeated daylight-saving times are rejected',()=>{
 assert.equal(schoolInstant('2026-03-08T02:30','America/New_York'),'')
 assert.equal(schoolInstant('2026-11-01T01:30','America/New_York'),'')
 assert.equal(schoolInstant('2026-11-01T03:30','America/New_York'),'2026-11-01T08:30:00.000Z')
 assert.equal(schoolInstant('2030-02-31T09:00','UTC'),'')
 assert.equal(schoolInstant('bad','UTC'),'')
})
