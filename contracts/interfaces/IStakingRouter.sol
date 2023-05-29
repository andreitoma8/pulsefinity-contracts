// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

enum Tier {
    Null,
    Nano,
    Micro,
    Mega,
    Giga,
    Tera,
    TeraPlus
}

interface IStakingRouter {
    /**
     * @notice Returns the tier of an address
     * @param _address The address to check
     */
    function getTier(address _address) external view returns (Tier);

    /**
     * @notice Returns the predicted tier of an address
     * @param _address The address to check
     * @param _amount The amount to add or remove from the addresses total staked
     * @param _isDeposit Whether the amount is being added or false if it is being removed
     */
    function getPredictedTier(address _address, uint256 _amount, bool _isDeposit) external view returns (Tier);

    /**
     * @notice Returns an array of the number of stakers in each tier
     * [Nano, Micro, Mega, Giga, Tera, TeraPlus]
     */
    function getStakersPerTier() external view returns (uint256[6] memory);

    /**
     * @notice Returns the total stakers in a tier
     * @param _tier The tier to query
     */
    function getStakersForTier(Tier _tier) external view returns (uint256);

    /**
     * @notice Used by staking pools to update the number of stakers in a tier
     * @param _tier The tier to update
     * @param _isAddition If ture, increment the number of stakers in the tier, otherwise decrement
     */
    function updateStakersPerTier(Tier _tier, bool _isAddition) external;
}
