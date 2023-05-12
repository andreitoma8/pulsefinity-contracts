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

    /**
     * @notice Whether the reward token is the native token or not(ERC20 if false)
     */
    bool public isNativeToken;

    /**
     * @notice The total shares of the reward pool
     */
    uint256 public totalShares;
    /**
     * @notice The total amount of rewards token in the reward pool
     */
    uint256 public totalRewards;
    /**
     * @notice The total amount of tokens staked
     */
    uint256 public totalStaked;

    /**
     * @notice The tier required to stake in this pool
     */
    Tier public requiredTier;

    /**
     * @notice Lock types
     */
    enum LockType {
        Days15,
        Days30,
        Days60,
        Days90,
        Days180,
        Days360
    }

    /**
     * @notice Stake struct
     */
    struct Stake {
        /**
         * @notice The amount of tokens staked
         */
        uint256 amount;
        /**
         * @notice The amount of shares the stake has from the reward pool
         */
        uint256 rewardShares;
        /**
         * @notice The timestamp of when the stake was created
         */
        uint256 startTimestamp;
        /**
         * @notice The lock type of the stake
         */
        LockType lockType;
    }

    /**
     * @notice The stakes of each user
     */
    mapping(address => Stake[]) public stakes;

    event Staked(address indexed user, uint256 amount, uint256 shares, uint256 startTimestamp, LockType lockType);

    event Withdrawn(address indexed user, uint256 amount, uint256 shares, uint256 startTimestamp, LockType lockType);

    event RewardAdded(uint256 reward);

    event EarlyWithdrawalFeePaid(uint256 amount);

    /**
     * @notice Constructor function to initialize the interfaces
     * @param _pulsefinityToken The address of the pulsefinity token
     * @param _rewardToken The address of the reward token
     * @param _stakingRouter The address of the staking router
     * @param _requiredTier The tier required to stake in this pool
     */
    constructor(address _pulsefinityToken, address _rewardToken, IStakingRouter _stakingRouter, Tier _requiredTier) {
        pulsefinityToken = IERC20(_pulsefinityToken);
        stakingRouter = _stakingRouter;

        requiredTier = _requiredTier;

        isNativeToken = _rewardToken == address(0);
        if (!isNativeToken) {
            rewardToken = IERC20(_rewardToken);
        }
    }

    /**
     * @notice Stake funciton
     * @param _amount The amount of tokens to stake
     * @param _lockType The lock type of the stake
     * @dev The tokens must be approved before calling this function
     */
    function stake(uint256 _amount, LockType _lockType) external {
        Tier predictedTier = stakingRouter.getPredictedTier(msg.sender, _amount, true);
        require(predictedTier >= requiredTier, "Insufficient tier");

        require(_amount > 0, "Cannot stake 0");
        require(_lockType >= LockType(0) && _lockType <= LockType(5), "Invalid lock type");

        pulsefinityToken.transferFrom(msg.sender, address(this), _amount);

        // Check if the tier of the user changes on this stake and update the stakersPerTier
        _checkTierChange(msg.sender, predictedTier);

        // Calculate the reward shares of the stake
        uint256 rewardBalance = isNativeToken ? address(this).balance : totalRewards;

        uint256 shares;

        if (totalShares == 0 || rewardBalance == 0) {
            shares = _multiplyByLock(_amount, _lockType);
        } else {
            uint256 what = _amount * totalShares / rewardBalance;
            shares += _multiplyByLock(what, _lockType);
        }

        // Update the total shares and total staked
        totalShares += shares;
        totalStaked += _amount;

        // Add the stake to the user's stakes
        stakes[msg.sender].push(Stake(_amount, shares, block.timestamp, _lockType));

        emit Staked(msg.sender, _amount, shares, block.timestamp, _lockType);
    }

    /**
     * @notice Withdraw a stake
     * @param stakeIndex The index of the stake to withdraw
     */
    function withdraw(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");

        Stake memory _stake = stakes[msg.sender][stakeIndex];

        // Check if the tier of the user changes on this stake and update the stakersPerTier
        Tier predictedTier = stakingRouter.getPredictedTier(msg.sender, _stake.amount, false);
        _checkTierChange(msg.sender, predictedTier);

        // Calculate the unlock timestamp of the stake
        uint256 unlockTimestamp = _getUnlockTimestamp(_stake.startTimestamp, _stake.lockType);

        uint256 rewardShares = _stake.rewardShares;

        // If the stake is unlocked, transfer the reward and original amount to the user
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
            // If the stake is locked, transfer the original amount to the user and the early withdrawal fee to the owner
            // while leaving the reward in the pool
            if ((unlockTimestamp - _stake.startTimestamp) / 2 > block.timestamp - _stake.startTimestamp) {
                uint256 earlyWithdrawalFee = _stake.amount * 10 / 100;
                pulsefinityToken.transfer(msg.sender, _stake.amount - earlyWithdrawalFee);
                pulsefinityToken.transfer(owner(), earlyWithdrawalFee);
                emit EarlyWithdrawalFeePaid(earlyWithdrawalFee);
            } else {
                pulsefinityToken.transfer(msg.sender, _stake.amount);
            }
        }

        // Update the total shares and total staked
        totalShares -= rewardShares;
        totalStaked -= _stake.amount;

        // Remove the stake from the user's stakes
        stakes[msg.sender][stakeIndex] = stakes[msg.sender][stakes[msg.sender].length - 1];
        stakes[msg.sender].pop();

        emit Withdrawn(msg.sender, _stake.amount, rewardShares, _stake.startTimestamp, _stake.lockType);
    }

    // View functions

    /**
     * @notice Get the array of user stakes
     * @param _user The address of the user
     */
    function getUserStakes(address _user) external view returns (Stake[] memory) {
        return stakes[_user];
    }

    /**
     * @notice Get the total value locked in the pool for a user
     * @param _wallet The address of the user
     */
    function getTotalValueLocked(address _wallet) external view override returns (uint256) {
        if (stakes[_wallet].length == 0) return 0;
        Stake[] memory _stakes = stakes[_wallet];

        uint256 totalValueLocked;

        for (uint256 i = 0; i < _stakes.length; i++) {
            totalValueLocked += _stakes[i].amount;
        }

        return totalValueLocked;
    }

    /**
     * @notice Get the reward token(in case of native token, returns address(0))
     */
    function getRewardToken() external view override returns (IERC20) {
        return rewardToken;
    }

    // Admin functions

    /**
     * @notice Add rewards to the pool
     * @param _amount The amount of tokens to add
     */
    function addRewards(uint256 _amount) external payable {
        if (!isNativeToken) {
            require(msg.value == 0, "Cannot add rewards with ETH");

            totalRewards += _amount;

            rewardToken.transferFrom(msg.sender, address(this), _amount);

            emit RewardAdded(_amount);
        } else {
            totalRewards += msg.value;

            emit RewardAdded(msg.value);
        }
    }

    /**
     * @notice Withdraw rewards surplus
     */
    function withdrawRewardSurplus() external onlyOwner {
        require(!isNativeToken, "Cannot withdraw rewards surplus with ETH");
        uint256 rewardsSurplus = rewardToken.balanceOf(address(this)) - totalRewards;
        if (address(pulsefinityToken) == address(rewardToken)) {
            rewardsSurplus -= totalStaked;
        }
        rewardToken.transfer(msg.sender, rewardsSurplus);
    }

    // Internal functions

    function _checkTierChange(address _user, Tier _predictedTier) internal {
        Tier currentTier = stakingRouter.getTier(_user);

        if (currentTier != _predictedTier) {
            stakingRouter.updateStakersPerTier(currentTier, false);
            stakingRouter.updateStakersPerTier(_predictedTier, true);
        }
    }

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
}
