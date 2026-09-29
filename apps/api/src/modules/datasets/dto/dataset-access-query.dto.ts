import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The operations a permission can grant. Mirrors the engine's enum. */
export const DATASET_OPERATIONS = ['READ', 'ANALYZE', 'EXPORT'] as const;

export type DatasetOperation = (typeof DATASET_OPERATIONS)[number];

/**
 * What a dataset list is allowed to show.
 *
 * The `data` column is absent by design and not by omission — see
 * DatasetsController.findByCommunity for why a version number is shareable
 * while the aggregate it describes is not.
 */
export class DatasetSummary {
  @ApiProperty() id!: string;
  @ApiProperty() datasetType!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ description: 'Individual records that were aggregated' })
  sourceCount!: number;
  @ApiProperty() createdAt!: Date;
}

/**
 * The declared reason and action for a governed dataset read.
 *
 * These are query parameters, so they arrive as strings and nothing has checked
 * them before this point. `operation` in particular was cast straight to the
 * engine's Operation enum with `operation as Operation`, which TypeScript
 * accepts and the engine does not: an unvalidated cast is a claim about a
 * value that was never verified. `purpose` had the same problem in reverse —
 * an absent or empty purpose would have been handed to the engine as if it
 * were a real one.
 */
export class DatasetAccessQueryDto {
  @ApiProperty({
    description: 'Why the caller wants the data. Must match the permission.',
    example: 'campaign_planning',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  purpose!: string;

  @ApiProperty({
    description: 'What the caller intends to do with the data.',
    enum: DATASET_OPERATIONS,
    example: 'ANALYZE',
  })
  @IsIn(DATASET_OPERATIONS, {
    message: `operation must be one of: ${DATASET_OPERATIONS.join(', ')}`,
  })
  operation!: DatasetOperation;
}
