export interface TakeMe {
  user: {
    id: string;
    takeIdentityId: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    joinedAt: string;
  };
  socials: {
    twitter: {
      connected: boolean;
      subject?: string;
      username?: string;
      name?: string;
      profilePictureUrl?: string;
    };
    discord: {
      connected: boolean;
      subject?: string;
      username?: string;
    };
    farcaster: {
      connected: boolean;
      fid?: number;
      username?: string;
      displayName?: string;
      pfp?: string;
    };
    github: {
      connected: boolean;
      subject?: string;
      username?: string;
      name?: string;
    };
  };
  wallets: Array<{
    address: string;
    chainType: string;
    type: string;
    embedded: boolean;
    primary: boolean;
  }>;
  takes: {
    given: number;
    received: number;
  };
}

export interface TakeHistoryPerson {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  joined: boolean;
}

export interface TakeHistoryEntry {
  id: string;
  campaignId: string;
  campaignTitle: string;
  person: TakeHistoryPerson | null;
  transactionHash: string | null;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TakeHistory {
  given: TakeHistoryEntry[];
  received: TakeHistoryEntry[];
}
