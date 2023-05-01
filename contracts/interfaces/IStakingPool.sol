// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingPool {
    function getTotalValueLocked(address _wallet) external view returns (uint256);

    function addRewards(uint256 _amount) external payable;

    function getRewardToken() external view returns (IERC20);
}
