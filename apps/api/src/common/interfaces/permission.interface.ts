export enum PermissionStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum Operation {
  READ = 'READ',
  ANALYZE = 'ANALYZE',
  EXPORT = 'EXPORT',
}

export interface PermissionConditions {
  aggregationLevel?: string;
  allowIndividualData: boolean;
}

export interface Permission {
  id: string;
  accessRequestId: string;
  principalId: string;
  resourceId: string;
  purpose: string;
  operation: Operation;
  conditions?: PermissionConditions;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  status: PermissionStatus;
  policyHash?: string;
  blockchainReference?: string;
}
