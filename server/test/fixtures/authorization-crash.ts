import { authorizeExtraction, type ExtractionStack } from '../../src/experiments/hw2/conventions-runner.js';
import type { ExtractionPreview } from '../../src/modules/experiments/conventions.js';

const [home, previewJson, identityJson] = process.argv.slice(2);
if (!home || !previewJson || !identityJson) throw new Error('Missing crash-test input');
const preview = JSON.parse(previewJson) as ExtractionPreview;
const stack: ExtractionStack = {
  api: {} as ExtractionStack['api'], apiUrl: 'http://127.0.0.1:3951',
  stackId: preview.stack_id, database: preview.database_name,
  container: 'isolated-postgres',
  identity: JSON.parse(identityJson) as ExtractionStack['identity'],
};
authorizeExtraction({
  preview, stack, slotId: preview.slot_id, reservationUsd: preview.reservation_usd,
  cumulativeCeilingUsd: 0.05, keyUsage: { limit_remaining: 1 }, home,
  onBoundary: (boundary) => {
    if (boundary === 'token') process.kill(process.pid, 'SIGKILL');
  },
});
throw new Error('Child unexpectedly survived the token boundary');
