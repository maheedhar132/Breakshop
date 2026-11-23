const FLOWS = {
  create_account: ['check_user_id', 'identity_verified', 'account_created', 'welcome_sent'],
  buy_broadband: ['plan_selected', 'coverage_confirmed', 'order_created', 'payment_authorised', 'install_booked', 'service_activated'],
  buy_sim: ['plan_selected', 'number_reserved', 'identity_verified', 'order_created', 'payment_authorised', 'sim_dispatched', 'sim_activated'],
  recharge: ['amount_selected', 'payment_authorised', 'credit_applied', 'confirmation_sent'],
  port_in: ['port_requested', 'identity_verified', 'hub_accepted', 'number_ported'],
  port_out: ['port_requested', 'hub_accepted', 'number_released']
};

function stepIndex(flow, step) {
  const steps = FLOWS[flow];
  if (!steps) throw new Error(`unknown flow ${flow}`);
  const i = steps.indexOf(step);
  if (i < 0) throw new Error(`unknown step ${step} in flow ${flow}`);
  return i;
}

module.exports = { FLOWS, stepIndex };
