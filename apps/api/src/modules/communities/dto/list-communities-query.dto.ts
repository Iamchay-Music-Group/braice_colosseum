import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The query for the public community directory.
 *
 * `search` is a case-insensitive substring match against the community name.
 * It is declared here rather than read raw from the query string so the global
 * ValidationPipe's `whitelist` and `forbidNonWhitelisted` settings apply to it:
 * an unexpected parameter is then a 400 rather than being silently accepted.
 */
export class ListCommunitiesQueryDto {
  @ApiPropertyOptional({
    example: 'afro',
    description:
      'Case-insensitive substring to match against the community name. Omit ' +
      'to list every community.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
