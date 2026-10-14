import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentView } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';
import { INTENT_RATE_LIMIT } from './constants.js';

/**
 * L03 Intent Layer routes. All are workspace-scoped (a PR in another workspace
 * is a 404). Only the two POSTs can call the classifier, and both are rate
 * limited; the GET reads the cache and never bills.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  // Cached intent + freshness. No model or GitHub call.
  app.get('/pulls/:id/intent', {
    schema: { params: IdParams, response: { 200: PrIntentView } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.view(workspaceId, request.params.id);
  });

  // First-open generation: derives only when nothing usable is cached.
  app.post('/pulls/:id/intent', {
    schema: { params: IdParams, response: { 200: PrIntentView } },
    config: { rateLimit: INTENT_RATE_LIMIT },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.ensure(workspaceId, request.params.id);
  });

  // Explicit Recompute: always derives; a failure keeps the previous intent.
  app.post('/pulls/:id/intent/recompute', {
    schema: { params: IdParams, response: { 200: PrIntentView } },
    config: { rateLimit: INTENT_RATE_LIMIT },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.recompute(workspaceId, request.params.id);
  });
}
