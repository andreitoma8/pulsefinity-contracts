// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IStakingRouter.sol";
import "./interfaces/IStakingPool.sol";

contract StakingRouter is IStakingRouter, Ownable {
    IERC20 public pulsefinityToken;
    IStakingPool[] public stakingPool;

    /**
     * @notice The limits for each tier
     */
    struct TierLimits {
        uint256 nano;
        uint256 micro;
        uint256 mega;
        uint256 giga;
        uint256 tera;
        uint256 teraPlus;
    }

    TierLimits public tierLimits;

    /**
     * @notice The constructor for the StakingRouter contract
     * @param _pulsefinityToken The address of the Pulsefinity token
     */
    constructor(IERC20 _pulsefinityToken, TierLimits memory _tierLimits) {
        pulsefinityToken = _pulsefinityToken;
        tierLimits = _tierLimits;
    }

    /**
     * @notice Mapping of tier to the number of stakers in that tier
     */
    mapping(Tier => uint256) public stakersPerTier;

    /**
     * @notice Mapping of address to staking pool status
     */
    mapping(address => bool) public isStakingPool;

    // view functions

    /**
     * @notice Returns the total amount staked by an address
     * @param _address The address to check
     */
    function getTotalStaked(address _address) public view returns (uint256 totalStaked) {
        for (uint256 i = 0; i < stakingPool.length; i++) {
            totalStaked += stakingPool[i].getTotalValueLocked(_address);
        }
    }

    /**
     * @notice Returns the tier of an address
     * @param _address The address to check
     */
    function getTier(address _address) external view override returns (Tier) {
        uint256 totalStaked = getTotalStaked(_address);
        return _amountToTier(totalStaked);
    }

    /**
     * @notice Returns the predicted tier of an address
     * @param _address The address to check
     * @param _amount The amount to add or remove from the addresses total staked
     * @param _isDeposit Whether the amount is being added or false if it is being removed
     */
    function getPredictedTier(address _address, uint256 _amount, bool _isDeposit) external view returns (Tier) {
        uint256 totalStaked = getTotalStaked(_address);
        if (_isDeposit) {
            totalStaked += _amount;
        } else {
            totalStaked -= _amount;
        }
        return _amountToTier(totalStaked);
    }

    /**
     * @notice Returns the total amount staked across all staking pools
     */
    function getTotalAmountStaked() external view returns (uint256 totalAmountStaked) {
        for (uint256 i = 0; i < stakingPool.length; i++) {
            totalAmountStaked += pulsefinityToken.balanceOf(address(stakingPool[i]));
        }
    }

    /**
     * @notice Returns an array of the number of stakers in each tier
     * [Nano, Micro, Mega, Giga, Tera, TeraPlus]
     */
    function getStakersPerTier() external view override returns (uint256[6] memory) {
        uint256[6] memory _stakersPerTier;
        _stakersPerTier[uint256(Tier.Nano) - 1] = stakersPerTier[Tier.Nano];
        _stakersPerTier[uint256(Tier.Micro) - 1] = stakersPerTier[Tier.Micro];
        _stakersPerTier[uint256(Tier.Mega) - 1] = stakersPerTier[Tier.Mega];
        _stakersPerTier[uint256(Tier.Giga) - 1] = stakersPerTier[Tier.Giga];
        _stakersPerTier[uint256(Tier.Tera) - 1] = stakersPerTier[Tier.Tera];
        _stakersPerTier[uint256(Tier.TeraPlus) - 1] = stakersPerTier[Tier.TeraPlus];
        return _stakersPerTier;
    }

    // external functions

    /**
     * @notice Used by staking pools to update the number of stakers in a tier
     * @param _tier The tier to update
     * @param _isAddition If ture, increment the number of stakers in the tier, otherwise decrement
     */
    function updateStakersPerTier(Tier _tier, bool _isAddition) external override {
        require(isStakingPool[msg.sender], "Caller is not a staking pool");
        if (_isAddition) {
            stakersPerTier[_tier]++;
        } else {
            stakersPerTier[_tier]--;
        }
    }

    // admin functions

    /**
     * @notice Adds a staking pool to the staking router
     * @param _stakingPool The address of the staking pool to add
     */
    function addStakingPool(IStakingPool _stakingPool) external onlyOwner {
        stakingPool.push(_stakingPool);
        isStakingPool[address(_stakingPool)] = true;
    }

    /**
     * @notice Removes a staking pool from the staking router
     * @param _index The index of the staking pool to remove
     */
    function removeStakingPool(uint256 _index) external onlyOwner {
        require(_index < stakingPool.length, "Index out of bounds");
        stakingPool[_index] = stakingPool[stakingPool.length - 1];
        stakingPool.pop();
        isStakingPool[address(stakingPool[_index])] = false;
    }

    /**
     * @notice Sets the tier limits
     * @param _tierLimits The new tier limits struct
     */
    function setTiers(TierLimits memory _tierLimits) external onlyOwner {
        tierLimits = _tierLimits;
    }

    // internal functions

    function _amountToTier(uint256 _amount) internal view returns (Tier) {
        if (_amount < tierLimits.nano) {
            return Tier.Null;
        } else if (_amount < tierLimits.micro) {
            return Tier.Nano;
        } else if (_amount < tierLimits.mega) {
            return Tier.Micro;
        } else if (_amount < tierLimits.giga) {
            return Tier.Mega;
        } else if (_amount < tierLimits.tera) {
            return Tier.Giga;
        } else if (_amount < tierLimits.teraPlus) {
            return Tier.Tera;
        } else {
            return Tier.TeraPlus;
        }
    }
}
