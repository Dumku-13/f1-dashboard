import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJiti } from 'jiti'
const { buildDuelSeries, defaultDuelDrivers } = await createJiti(import.meta.url).import('../lib/driverDuel.ts')
test('cumulative comparison sorts completed rounds and includes sprint points', () => {
  const series = buildDuelSeries({ rounds: { 1: { race: 25 }, 2: { race: 18, sprint: 8 } } }, { rounds: { 1: { race: 18 }, 2: { race: 25, sprint: 7 } } }, [
    { round: 2, name: 'Two', status: 'complete', is_sprint: true },
    { round: 3, name: 'Future', status: 'upcoming' },
    { round: 1, name: 'One', status: 'complete', is_sprint: false },
  ])
  assert.deepEqual(series.map(r => [r.round, r.firstPoints, r.secondPoints]), [[1,25,18],[2,51,50]])
})
test('missing entries mean no recorded points and defaults are distinct', () => {
  assert.equal(buildDuelSeries({rounds:{}}, {rounds:{}}, [{round:1,status:'complete'}])[0].firstPoints,0)
  const a={abbreviation:'ANT',position:1}, b={abbreviation:'RUS',position:2}
  assert.deepEqual(defaultDuelDrivers([b,a,a]),[a,b])
  assert.deepEqual(buildDuelSeries(null,null,[]),[])
})
