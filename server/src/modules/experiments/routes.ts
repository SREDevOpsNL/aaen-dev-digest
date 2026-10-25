import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ExperimentsService } from './service.js';

/**
 * HW2 controlled-experiment routes. Every route answers 404 unless the server
 * runs with a complete experiment configuration (a disposable stack started by
 * `scripts/e2e.sh --serve`); ordinary deployments never expose them.
 *
 *   GET  /experiments/identity        → stack, database and isolation facts
 *   GET  /experiments/endpoints       → live provider endpoints of the frozen model (free metadata)
 *   POST /experiments/preview         → a slot's checks, fingerprints and preflight, no model request
 *   POST /experiments/runs            → start one scheduled slot (needs the x-hw2-capability token)
 *   GET  /experiments/slots/:slotId   → runs recorded for a slot (reconciliation)
 *   POST /experiments/slots/:slotId/arm   → arm a slot for one Run Review click on the PR page (capability token)
 *   DELETE /experiments/slots/:slotId/arm → disarm a slot that was not clicked (capability token)
 */
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const StartBody = z.object({
  pr_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  slot_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
  experiment: z.enum(['17', '18']),
  condition: z.enum(['with', 'without']),
  phase: z.enum(['exploration', 'confirmatory']),
  manifest_fingerprint: Sha256,
  reservation_usd: z.number().positive().max(1.5),
  expected_diff_sha256: Sha256,
  expected_non_skill_fingerprint: Sha256.nullable(),
});
const PreviewBody = StartBody.omit({ slot_id: true, manifest_fingerprint: true, expected_non_skill_fingerprint: true });
const ArmBody = StartBody.omit({ slot_id: true });
/** The operator's spending capability token (see `cli.ts authorize`); required by every slot. */
const CAPABILITY_HEADER = 'x-hw2-capability';
const SlotParams = z.object({ slotId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/) });

export default async function experimentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ExperimentsService(app.container);

  // Scoped to this plugin: without a complete experiment configuration every
  // route here is 404, before body validation or any other work.
  app.addHook('onRequest', async (_request, reply) => {
    if (!app.container.config.experiment) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Experiment mode is not enabled' } });
    }
  });

  app.get('/experiments/identity', async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.identity(workspaceId);
  });

  app.get('/experiments/endpoints', async (request) => {
    await getContext(app.container, request);
    return service.endpoints();
  });

  app.post(
    '/experiments/runs',
    { schema: { body: StartBody }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { workspaceId } = await getContext(app.container, request);
      const header = request.headers[CAPABILITY_HEADER];
      const started = await service.start(workspaceId, request.body, typeof header === 'string' ? header : undefined, request.log);
      reply.status(202);
      return started;
    },
  );

  app.post('/experiments/preview', { schema: { body: PreviewBody } }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.preview(workspaceId, request.body);
  });

  app.post(
    '/experiments/slots/:slotId/arm',
    { schema: { params: SlotParams, body: ArmBody }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const header = request.headers[CAPABILITY_HEADER];
      return service.arm(workspaceId, { ...request.body, slot_id: request.params.slotId }, typeof header === 'string' ? header : undefined);
    },
  );

  app.delete('/experiments/slots/:slotId/arm', { schema: { params: SlotParams } }, async (request) => {
    await getContext(app.container, request);
    const header = request.headers[CAPABILITY_HEADER];
    return service.disarm(request.params.slotId, typeof header === 'string' ? header : undefined);
  });

  app.get('/experiments/slots/:slotId', { schema: { params: SlotParams } }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.slot(workspaceId, request.params.slotId);
  });
}
