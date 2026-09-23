export enum UserType {
  CREATOR = 'CREATOR',
  MEMBER = 'MEMBER',
  BRAND = 'BRAND',
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
