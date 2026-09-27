import {
  ConflictError,
  normalizeEmail,
  normalizeOptionalContact,
  normalizePhone,
  normalizeWhitespace,
  NotFoundError,
  ValidationError,
  type Player,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { CreatePlayerCommand, UpdatePlayerCommand } from './commands.ts';

/**
 * Player service.
 *
 * Player records are intentionally thin: a name plus optional, normalized
 * contact details. Contact uniqueness is ultimately enforced by the database
 * partial unique indexes; the service provides a friendly `ConflictError`
 * first, but does not rely on the pre-check alone - a concurrent insert that
 * wins the race is translated by the infrastructure adapter.
 */
export interface PlayerService {
  create(command: CreatePlayerCommand): Promise<Player>;
  update(id: string, command: UpdatePlayerCommand): Promise<Player>;
  getById(id: string): Promise<Player>;
}

export function createPlayerService(unitOfWork: UnitOfWork): PlayerService {
  return {
    async create(command: CreatePlayerCommand): Promise<Player> {
      const name = requireName(command.name);
      const email = normalizeOptionalContact(command.email, normalizeEmail);
      const phone = normalizeOptionalContact(command.phone, normalizePhone);

      return unitOfWork.runInTransaction(async (client) => {
        if (email !== null) {
          const existing = await client.players.findByEmail(email);
          if (existing) {
            throw new ConflictError('A player with this email address already exists.');
          }
        }
        if (phone !== null) {
          const existing = await client.players.findByPhone(phone);
          if (existing) {
            throw new ConflictError('A player with this phone number already exists.');
          }
        }

        return client.players.create({ name, email, phone });
      });
    },

    async update(id: string, command: UpdatePlayerCommand): Promise<Player> {
      return unitOfWork.runInTransaction(async (client) => {
        await requirePlayer(client, id);

        const data: {
          name?: string;
          email?: string | null;
          phone?: string | null;
        } = {};

        if (command.name !== undefined) {
          data.name = requireName(command.name);
        }

        if (command.email !== undefined) {
          const email = normalizeOptionalContact(command.email, normalizeEmail);
          if (email !== null) {
            const existing = await client.players.findByEmail(email);
            if (existing && existing.id !== id) {
              throw new ConflictError('A player with this email address already exists.');
            }
          }
          data.email = email;
        }

        if (command.phone !== undefined) {
          const phone = normalizeOptionalContact(command.phone, normalizePhone);
          if (phone !== null) {
            const existing = await client.players.findByPhone(phone);
            if (existing && existing.id !== id) {
              throw new ConflictError('A player with this phone number already exists.');
            }
          }
          data.phone = phone;
        }

        return client.players.update(id, data);
      });
    },

    async getById(id: string): Promise<Player> {
      return unitOfWork.runInTransaction(async (client) => requirePlayer(client, id));
    },
  };
}

async function requirePlayer(client: RepositoryClient, id: string): Promise<Player> {
  const player = await client.players.findById(id);
  if (!player) {
    throw new NotFoundError('Player', id);
  }
  return player;
}

function requireName(value: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError('Player name must not be empty.', 'name');
  }
  return name;
}
