import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, Length } from 'class-validator';

export class AiQueryDto {
  @ApiProperty({
    example: '44444444-4444-4444-8444-444444444444',
    description: 'Community whose intelligence the question is about',
  })
  @IsUUID()
  communityId!: string;

  @ApiProperty({
    example: 'What are the strongest emerging interests?',
    description: 'The question to answer',
  })
  @IsString()
  @Length(1, 1000, {
    message: 'question must be between 1 and 1000 characters',
  })
  question!: string;

  @ApiProperty({
    example: 'campaign_planning',
    description:
      'The purpose the caller claims. Evaluated against the grant by exact ' +
      'string match — it is not used to search for a matching permission, so ' +
      'a wrong value produces PURPOSE_MISMATCH rather than a silent fallback. ' +
      'The caller already knows this value: it is the purpose on the access ' +
      'request that created the grant.',
  })
  @IsString()
  @IsNotEmpty()
  purpose!: string;
}
