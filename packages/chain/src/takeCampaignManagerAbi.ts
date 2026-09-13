import { parseAbiItem } from "viem";
import takeCampaignManagerAbiJson from "./abis/TakeCampaignManager.json" with { type: "json" };

export const takeCampaignManagerAbi = takeCampaignManagerAbiJson;

export const takeCampaignManagerEvents = {
  IdentityRegistered: parseAbiItem(
    "event IdentityRegistered(bytes32 indexed protocolIdentityKey, address indexed wallet)"
  ),
  IdentityAliasRegistered: parseAbiItem(
    "event IdentityAliasRegistered(bytes32 indexed protocolIdentityKey, bytes32 indexed aliasIdentityKey)"
  ),
  CampaignCreated: parseAbiItem(
    "event CampaignCreated(uint256 indexed campaignId, address indexed organizer, bytes32 rulesHash)"
  ),
  CampaignActivated: parseAbiItem("event CampaignActivated(uint256 indexed campaignId)"),
  TakeGiven: parseAbiItem(
    "event TakeGiven(uint256 indexed campaignId, bytes32 indexed giverIdentityKey, bytes32 indexed recipientIdentityKey)"
  ),
  CampaignClosed: parseAbiItem("event CampaignClosed(uint256 indexed campaignId)"),
  AllocationCommitted: parseAbiItem(
    "event AllocationCommitted(uint256 indexed campaignId, bytes32 indexed resultHash)"
  ),
  CampaignFinalized: parseAbiItem(
    "event CampaignFinalized(uint256 indexed campaignId, bytes32 indexed resultHash)"
  ),
  CampaignCancelled: parseAbiItem("event CampaignCancelled(uint256 indexed campaignId)")
} as const;
