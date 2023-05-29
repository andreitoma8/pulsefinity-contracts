// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IStakingRouter.sol";
import "./interfaces/IStakingPool.sol";

contract StakingRouter is IStakingRouter, OwnableUpgradeable, UUPSUpgradeable {
    IERC20 public pulsefinityToken;
    IStakingPool[] public stakingPools;

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
     * @notice Mapping of tier to the number of stakers in that tier
     */
    mapping(Tier => uint256) public stakersPerTier;

    /**
     * @notice Mapping of address to staking pool status
     */
    mapping(address => bool) public isStakingPool;

    /**
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Function to be called once on deployment
     * @param _pulsefinityToken The address of the Pulsefinity token
     * @param _tierLimits The tier limits for each tier
     */
    function initialize(IERC20 _pulsefinityToken, TierLimits memory _tierLimits) external initializer {
        pulsefinityToken = _pulsefinityToken;
        tierLimits = _tierLimits;
        __Ownable_init();
    }

    // view functions

    /**
     * @notice Returns the total amount staked by an address
     * @param _address The address to check
     */
    function getTotalStaked(address _address) public view returns (uint256 totalStaked) {
        for (uint256 i = 0; i < stakingPools.length; i++) {
            totalStaked += stakingPools[i].getTotalValueStaked(_address);
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
    function getGlobalAmountStaked() external view returns (uint256 totalAmountStaked) {
        for (uint256 i = 0; i < stakingPools.length; i++) {
            totalAmountStaked += pulsefinityToken.balanceOf(address(stakingPools[i]));
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

    /**
     * @notice Returns the total stakers in a tier
     * @param _tier The tier to query
     */
    function getStakersForTier(Tier _tier) external view override returns (uint256) {
        return stakersPerTier[_tier];
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
        require(!isStakingPool[address(_stakingPool)], "Staking pool already added");
        stakingPools.push(_stakingPool);
        isStakingPool[address(_stakingPool)] = true;
    }

    /**
     * @notice Removes a staking pool from the staking router
     * @param _index The index of the staking pool to remove
     */
    function removeStakingPool(uint256 _index) external onlyOwner {
        require(_index < stakingPools.length, "Index out of bounds");
        isStakingPool[address(stakingPools[_index])] = false;
        if (_index != stakingPools.length - 1) {
            stakingPools[_index] = stakingPools[stakingPools.length - 1];
        }
        stakingPools.pop();
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

    /**
     * @notice This function is used to upgrade the contract
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
