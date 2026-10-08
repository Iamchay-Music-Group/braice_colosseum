export enum UserType {
  CREATOR = 'CREATOR',
  MEMBER = 'MEMBER',
  PARTNER = 'PARTNER',
  APPLICATION = 'APPLICATION',
  ADMIN = 'ADMIN',
}

export interface UserProfile {
  id: string;
  walletAddress?: string;
  email?: string;
  displayName: string;
  userType: UserType;
  createdAt: Date;
}
