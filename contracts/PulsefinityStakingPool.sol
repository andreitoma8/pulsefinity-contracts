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
     * @notice The total amount of rewards token in the reward pool
     */
    uint256 public totalRewards;
    /**
     * @notice The total amount of tokens staked
     */
    uint256 public totalStaked;

    /**
     * @notice The total amount of shares
     */
    uint256 public totalShares;

    /**
     * @notice The index of the last reward added
     */
    uint256 public rewardIndex;

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
        uint256 shares;
        /**
         * @notice The index of the stake in the stakes array
         */
        uint256 rewardIndex;
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

    event Staked(address indexed user, uint256 amount, LockType lockType);

    event Withdrawn(address indexed user, uint256 amount, uint256 rewards);

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
        require(_amount > 0, "Cannot stake 0");

        Tier predictedTier = stakingRouter.getPredictedTier(msg.sender, _amount, true);
        require(predictedTier >= requiredTier, "Invalid tier");

        pulsefinityToken.transferFrom(msg.sender, address(this), _amount);

        // Check if the tier of the user changes on this stake and update the stakersPerTier
        _checkTierChange(msg.sender, predictedTier);

        uint256 shares = _multiplyByLock(_amount, _lockType);

        // Update the total staked and total shares
        totalStaked += _amount;
        totalShares += shares;

        // Add the stake to the user's stakes
        stakes[msg.sender].push(Stake(_amount, shares, rewardIndex, block.timestamp, _lockType));

        emit Staked(msg.sender, _amount, _lockType);
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
        uint256 rewardToTransfer;

        // If the stake is unlocked, transfer the reward and original amount to the user
        if (block.timestamp >= unlockTimestamp) {
            pulsefinityToken.transfer(msg.sender, _stake.amount);

            rewardToTransfer = _calculateRewards(_stake);
            if (isNativeToken) {
                (bool sc,) = payable(msg.sender).call{value: rewardToTransfer}("");
                require(sc, "Transfer failed");
            } else {
                rewardToken.transfer(msg.sender, rewardToTransfer);
            }
            totalRewards -= rewardToTransfer;
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

        // Update  total staked and total shares
        totalStaked -= _stake.amount;
        totalShares -= _stake.shares;

        // Remove the stake from the user's stakes
        stakes[msg.sender][stakeIndex] = stakes[msg.sender][stakes[msg.sender].length - 1];
        stakes[msg.sender].pop();

        emit Withdrawn(msg.sender, _stake.amount, rewardToTransfer);
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
        require(totalShares > 0, "Cannot add rewards when there are no stakes");
        if (!isNativeToken) {
            require(_amount > 0, "Cannot add 0 rewards");
            require(msg.value == 0, "Cannot add rewards with ETH");

            totalRewards += _amount;

            rewardToken.transferFrom(msg.sender, address(this), _amount);

            emit RewardAdded(_amount);
        } else {
            require(msg.value > 0, "Cannot add 0 rewards");
            totalRewards += msg.value;

            emit RewardAdded(msg.value);
        }
        rewardIndex += (isNativeToken ? msg.value : _amount) * 1e18 / totalShares;
    }

    /**
     * @notice Withdraw rewards surplus
     */
    function withdrawRewardSurplus() external onlyOwner {
        require(!isNativeToken, "Cannot withdraw rewards surplus with native token");
        uint256 rewardsSurplus = rewardToken.balanceOf(address(this)) - totalRewards;
        if (address(pulsefinityToken) == address(rewardToken)) {
            rewardsSurplus -= totalStaked;
        }
        require(rewardsSurplus > 0, "No rewards surplus to withdraw");
        rewardToken.transfer(msg.sender, rewardsSurplus);
    }

    // Internal functions

    function _calculateRewards(Stake memory _stake) private view returns (uint256) {
        return _stake.shares * (rewardIndex - _stake.rewardIndex) / 1e18;
    }

    function _checkTierChange(address _user, Tier _predictedTier) internal {
        Tier currentTier = stakingRouter.getTier(_user);

        if (currentTier != _predictedTier) {
            if (currentTier != Tier(0)) stakingRouter.updateStakersPerTier(currentTier, false);
            if (_predictedTier != Tier(0)) stakingRouter.updateStakersPerTier(_predictedTier, true);
        }
    }

    function _multiplyByLock(uint256 _amount, LockType _lockType) internal pure returns (uint256 newAmount) {
        newAmount = _amount;
        if (_lockType == LockType(0)) newAmount += _amount * 200 / 10000;
        else if (_lockType == LockType(1)) newAmount += _amount * 500 / 10000;
        else if (_lockType == LockType(2)) newAmount += _amount * 1200 / 10000;
        else if (_lockType == LockType(3)) newAmount += _amount * 1800 / 10000;
        else if (_lockType == LockType(4)) newAmount += _amount * 4000 / 10000;
        else newAmount += _amount;
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
