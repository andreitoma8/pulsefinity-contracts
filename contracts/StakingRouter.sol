// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IStakingRouter.sol";
import "./interfaces/IStakingPool.sol";

contract StakingRouter is IStakingRouter, Ownable {
    IERC20 public pulsefinityToken;
    IStakingPool[] public stakingPool;

    struct TierLimits {
        uint256 nano;
        uint256 micro;
        uint256 mega;
        uint256 giga;
        uint256 tera;
        uint256 teraPlus;
    }

    TierLimits public tierLimits;

    constructor(IERC20 _pulsefinityToken) {
        pulsefinityToken = _pulsefinityToken;
    }

    // view functions

    function getTotalStaked(address _address) public view returns (uint256 totalStaked) {
        for (uint256 i = 0; i < stakingPool.length; i++) {
            totalStaked += stakingPool[i].getTotalValueLocked(_address);
        }
    }

    function getTier(address _address) external view override returns (Tier) {
        uint256 totalStaked = getTotalStaked(_address);
        return _amountToTier(totalStaked);
    }

    function getPredictedTier(address _address, uint256 _amount) external view returns (Tier) {
        uint256 totalStaked = getTotalStaked(_address);
        totalStaked += _amount;
        return _amountToTier(totalStaked);
    }

    function getTotalAmountStaked() external view returns (uint256 totalAmountStaked) {
        for (uint256 i = 0; i < stakingPool.length; i++) {
            totalAmountStaked += pulsefinityToken.balanceOf(address(stakingPool[i]));
        }
    }

    // admin functions

    function addStakingPool(IStakingPool _stakingPool) external onlyOwner {
        stakingPool.push(_stakingPool);
    }

    function removeStakingPool(uint256 _index) external onlyOwner {
        require(_index < stakingPool.length, "Index out of bounds");
        stakingPool[_index] = stakingPool[stakingPool.length - 1];
        stakingPool.pop();
    }

    function setTiers(TierLimits memory _tierLimits) external onlyOwner {
        tierLimits = _tierLimits;
    }

    // internal functions

    function _amountToTier(uint256 _amount) internal view returns (Tier) {
        if (_amount < tierLimits.micro) {
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
