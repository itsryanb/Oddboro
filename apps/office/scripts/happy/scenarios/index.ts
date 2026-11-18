// Every scripted scenario, in the order `--all` plays them.
import handOffFiles from './hand-off-files.ts';
import parkedWake from './parked-wake.ts';
import scheduleLimits from './schedule-limits.ts';
import stuckWorking from './stuck-working.ts';
import tellLeadNo from './tell-lead-no.ts';
import windowLeaves from './window-leaves.ts';

export const SCENARIOS = [
  stuckWorking,
  handOffFiles,
  tellLeadNo,
  parkedWake,
  windowLeaves,
  scheduleLimits
];
