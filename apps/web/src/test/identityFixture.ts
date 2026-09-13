import type { TakeMe } from "../types/identity";

export const xConnectedMe: TakeMe = {
  user: {
    id: "user-real",
    takeIdentityId: "take-real",
    displayName: "Real X Person",
    username: "realxperson",
    avatarUrl: "https://pbs.twimg.com/profile_images/real.jpg",
    bio: null,
    joinedAt: "2026-09-01T10:00:00.000Z",
  },
  socials: {
    twitter: {
      connected: true,
      subject: "twitter-real-subject",
      username: "realxperson",
      name: "Real X Person",
      profilePictureUrl: "https://pbs.twimg.com/profile_images/real.jpg",
    },
    discord: { connected: false },
    farcaster: { connected: false },
    github: { connected: false },
  },
  wallets: [{
    address: "0x1111111111111111111111111111111111111111",
    chainType: "ethereum",
    type: "embedded",
    embedded: true,
    primary: true,
  }],
  takes: { given: 2, received: 3 },
};
