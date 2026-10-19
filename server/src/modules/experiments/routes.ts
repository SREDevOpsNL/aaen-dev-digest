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
 *   POST /experiments/runs            → start one scheduled slot (one review run)
 *   GET  /experiments/slots/:slotId   → runs recorded for a slot (reconciliation)
 */
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const StartBody = z.object({
  pr_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  slot_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
  experiment: z.enum(['17', '18']),
  condition: z.enum(['with', 'without']),
  manifest_fingerprint: Sha256,
  reservation_usd: z.number().positive().max(1.5),
  expected_diff_sha256: Sha256,
});
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

  app.post(
    '/experiments/runs',
    { schema: { body: StartBody }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { workspaceId } = await getContext(app.container, request);
      const started = await service.start(workspaceId, request.body, request.log);
      reply.status(202);
      return started;
    },
  );

  app.get('/experiments/slots/:slotId', { schema: { params: SlotParams } }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.slot(workspaceId, request.params.slotId);
  });
}
