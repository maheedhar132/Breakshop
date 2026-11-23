// What each part of the shop is and who it talks to. Facts about the shop's structure only: nothing here knows what is broken.
const SERVICES = {
  storefront: { layer: 0, role: 'edge', does: 'The BreakTel website customers see. Serves the pages and passes their clicks to the gateway.', calls: ['gateway'] },
  gateway: { layer: 1, role: 'edge', does: 'The single front door. Routes every request to the service that owns it.', calls: ['account', 'orders', 'plans', 'coverage', 'porting', 'auth'] },
  auth: { layer: 2, role: 'core', does: 'Logins and sessions.', calls: [] },
  account: { layer: 2, role: 'core', does: 'Creates and reads customer accounts.', calls: ['check-user-id', 'kyc', 'notifications'] },
  plans: { layer: 2, role: 'core', does: 'The catalogue of SIM and broadband plans, plus a pretend stock check.', calls: [] },
  coverage: { layer: 2, role: 'core', does: 'Says whether fibre is available at a postcode.', calls: [] },
  orders: { layer: 2, role: 'core', does: 'Runs every purchase from start to finish and calls the services it needs along the way.', calls: ['pricing', 'plans', 'coverage', 'number-inventory', 'kyc', 'payment', 'billing', 'notifications', 'bus'] },
  porting: { layer: 2, role: 'core', does: 'Moves a phone number to or from another operator.', calls: ['kyc', 'porting-hub', 'number-inventory', 'billing'] },
  'check-user-id': { layer: 3, role: 'core', does: 'Says whether a customer is already registered. That is its only job.', calls: [] },
  kyc: { layer: 3, role: 'core', does: "Checks a customer's identity (know your customer) with an outside provider.", calls: ['kyc-provider'] },
  pricing: { layer: 3, role: 'core', does: 'Works out what a basket costs, including discounts.', calls: ['plans'] },
  'number-inventory': { layer: 3, role: 'core', does: 'Reserves, assigns and releases phone numbers.', calls: [] },
  payment: { layer: 3, role: 'core', does: 'Takes the money by asking the payment gateway.', calls: ['payment-gateway'] },
  billing: { layer: 3, role: 'core', does: 'Activates billing accounts and applies top-up credit.', calls: [] },
  notifications: { layer: 3, role: 'core', does: 'Sends text messages and emails (pretend).', calls: [] },
  bus: { layer: 3, role: 'async', does: 'A message queue. Orders leave messages here and other services collect them a moment later.', calls: ['provisioning', 'fulfilment'], later: true },
  provisioning: { layer: 4, role: 'async', does: 'Switches a paid SIM or broadband line on. It works from the queue, a little behind the shop.', calls: ['number-inventory', 'billing'] },
  fulfilment: { layer: 4, role: 'async', does: 'Ships SIM cards and books broadband installs. It works from the queue.', calls: ['courier'] },
  'kyc-provider': { layer: 5, role: 'partner', does: 'A pretend outside company that verifies identity documents.', calls: [] },
  'payment-gateway': { layer: 5, role: 'partner', does: 'A pretend card network that approves or declines payments.', calls: [] },
  courier: { layer: 5, role: 'partner', does: 'A pretend courier that posts SIM cards.', calls: [] },
  'porting-hub': { layer: 5, role: 'partner', does: 'A pretend exchange that moves numbers between operators.', calls: [] }
};

const JOURNEYS = {
  create_account: {
    title: 'Create account', blurb: 'A new customer signs up. If they already exist, the journey stops early.',
    services: ['storefront', 'gateway', 'account', 'check-user-id', 'kyc', 'kyc-provider', 'notifications']
  },
  buy_sim: {
    title: 'Buy a SIM', blurb: 'Pick a plan and a number, verify identity, pay, then the SIM is shipped and switched on.',
    services: ['storefront', 'gateway', 'orders', 'plans', 'pricing', 'number-inventory', 'kyc', 'kyc-provider', 'payment', 'payment-gateway', 'bus', 'provisioning', 'fulfilment', 'courier', 'billing']
  },
  buy_broadband: {
    title: 'Buy broadband', blurb: 'Check the postcode, pay, then an install is booked and the line is switched on.',
    services: ['storefront', 'gateway', 'orders', 'plans', 'pricing', 'coverage', 'payment', 'payment-gateway', 'bus', 'provisioning', 'fulfilment', 'billing']
  },
  recharge: {
    title: 'Top up', blurb: 'Pay a small amount and have it added as credit.',
    services: ['storefront', 'gateway', 'orders', 'pricing', 'payment', 'payment-gateway', 'billing', 'notifications']
  },
  port_in: {
    title: 'Transfer a number in', blurb: 'Bring a number over from another operator.',
    services: ['storefront', 'gateway', 'porting', 'kyc', 'kyc-provider', 'porting-hub', 'number-inventory', 'billing']
  },
  port_out: {
    title: 'Transfer a number out', blurb: 'Send a number to another operator.',
    services: ['storefront', 'gateway', 'porting', 'porting-hub', 'number-inventory']
  }
};

module.exports = { SERVICES, JOURNEYS };
