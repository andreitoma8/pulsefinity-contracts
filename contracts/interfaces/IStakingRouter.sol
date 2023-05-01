// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

enum Tier {
    Nano,
    Micro,
    Mega,
    Giga,
    Tera,
    TeraPlus
}

interface IStakingRouter {
    function getTier(address _address) external view returns (Tier);

    function getPredictedTier(address _address, uint256 _amount) external view returns (Tier);
}
