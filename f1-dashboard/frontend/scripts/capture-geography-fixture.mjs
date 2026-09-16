import { writeFile } from 'node:fs/promises'
import { createJiti } from 'jiti'
const { createHistoryClient }=await createJiti(import.meta.url).import('../lib/tactical/history.ts')
const response=await fetch('https://api.openf1.org/v1/sessions?session_key=9472',{signal:AbortSignal.timeout(20000)})
if(!response.ok) throw new Error(`OpenF1 ${response.status}`)
const [session]=await response.json(),client=createHistoryClient()
const data=await client.load(session,5,new AbortController().signal,()=>{},true)
// Keep a real two-minute window for offline geographic and renderer regression tests.
await writeFile(new URL('../fixtures/tactical-bahrain-geography.json',import.meta.url),JSON.stringify({session,data}))
console.log(`Captured session ${session.session_key}: ${data.drivers.length} drivers`)
