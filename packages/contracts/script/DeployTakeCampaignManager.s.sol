// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../src/TakeCampaignManager.sol";

interface Vm {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployTakeCampaignManager {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (TakeCampaignManager manager) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        manager = new TakeCampaignManager();
        vm.stopBroadcast();
    }
}
