const checks = [
  ['E1', 'Synthetic gateway load', 'npm run load:test'],
  ['E2', 'Redis atomic quota concurrency', 'npm run load:redis'],
  ['E3', 'Multi-instance shared quota', 'npm run load:multi'],
  ['E4', 'Sustained load', 'npm run load:sustained'],
  ['E5', 'Account fairness', 'npm run load:fairness'],
  ['E6', 'Failure/recovery under load', 'npm run load:failure'],
];
console.log(JSON.stringify({ phase: 'Batch E', checks, certification: 'Run each command against the target environment and retain JSON output as release evidence.', successCriteria: { E1: 'all requests complete; provider/state counts match; p95 within threshold', E2: 'accepted reservations never exceed RPM; Redis counters match accepted reservations', E3: 'all instances share one quota and combined accepted reservations never exceed RPM', E4: 'all rounds complete and average p95 remains within threshold', E5: 'round-robin accounts remain within floor/ceiling distribution', E6: 'Redis failure fails closed and reconnection restores reservation capability', E7: 'all E1-E6 outputs are green and attached to the release record' } }, null, 2));
