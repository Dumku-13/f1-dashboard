import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJiti } from 'jiti'
const { controlId, normalizeControl, filterControl, unseenControlCount } = await createJiti(import.meta.url).import('../lib/raceControl.ts')
const message = (text, seconds, extra = {}) => ({date:`2026-09-10T12:00:${seconds}Z`, message:text, category:'Other', flag:null, scope:null, lap_number:12, driver_number:null, sector:null, ...extra})
const green = message('TRACK CLEAR', '01', {flag:'GREEN'})
const incident = message('CAR 44 INCIDENT NOTED', '02', {driver_number:44})
const safety = message('SAFETY CAR DEPLOYED', '03')

test('replayed messages are deduplicated and ordered newest first with stable identity', () => {
  assert.deepEqual(normalizeControl([green, incident, green, safety]), [safety, incident, green])
  assert.equal(controlId({...incident}),controlId(incident))
  assert.notEqual(controlId({...incident, sector:2}),controlId(incident))
})
test('category and case-insensitive search combine without treating car numbers as flags', () => {
  assert.deepEqual(filterControl([green,incident,safety],'flags',''),[green,safety])
  assert.deepEqual(filterControl([green,incident,safety],'incidents',' 44 '),[incident])
  assert.deepEqual(filterControl([green,incident,safety],'all','track clear'),[green])
  assert.deepEqual(filterControl([green,incident,safety],'flags','44'),[])
  assert.deepEqual(filterControl([message('CAR 77 TIME DELETED AT 16:47:44','04'), incident],'incidents','44'),[incident])
})
test('paused catch-up counts unique arrivals even when older history drops out', () => {
  const seen=new Set([green,incident].map(controlId))
  assert.equal(unseenControlCount([incident,safety,safety],seen),1)
  assert.equal(unseenControlCount([incident],seen),0)
  assert.equal(unseenControlCount([],seen),0)
})
