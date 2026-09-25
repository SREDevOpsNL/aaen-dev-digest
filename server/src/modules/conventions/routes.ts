import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
} from '@devdigest/shared';
import { z } from 'zod';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

const RepoParams = z.object({ id: z.string().uuid() });
const UpdateBody = z.object({
  rule: z.string().trim().min(1).max(2_000).optional(),
  rationale: z.string().trim().max(4_000).nullable().optional(),
  status: ConventionStatus.optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });
const SkillDraftBody = z.object({
  convention_ids: z.array(z.string().uuid()).max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Convention IDs must be unique' })
    .optional(),
}).default({});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', {
    schema: { params: RepoParams, response: { 200: z.array(ConventionCandidate) } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.list(workspaceId, request.params.id);
  });

  app.post('/repos/:id/conventions/extract', {
    schema: { params: RepoParams, response: { 200: ConventionExtractResult } },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.extract(workspaceId, request.params.id);
  });

  app.post('/repos/:id/conventions/skill', {
    schema: { params: RepoParams, body: SkillDraftBody, response: { 200: ConventionSkillDraft } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    return service.skillDraft(workspaceId, request.params.id, request.body.convention_ids);
  });

  app.patch('/conventions/:id', {
    schema: { params: IdParams, body: UpdateBody, response: { 200: ConventionCandidate } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    const updated = await service.update(workspaceId, request.params.id, request.body);
    if (!updated) throw new NotFoundError('Convention not found');
    return updated;
  });

  app.delete('/conventions/:id', {
    schema: { params: IdParams, response: { 200: z.object({ ok: z.literal(true) }) } },
  }, async (request) => {
    const { workspaceId } = await getContext(app.container, request);
    if (!(await service.delete(workspaceId, request.params.id))) {
      throw new NotFoundError('Convention not found');
    }
    return { ok: true as const };
  });
}
