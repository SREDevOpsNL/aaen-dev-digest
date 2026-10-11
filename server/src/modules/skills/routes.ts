import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Skill,
  SkillSummary,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import {
  SKILL_BODY_MAX_CHARS,
  SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_NAME_MAX_CHARS,
} from './constants.js';
import { SkillsService } from './service.js';

const Name = z.string().trim().min(1).max(SKILL_NAME_MAX_CHARS);
const Description = z.string().trim().max(SKILL_DESCRIPTION_MAX_CHARS);
const Body = z.string().trim().min(1).max(SKILL_BODY_MAX_CHARS);

const CreateSkillBody = z.object({
  name: Name,
  description: Description.default(''),
  type: SkillType,
  source: z.enum(['manual', 'extracted']).optional(),
  body: Body,
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string().trim().min(1).max(1_000)).max(100).optional(),
});

const UpdateSkillBody = z
  .object({
    name: Name.optional(),
    description: Description.optional(),
    type: SkillType.optional(),
    body: Body.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field' });

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const LinkedAgent = z.object({ id: z.string(), name: z.string() });
const DeleteResult = z.object({ ok: z.literal(true) });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get(
    '/skills',
    { schema: { response: { 200: z.array(SkillSummary) } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      return service.list(workspaceId);
    },
  );

  app.get(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: Skill } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const skill = await service.get(workspaceId, request.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.post(
    '/skills',
    { schema: { body: CreateSkillBody, response: { 201: Skill } } },
    async (request, reply) => {
      const { workspaceId } = await getContext(app.container, request);
      const skill = await service.create(workspaceId, request.body);
      reply.status(201);
      return skill;
    },
  );

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody, response: { 200: Skill } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const skill = await service.update(workspaceId, request.params.id, request.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: DeleteResult } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      if (!(await service.delete(workspaceId, request.params.id))) {
        throw new NotFoundError('Skill not found');
      }
      return { ok: true as const };
    },
  );

  app.get(
    '/skills/:id/versions',
    { schema: { params: IdParams, response: { 200: z.array(SkillVersion) } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const versions = await service.listVersions(workspaceId, request.params.id);
      if (!versions) throw new NotFoundError('Skill not found');
      return versions;
    },
  );

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams, response: { 200: SkillVersion } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const version = await service.getVersion(
        workspaceId,
        request.params.id,
        request.params.version,
      );
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.get(
    '/skills/:id/agents',
    { schema: { params: IdParams, response: { 200: z.array(LinkedAgent) } } },
    async (request) => {
      const { workspaceId } = await getContext(app.container, request);
      const agents = await service.linkedAgents(workspaceId, request.params.id);
      if (!agents) throw new NotFoundError('Skill not found');
      return agents;
    },
  );
}
