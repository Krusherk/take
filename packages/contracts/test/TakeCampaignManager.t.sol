// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../src/TakeCampaignManager.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract TakeCampaignManagerTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TakeCampaignManager private manager;

    address private organizer = address(0xA11CE);
    address private giver = address(0xB0B);
    address private other = address(0xCAFE);

    bytes32 private giverKey = keccak256("giver");
    bytes32 private otherKey = keccak256("other");
    bytes32 private giverExternalKey = keccak256("giver-twitter");
    bytes32 private recipientKey = keccak256("recipient");

    event TakeGiven(uint256 indexed campaignId, bytes32 indexed giverIdentityKey, bytes32 indexed recipientIdentityKey);

    function setUp() public {
        manager = new TakeCampaignManager();
        vm.prank(giver);
        manager.registerIdentity(giverKey);
        vm.prank(other);
        manager.registerIdentity(otherKey);
    }

    function testCreateAndActivateCampaign() public {
        uint256 campaignId = _createCampaign(100, 200, 1);
        vm.warp(100);
        manager.activateCampaign(campaignId);
        (, , , , , , , , TakeCampaignManager.CampaignStatus status, , , , , , ) = manager.campaigns(campaignId);
        _assertEq(uint256(status), uint256(TakeCampaignManager.CampaignStatus.Active), "status");
    }

    function testRejectsInvalidCampaignTimes() public {
        vm.warp(100);
        vm.prank(organizer);
        vm.expectRevert(TakeCampaignManager.InvalidCampaignTime.selector);
        manager.createCampaign(_campaignInput(200, 100, 1));
    }

    function testRejectsNominationBeforeActive() public {
        uint256 campaignId = _createCampaign(100, 200, 1);
        vm.warp(100);
        vm.prank(giver);
        vm.expectRevert(TakeCampaignManager.CampaignNotActive.selector);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());
    }

    function testAllowsOneTakeByDefault() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(giver);
        vm.expectEmit(true, true, true, true);
        emit TakeGiven(campaignId, giverKey, recipientKey);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());

        _assertEq(manager.takeCounts(campaignId, giverKey), 1, "take count");
    }

    function testRejectsDuplicateTakeOverLimit() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(giver);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());

        vm.prank(giver);
        vm.expectRevert(TakeCampaignManager.NominationLimitExceeded.selector);
        manager.giveTake(campaignId, giverKey, keccak256("recipient-2"), _emptyProof(), _emptyProof());
    }

    function testCustomNominationLimit() public {
        uint256 campaignId = _activeCampaign(100, 200, 2);

        vm.prank(giver);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());

        vm.prank(giver);
        manager.giveTake(campaignId, giverKey, keccak256("recipient-2"), _emptyProof(), _emptyProof());

        _assertEq(manager.takeCounts(campaignId, giverKey), 2, "take count");
    }

    function testRejectsSelfNominationProtocolKey() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(giver);
        vm.expectRevert(TakeCampaignManager.SelfNomination.selector);
        manager.giveTake(campaignId, giverKey, giverKey, _emptyProof(), _emptyProof());
    }

    function testRejectsSelfNominationViaAlias() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(giver);
        manager.registerIdentityAlias(giverKey, giverExternalKey);

        vm.prank(giver);
        vm.expectRevert(TakeCampaignManager.SelfNomination.selector);
        manager.giveTake(campaignId, giverKey, giverExternalKey, _emptyProof(), _emptyProof());
    }

    function testRejectsUnauthorizedWalletForIdentity() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(other);
        vm.expectRevert(TakeCampaignManager.WalletNotAuthorized.selector);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());
    }

    function testRejectsNominationAfterEndTime() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.warp(200);
        vm.prank(giver);
        vm.expectRevert(TakeCampaignManager.CampaignExpired.selector);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());
    }

    function testCloseAfterEndTimeCanBePublic() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.warp(201);
        vm.prank(other);
        manager.closeCampaign(campaignId);

        (, , , , , , , , TakeCampaignManager.CampaignStatus status, , , , , , ) = manager.campaigns(campaignId);
        _assertEq(uint256(status), uint256(TakeCampaignManager.CampaignStatus.Closed), "status");
    }

    function testRejectsUnauthorizedCloseBeforeEndTime() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(other);
        vm.expectRevert(TakeCampaignManager.UnauthorizedOrganizer.selector);
        manager.closeCampaign(campaignId);
    }

    function testFinalizeIsIrreversible() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        vm.prank(organizer);
        manager.closeCampaign(campaignId);

        vm.prank(organizer);
        manager.finalizeAllocation(campaignId, keccak256("result"));

        vm.prank(organizer);
        vm.expectRevert(TakeCampaignManager.InvalidCampaignStatus.selector);
        manager.finalizeAllocation(campaignId, keccak256("result-2"));
    }

    function testCancelCreatedCampaign() public {
        uint256 campaignId = _createCampaign(100, 200, 1);

        vm.prank(organizer);
        manager.cancelCampaign(campaignId);

        (, , , , , , , , TakeCampaignManager.CampaignStatus status, , , , , , ) = manager.campaigns(campaignId);
        _assertEq(uint256(status), uint256(TakeCampaignManager.CampaignStatus.Cancelled), "status");
    }

    function testCannotCancelActiveCampaignWithNomination() public {
        uint256 campaignId = _activeCampaignCancellable(100, 200, 1);

        vm.prank(giver);
        manager.giveTake(campaignId, giverKey, recipientKey, _emptyProof(), _emptyProof());

        vm.prank(organizer);
        vm.expectRevert(TakeCampaignManager.CancellationNotAllowed.selector);
        manager.cancelCampaign(campaignId);
    }

    function testInvariantStyleCannotExceedLimit() public {
        uint256 campaignId = _activeCampaign(100, 200, 1);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(giver);
            try manager.giveTake(campaignId, giverKey, keccak256(abi.encode(i)), _emptyProof(), _emptyProof()) {} catch {}
        }

        _assertEq(manager.takeCounts(campaignId, giverKey), 1, "take count");
    }

    function _activeCampaign(uint64 start, uint64 end, uint32 limit) private returns (uint256 campaignId) {
        campaignId = _createCampaign(start, end, limit);
        vm.warp(start);
        manager.activateCampaign(campaignId);
    }

    function _activeCampaignCancellable(uint64 start, uint64 end, uint32 limit) private returns (uint256 campaignId) {
        vm.warp(1);
        vm.prank(organizer);
        campaignId = manager.createCampaign(_campaignInputCancellable(start, end, limit, true));
        vm.warp(start);
        manager.activateCampaign(campaignId);
    }

    function _createCampaign(uint64 start, uint64 end, uint32 limit) private returns (uint256 campaignId) {
        vm.warp(1);
        vm.prank(organizer);
        campaignId = manager.createCampaign(_campaignInput(start, end, limit));
    }

    function _campaignInput(uint64 start, uint64 end, uint32 limit)
        private
        pure
        returns (TakeCampaignManager.CampaignInput memory)
    {
        return _campaignInputCancellable(start, end, limit, false);
    }

    function _campaignInputCancellable(uint64 start, uint64 end, uint32 limit, bool cancellable)
        private
        pure
        returns (TakeCampaignManager.CampaignInput memory)
    {
        return TakeCampaignManager.CampaignInput({
            metadataHash: keccak256("metadata"),
            startTime: start,
            endTime: end,
            nominationLimit: limit,
            nominatorEligibilityMode: TakeCampaignManager.EligibilityMode.OpenRegistered,
            recipientEligibilityMode: TakeCampaignManager.EligibilityMode.ExternalAllowed,
            nominationVisibilityMode: TakeCampaignManager.NominationVisibilityMode.Public,
            nominatorEligibilityRoot: bytes32(0),
            recipientEligibilityRoot: bytes32(0),
            rulesHash: keccak256("rules"),
            cancellableAfterStart: cancellable
        });
    }

    function _emptyProof() private pure returns (bytes32[] memory proof) {
        proof = new bytes32[](0);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
