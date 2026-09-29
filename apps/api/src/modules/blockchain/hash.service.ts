import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Permission } from '../permissions/entities/permission.entity';

/**
 * Deterministic hashing for on-chain anchoring.
 *
 * `HashService` is the single place that turns an off-chain object into the
 * 32-byte value the program stores. If two code paths hashed the same permission
 * differently, a later verification would report a false mismatch and the
 * anchor would be useless, so the canonicalisation lives here alone.
 */
@Injectable()
export class HashService {
  /**
   * SHA-256 of the canonical JSON form of a value.
   *
   * Keys are sorted recursively, so the hash depends on the value's meaning and
   * not on the order properties happened to be assigned. Arrays keep their
   * order, because for a list of approvers the order is not the meaning but the
   * membership is.
   */
  hashCanonical(value: unknown): string {
    return createHash('sha256')
      .update(this.canonicalize(value))
      .digest('hex');
  }

  /**
   * The commitment value for a permission.
   *
   * Only the fields that define what the permission actually grants are hashed.
   * Bookkeeping columns (`id`, `blockchainReference`, `revokedAt`) are excluded
   * on purpose: a permission's meaning does not change because a signature was
   * recorded or a revocation timestamp was written, and including them would
   * make the hash differ between a freshly issued permission and the same
   * permission after an unrelated column was touched.
   */
  createPolicyHash(permission: Permission): string {
    return this.hashCanonical({
      principalId: permission.principalId,
      resourceId: permission.resourceId,
      purpose: permission.purpose,
      operation: permission.operation,
      conditions: permission.conditions ?? null,
      issuedAt: permission.issuedAt.toISOString(),
      expiresAt: permission.expiresAt.toISOString(),
      status: permission.status,
    });
  }

  private canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value ?? null);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalize(item)).join(',')}]`;
    }

    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${this.canonicalize(v)}`)
      .join(',')}}`;
  }
}
