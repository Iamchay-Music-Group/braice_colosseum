import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

/**
 * Reject a path parameter that is not a uuid, at the boundary.
 *
 * Without this the malformed value is passed straight into a query and Postgres
 * answers `invalid input syntax for type uuid`, which surfaces as a 500 and
 * leaks the driver's message and query shape to the caller. A client sending
 * `/communities/null/datasets` — which is exactly what happened when a
 * frontend interpolated an absent id into a path — is a client bug, and it
 * should be reported as a 400 that names the offending parameter.
 *
 * `isUuid` is the default version list, so any uuid is accepted; only the
 * shape is checked, never whether the row exists. Existence remains a 404 from
 * the service, which is the only layer entitled to answer that.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  private static readonly UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  transform(value: string, metadata: { type: 'param' | 'query' | 'body'; data?: string }): string {
    const name = metadata.data ?? 'value';

    if (typeof value !== 'string' || !ParseUuidPipe.UUID.test(value)) {
      throw new BadRequestException(
        `"${name}" must be a uuid, received ${JSON.stringify(value)}`,
      );
    }

    return value;
  }
}