// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TakeCampaignManager} from "../src/TakeCampaignManager.sol";

interface IVm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract CreateDemoCampaign {
    IVm private constant VM = IVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        TakeCampaignManager manager = TakeCampaignManager(VM.envAddress("TAKE_CAMPAIGN_MANAGER_ADDRESS"));

        bytes32 giverKey = keccak256("TAKE_DEMO_GIVER_V1");
        bytes32 recipientExternalKey = keccak256("TAKE_DEMO_EXTERNAL_RECIPIENT_V1");
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + 7 days);

        VM.startBroadcast(deployerPrivateKey);

        manager.registerIdentity(giverKey);

        uint256 campaignId = manager.createCampaign(
            TakeCampaignManager.CampaignInput({
                metadataHash: keccak256("TAKE_DEMO_METADATA_V1"),
                startTime: startTime,
                endTime: endTime,
                nominationLimit: 1,
                nominatorEligibilityMode: TakeCampaignManager.EligibilityMode.OpenRegistered,
                recipientEligibilityMode: TakeCampaignManager.EligibilityMode.ExternalAllowed,
                nominationVisibilityMode: TakeCampaignManager.NominationVisibilityMode.Public,
                nominatorEligibilityRoot: bytes32(0),
                recipientEligibilityRoot: bytes32(0),
                rulesHash: keccak256("TAKE_DEMO_RULES_V1"),
                cancellableAfterStart: false
            })
        );

        manager.activateCampaign(campaignId);
        manager.giveTake(campaignId, giverKey, recipientExternalKey, new bytes32[](0), new bytes32[](0));

        VM.stopBroadcast();
    }
}
