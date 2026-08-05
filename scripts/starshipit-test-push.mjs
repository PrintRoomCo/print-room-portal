#!/usr/bin/env node
// P0 live-schema verification for the Starshipit order push (design spec §7.1).
// Creates ONE clearly-marked TEST order in the Print Room Dispatch account and
// prints the raw response so the real /api/orders schema can be captured.
//
// Usage:
//   STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... \
//     node scripts/starshipit-test-push.mjs                  # create test order
//   ... node scripts/starshipit-test-push.mjs --delete <order_id>   # clean up
//
// Never use a real customer address or email here.

const BASE_URL = 'https://api.starshipit.com'

const apiKey = process.env.STARSHIPIT_API_KEY
const subKey = process.env.STARSHIPIT_SUBSCRIPTION_KEY
if (!apiKey || !subKey) {
  console.error('Set STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY')
  process.exit(1)
}

const headers = {
  'StarShipIT-Api-Key': apiKey,
  'Ocp-Apim-Subscription-Key': subKey,
  'Content-Type': 'application/json',
}

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  console.log(`${method} ${path} -> HTTP ${res.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  return res
}

const [, , flag, deleteId] = process.argv
if (flag === '--delete') {
  if (!deleteId) {
    console.error('Usage: node scripts/starshipit-test-push.mjs --delete <order_id>')
    process.exit(1)
  }
  await call('DELETE', `/api/orders/delete?order_id=${encodeURIComponent(deleteId)}`)
  process.exit(0)
}

const orderNumber = `PORTAL-TEST-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
await call('POST', '/api/orders', {
  order: {
    order_number: orderNumber,
    reference: 'PORTAL P0 TEST - DO NOT SHIP - DELETE AFTER VERIFYING',
    destination: {
      name: 'TEST DO NOT SHIP',
      email: 'jamie@theprint-room.co.nz',
      phone: '021000000',
      company: 'The Print Room (portal test)',
      street: '1 Test Street',
      suburb: 'Newmarket',
      city: 'Auckland',
      state: '',
      post_code: '1023',
      country: 'New Zealand',
    },
    items: [
      { description: 'TEST ITEM - portal P0 schema check', quantity: 1, value: 1 },
    ],
  },
})
