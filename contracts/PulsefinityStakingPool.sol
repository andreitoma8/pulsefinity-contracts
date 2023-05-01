// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IStakingPool.sol";
import "./interfaces/IStakingRouter.sol";
import {Tier} from "./interfaces/IStakingRouter.sol";

contract PulsefinityStakingPool is IStakingPool, Ownable, ReentrancyGuard {
    IStakingRouter public stakingRouter;

    IERC20 public pulsefinityToken;
    IERC20 public rewardToken;

    bool public isNativeToken;

    uint256 public totalShares;
    uint256 public totalRewards;
    uint256 public totalStaked;

    Tier public requiredTier;

    enum LockType {
        Days15,
        Days30,
        Days60,
        Days90,
        Days180,
        Days360
    }

    struct Stake {
        uint256 amount;
        uint256 rewardShares;
        uint256 startTimestamp;
        LockType lockType;
    }

    mapping(address => Stake[]) public stakes;

    constructor(address _pulsefinityToken, address _rewardToken, IStakingRouter _stakingRouter, Tier _requiredTier) {
        pulsefinityToken = IERC20(_pulsefinityToken);
        stakingRouter = _stakingRouter;

        requiredTier = _requiredTier;

        isNativeToken = _rewardToken == address(0);
        if (!isNativeToken) {
            rewardToken = IERC20(_rewardToken);
        }
    }

    function stake(uint256 _amount, LockType _lockType) external {
        require(stakingRouter.getPredictedTier(msg.sender, _amount) >= requiredTier, "Insufficient tier");

        require(_amount > 0, "Cannot stake 0");
        require(_lockType >= LockType(0) && _lockType <= LockType(5), "Invalid lock type");

        pulsefinityToken.transferFrom(msg.sender, address(this), _amount);

        uint256 rewardBalance = isNativeToken ? address(this).balance : totalRewards;

        uint256 shares;

        if (totalShares == 0 || rewardBalance == 0) {
            shares = _multiplyByLock(_amount, _lockType);
        } else {
            uint256 what = _amount * totalShares / rewardBalance;
            shares += _multiplyByLock(what, _lockType);
        }

        totalShares += shares;
        totalStaked += _amount;

        stakes[msg.sender].push(Stake(_amount, shares, block.timestamp, _lockType));
    }

    function withdraw(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");

        Stake memory _stake = stakes[msg.sender][stakeIndex];

        uint256 unlockTimestamp = _getUnlockTimestamp(_stake.startTimestamp, _stake.lockType);

        uint256 rewardShares = _stake.rewardShares;

        if (block.timestamp >= unlockTimestamp) {
            pulsefinityToken.transfer(msg.sender, _stake.amount);

            if (isNativeToken) {
                uint256 rewardToTransfer = address(this).balance * rewardShares / totalShares;
                (bool sc,) = payable(msg.sender).call{value: rewardToTransfer}("");
                require(sc, "Transfer failed");
            } else {
                uint256 rewardsToTransfer = totalRewards * rewardShares / totalShares;

                rewardToken.transfer(msg.sender, rewardsToTransfer);
            }
        } else {
            if ((unlockTimestamp - _stake.startTimestamp) / 2 > block.timestamp - _stake.startTimestamp) {
                uint256 earlyWithdrawalFee = _stake.amount * 10 / 100;
                pulsefinityToken.transfer(msg.sender, _stake.amount - earlyWithdrawalFee);
                pulsefinityToken.transfer(owner(), earlyWithdrawalFee);
            }
        }

        totalShares -= rewardShares;
        totalStaked -= _stake.amount;

        stakes[msg.sender][stakeIndex] = stakes[msg.sender][stakes[msg.sender].length - 1];
        stakes[msg.sender].pop();
    }

    // View functions

    function getUserStakes(address _user) external view returns (Stake[] memory) {
        return stakes[_user];
    }

    function getTotalValueLocked(address _wallet) external view override returns (uint256) {
        if (stakes[_wallet].length == 0) return 0;
        Stake[] memory _stakes = stakes[_wallet];

        uint256 totalValueLocked;

        for (uint256 i = 0; i < _stakes.length; i++) {
            totalValueLocked += _stakes[i].amount;
        }

        return totalValueLocked;
    }

    function getRewardToken() external view override returns (IERC20) {
        return rewardToken;
    }

    // Admin functions

    function addRewards(uint256 _amount) external payable {
        if (!isNativeToken) {
            require(msg.value == 0, "Cannot add rewards with ETH");

            totalRewards += _amount;

            rewardToken.transferFrom(msg.sender, address(this), _amount);
        } else {
            totalRewards += msg.value;
        }
    }

    function withdrawRewardSurplus() external onlyOwner {
        if (isNativeToken) {
            (bool sc,) = payable(msg.sender).call{value: address(this).balance - totalRewards}("");
            require(sc, "Transfer failed");
        } else {
            uint256 rewardsSurplus = rewardToken.balanceOf(address(this)) - totalRewards;
            if (address(pulsefinityToken) == address(rewardToken)) {
                rewardsSurplus -= totalStaked;
            }
            rewardToken.transfer(msg.sender, rewardsSurplus);
        }
    }

    // Internal functions

    function _multiplyByLock(uint256 _amount, LockType _lockType) internal pure returns (uint256 newAmount) {
        newAmount = _amount;
        if (_lockType == LockType(0)) newAmount += _amount * 2 / 100;
        else if (_lockType == LockType(1)) newAmount += _amount * 5 / 100;
        else if (_lockType == LockType(2)) newAmount += _amount * 12 / 100;
        else if (_lockType == LockType(3)) newAmount += _amount * 18 / 100;
        else if (_lockType == LockType(4)) newAmount += _amount * 40 / 100;
        else newAmount += _amount * 100 / 100;
    }

    function _getUnlockTimestamp(uint256 _stakeStart, LockType _lockType)
        internal
        pure
        returns (uint256 unlockTimestamp)
    {
        if (_lockType == LockType(0)) unlockTimestamp = _stakeStart + 15 days;
        else if (_lockType == LockType(1)) unlockTimestamp = _stakeStart + 30 days;
        else if (_lockType == LockType(2)) unlockTimestamp = _stakeStart + 60 days;
        else if (_lockType == LockType(3)) unlockTimestamp = _stakeStart + 90 days;
        else if (_lockType == LockType(4)) unlockTimestamp = _stakeStart + 180 days;
        else unlockTimestamp = _stakeStart + 360 days;
    }

    // Receive function

    receive() external payable {
        if (!isNativeToken) {
            revert();
        }
    }
}
