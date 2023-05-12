// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingPool {
    /**
     * @notice Get the total value locked in the pool for a user
     * @param _wallet The address of the user
     */
    function getTotalValueLocked(address _wallet) external view returns (uint256);

    /**
     * @notice Add rewards to the pool
     * @param _amount The amount of tokens to add
     */
    function addRewards(uint256 _amount) external payable;

    /**
     * @notice Get the reward token(in case of native token, returns address(0))
     */
    function getRewardToken() external view returns (IERC20);
}
