// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract TakeCampaignManager {
    enum CampaignStatus {
        None,
        Created,
        Active,
        Closed,
        Finalized,
        Cancelled
    }

    enum EligibilityMode {
        OpenRegistered,
        MerkleAllowlist,
        OrganizerApproved,
        ExternalAllowed
    }

    enum NominationVisibilityMode {
        Public,
        Sealed
    }

    struct CampaignInput {
        bytes32 metadataHash;
        uint64 startTime;
        uint64 endTime;
        uint32 nominationLimit;
        EligibilityMode nominatorEligibilityMode;
        EligibilityMode recipientEligibilityMode;
        NominationVisibilityMode nominationVisibilityMode;
        bytes32 nominatorEligibilityRoot;
        bytes32 recipientEligibilityRoot;
        bytes32 rulesHash;
        bool cancellableAfterStart;
    }

    struct Campaign {
        address organizer;
        bytes32 metadataHash;
        uint64 startTime;
        uint64 endTime;
        uint32 nominationLimit;
        EligibilityMode nominatorEligibilityMode;
        EligibilityMode recipientEligibilityMode;
        NominationVisibilityMode nominationVisibilityMode;
        CampaignStatus status;
        bytes32 nominatorEligibilityRoot;
        bytes32 recipientEligibilityRoot;
        bytes32 rulesHash;
        bytes32 finalResultHash;
        bool cancellableAfterStart;
        bool hasNominations;
    }

    error InvalidIdentityKey();
    error IdentityAlreadyRegistered();
    error IdentityNotRegistered();
    error WalletAlreadyRegistered();
    error WalletNotAuthorized();
    error AliasAlreadyRegistered();
    error InvalidCampaign();
    error InvalidCampaignTime();
    error InvalidCampaignStatus();
    error UnauthorizedOrganizer();
    error CampaignNotActive();
    error CampaignExpired();
    error NominationLimitExceeded();
    error SelfNomination();
    error IneligibleNominator();
    error InvalidRecipient();
    error FinalResultAlreadySet();
    error CancellationNotAllowed();

    uint256 public nextCampaignId = 1;

    mapping(uint256 campaignId => Campaign campaign) public campaigns;
    mapping(bytes32 protocolIdentityKey => bool registered) public registeredProtocolIdentities;
    mapping(bytes32 identityKey => bytes32 canonicalKey) public canonicalIdentityKey;
    mapping(bytes32 protocolIdentityKey => mapping(address wallet => bool authorized)) public authorizedWallets;
    mapping(address wallet => bytes32 protocolIdentityKey) public walletPrimaryIdentity;
    mapping(uint256 campaignId => mapping(bytes32 giverKey => uint32 usedCount)) public takeCounts;

    event IdentityRegistered(bytes32 indexed protocolIdentityKey, address indexed wallet);
    event IdentityAliasRegistered(bytes32 indexed protocolIdentityKey, bytes32 indexed aliasIdentityKey);
    event CampaignCreated(uint256 indexed campaignId, address indexed organizer, bytes32 rulesHash);
    event CampaignActivated(uint256 indexed campaignId);
    event TakeGiven(
        uint256 indexed campaignId,
        bytes32 indexed giverIdentityKey,
        bytes32 indexed recipientIdentityKey
    );
    event CampaignClosed(uint256 indexed campaignId);
    event AllocationCommitted(uint256 indexed campaignId, bytes32 indexed resultHash);
    event CampaignFinalized(uint256 indexed campaignId, bytes32 indexed resultHash);
    event CampaignCancelled(uint256 indexed campaignId);

    modifier onlyOrganizer(uint256 campaignId) {
        if (campaigns[campaignId].organizer != msg.sender) {
            revert UnauthorizedOrganizer();
        }
        _;
    }

    function registerIdentity(bytes32 protocolIdentityKey) external {
        if (protocolIdentityKey == bytes32(0)) {
            revert InvalidIdentityKey();
        }
        if (registeredProtocolIdentities[protocolIdentityKey]) {
            revert IdentityAlreadyRegistered();
        }
        if (walletPrimaryIdentity[msg.sender] != bytes32(0)) {
            revert WalletAlreadyRegistered();
        }

        registeredProtocolIdentities[protocolIdentityKey] = true;
        canonicalIdentityKey[protocolIdentityKey] = protocolIdentityKey;
        authorizedWallets[protocolIdentityKey][msg.sender] = true;
        walletPrimaryIdentity[msg.sender] = protocolIdentityKey;

        emit IdentityRegistered(protocolIdentityKey, msg.sender);
    }

    function registerIdentityAlias(bytes32 protocolIdentityKey, bytes32 aliasIdentityKey) external {
        _requireAuthorizedIdentity(protocolIdentityKey);
        if (aliasIdentityKey == bytes32(0)) {
            revert InvalidIdentityKey();
        }
        bytes32 existingCanonical = canonicalIdentityKey[aliasIdentityKey];
        if (existingCanonical != bytes32(0) && existingCanonical != protocolIdentityKey) {
            revert AliasAlreadyRegistered();
        }

        canonicalIdentityKey[aliasIdentityKey] = protocolIdentityKey;

        emit IdentityAliasRegistered(protocolIdentityKey, aliasIdentityKey);
    }

    function createCampaign(CampaignInput calldata input) external returns (uint256 campaignId) {
        if (input.endTime <= input.startTime || input.endTime <= block.timestamp) {
            revert InvalidCampaignTime();
        }
        if (input.nominationLimit == 0) {
            revert InvalidCampaign();
        }
        if (input.nominationVisibilityMode != NominationVisibilityMode.Public) {
            revert InvalidCampaign();
        }

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            organizer: msg.sender,
            metadataHash: input.metadataHash,
            startTime: input.startTime,
            endTime: input.endTime,
            nominationLimit: input.nominationLimit,
            nominatorEligibilityMode: input.nominatorEligibilityMode,
            recipientEligibilityMode: input.recipientEligibilityMode,
            nominationVisibilityMode: input.nominationVisibilityMode,
            status: CampaignStatus.Created,
            nominatorEligibilityRoot: input.nominatorEligibilityRoot,
            recipientEligibilityRoot: input.recipientEligibilityRoot,
            rulesHash: input.rulesHash,
            finalResultHash: bytes32(0),
            cancellableAfterStart: input.cancellableAfterStart,
            hasNominations: false
        });

        emit CampaignCreated(campaignId, msg.sender, input.rulesHash);
    }

    function activateCampaign(uint256 campaignId) external {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Created) {
            revert InvalidCampaignStatus();
        }
        if (block.timestamp < campaign.startTime || block.timestamp >= campaign.endTime) {
            revert InvalidCampaignTime();
        }

        campaign.status = CampaignStatus.Active;
        emit CampaignActivated(campaignId);
    }

    function giveTake(
        uint256 campaignId,
        bytes32 giverProtocolIdentityKey,
        bytes32 recipientIdentityKey,
        bytes32[] calldata nominatorProof,
        bytes32[] calldata recipientProof
    ) external {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Active) {
            revert CampaignNotActive();
        }
        if (block.timestamp < campaign.startTime || block.timestamp >= campaign.endTime) {
            revert CampaignExpired();
        }
        _requireAuthorizedIdentity(giverProtocolIdentityKey);
        if (recipientIdentityKey == bytes32(0)) {
            revert InvalidRecipient();
        }

        bytes32 canonicalGiver = _canonical(giverProtocolIdentityKey);
        bytes32 canonicalRecipient = _canonical(recipientIdentityKey);
        if (canonicalGiver == canonicalRecipient) {
            revert SelfNomination();
        }

        if (!_isEligible(campaign.nominatorEligibilityMode, campaign.nominatorEligibilityRoot, giverProtocolIdentityKey, nominatorProof)) {
            revert IneligibleNominator();
        }
        if (!_isEligible(campaign.recipientEligibilityMode, campaign.recipientEligibilityRoot, recipientIdentityKey, recipientProof)) {
            revert InvalidRecipient();
        }

        uint32 newCount = takeCounts[campaignId][giverProtocolIdentityKey] + 1;
        if (newCount > campaign.nominationLimit) {
            revert NominationLimitExceeded();
        }

        takeCounts[campaignId][giverProtocolIdentityKey] = newCount;
        campaign.hasNominations = true;

        emit TakeGiven(campaignId, giverProtocolIdentityKey, recipientIdentityKey);
    }

    function closeCampaign(uint256 campaignId) external {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Active && campaign.status != CampaignStatus.Created) {
            revert InvalidCampaignStatus();
        }
        if (msg.sender != campaign.organizer && block.timestamp < campaign.endTime) {
            revert UnauthorizedOrganizer();
        }

        campaign.status = CampaignStatus.Closed;
        emit CampaignClosed(campaignId);
    }

    function cancelCampaign(uint256 campaignId) external onlyOrganizer(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status == CampaignStatus.Created) {
            campaign.status = CampaignStatus.Cancelled;
            emit CampaignCancelled(campaignId);
            return;
        }
        if (campaign.status != CampaignStatus.Active || !campaign.cancellableAfterStart || campaign.hasNominations) {
            revert CancellationNotAllowed();
        }

        campaign.status = CampaignStatus.Cancelled;
        emit CampaignCancelled(campaignId);
    }

    function finalizeAllocation(uint256 campaignId, bytes32 resultHash) external onlyOrganizer(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Closed) {
            revert InvalidCampaignStatus();
        }
        if (resultHash == bytes32(0)) {
            revert InvalidCampaign();
        }
        if (campaign.finalResultHash != bytes32(0)) {
            revert FinalResultAlreadySet();
        }

        campaign.finalResultHash = resultHash;
        campaign.status = CampaignStatus.Finalized;

        emit AllocationCommitted(campaignId, resultHash);
        emit CampaignFinalized(campaignId, resultHash);
    }

    function _requireAuthorizedIdentity(bytes32 protocolIdentityKey) internal view {
        if (!registeredProtocolIdentities[protocolIdentityKey]) {
            revert IdentityNotRegistered();
        }
        if (!authorizedWallets[protocolIdentityKey][msg.sender]) {
            revert WalletNotAuthorized();
        }
    }

    function _canonical(bytes32 identityKey) internal view returns (bytes32) {
        bytes32 canonical = canonicalIdentityKey[identityKey];
        return canonical == bytes32(0) ? identityKey : canonical;
    }

    function _isEligible(
        EligibilityMode mode,
        bytes32 root,
        bytes32 identityKey,
        bytes32[] calldata proof
    ) internal pure returns (bool) {
        if (mode == EligibilityMode.OpenRegistered || mode == EligibilityMode.ExternalAllowed) {
            return root == bytes32(0) || _verifyMerkleProof(proof, root, identityKey);
        }
        if (mode == EligibilityMode.MerkleAllowlist || mode == EligibilityMode.OrganizerApproved) {
            return root != bytes32(0) && _verifyMerkleProof(proof, root, identityKey);
        }
        return false;
    }

    function _verifyMerkleProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            computed = computed <= proofElement
                ? keccak256(abi.encodePacked(computed, proofElement))
                : keccak256(abi.encodePacked(proofElement, computed));
        }
        return computed == root;
    }
}
