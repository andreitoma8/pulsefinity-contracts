// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "./interfaces/IPulseXRouter01.sol";
import "./interfaces/IPulseXFactory.sol";
import "./interfaces/IVestingContract.sol";
import "./interfaces/IStakingRouter.sol";

/**
 * TODO:
 * - add checks for buyer tier and contribution limits
 * - add support for ERC20 tokens as payment - done
 * - unit tests for all contracts -
 * - integration tests -
 * - code refactor -
 * - gas optimizations -
 */

/**
 * @title PulsefinityLaunchpad
 * @author andreitoma8
 * @notice Launchpad contract for Pulsefinity presales and fair launches
 */
contract PulsefinityLaunchpad is AccessControlUpgradeable {
    using CountersUpgradeable for CountersUpgradeable.Counter;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant WINNER_FEE = 2000; // 20% in BPS

    IStakingRouter public stakingRouter;
    IPulseXRouter01 public pulseRouter;
    IPulseXFactory public pulseFactory;
    IVestingContract public vestingContract;

    struct SaleParams {
        IERC20Metadata token; // The token being sold
        IERC20Metadata paymentToken; // The token used to buy the sale token(address(0) = PLS)
        address owner; // The owner of the sale
        uint256 tokenAmount; // The amount of tokens being sold
        uint256 price; // How many tokens per 1 payment token (if 0, then it's a fair launch)
        uint256 softCap; // in Payment Tokens
        uint256 hardCap; // must be double of softCap
        uint256 liquidityPercentage; // BPS
        uint256 listingPrice; // How many tokens per 1 payment token
        uint256 liquidityLockupTime; // in days
        uint256 startTimestamp; // Unix timestamp
        uint256 endTimestamp; // Unix timestamp
        bool refundType; // true = refund, false = burn
        bool isVestedSale; // true if tokens are locked up at claim
        uint256 tgeUnlockPercentage; // BPS
        uint256 vestingStart; // Unix timestamp - if < block.timestamp, then vesting starts at token claim
        uint256 vestingDuration; // in DurationUnits
        IVestingContract.DurationUnits vestingDurationUnits; // days, weeks, months
    }

    struct SaleState {
        bool saleEnabled; // true if sale is enabled and accepting contributions
        bool softCapReached; // true if soft cap is reached
        bool saleEnded; // true if sale is ended
        uint256 totalPaymentTokenContributed; // total PLS/payment token contributed
        uint256 liquidityUnlockTimestamp; // Unix timestamp
        SaleParams saleParams; // SaleParams struct
    }

    uint256 public minimumLiqudityLockupTime; // in days
    uint256 public minimumLiquidityPercentage; // BPS
    uint256 public feePool; // total fees collected

    CountersUpgradeable.Counter private _saleIdTracker;

    /**
     * @notice Mapping of Tier to weight
     */
    mapping(Tier => uint256) public tierWeights;

    /**
     * @notice Mapping of sale ID to SaleState struct
     */
    mapping(uint256 => SaleState) public sales;

    /**
     * @notice Mapping of supported payment tokens(address(0) = PLS)
     */
    mapping(address => bool) public supportedPaymentTokens;

    /**
     * @notice Mapping of buyer address to sale ID to amount contributed
     */
    mapping(address => mapping(uint256 => uint256)) public amountContributed;

    /**
     * @notice Mapping of sale ID to Tier to amount contributed
     */
    mapping(uint256 => mapping(Tier => uint256)) public amountContributedPerTier;

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract, setting msg.sender as admin and setting the PulseXRouter and PulseXFactory contracts
     * @param _pulseXRouter The PulseXRouter contract
     * @param _pulseXFactory The PulseXFactory contract
     */
    function initialize(IStakingRouter _stakingRouter, IPulseXRouter01 _pulseXRouter, IPulseXFactory _pulseXFactory)
        external
        initializer
    {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);

        stakingRouter = _stakingRouter;
        pulseRouter = _pulseXRouter;
        pulseFactory = _pulseXFactory;

        supportedPaymentTokens[address(0)] = true;
    }

    /**
     * @notice Function called to create a new sale
     * @param _saleParams The SaleParams struct. Please see the documentation where the struct is defined for more information
     * @dev Tokens must be approved before calling this function
     */
    function createSale(SaleParams calldata _saleParams) external {
        // Check if the sale params are valid
        _checkSaleParams(_saleParams);

        // Create the sale ID
        _saleIdTracker.increment();
        uint256 saleId = _saleIdTracker.current();

        // Create the sale
        sales[saleId].saleParams = _saleParams;

        // compute the tokens needed for the sale and LP creation
        uint256 totalTokensForSale;
        uint256 tokensForLiquidity;
        if (_saleParams.price == 0) {
            totalTokensForSale = _saleParams.tokenAmount;
            sales[saleId].saleParams.hardCap = type(uint256).max;
            tokensForLiquidity = (_saleParams.tokenAmount - _saleParams.tokenAmount * WINNER_FEE / 10000)
                * _saleParams.liquidityPercentage / 10000;
        } else {
            totalTokensForSale = _saleParams.hardCap * _saleParams.price / 1e18;
            tokensForLiquidity = (_saleParams.hardCap - _saleParams.hardCap * WINNER_FEE / 10000)
                * _saleParams.listingPrice * _saleParams.liquidityPercentage / 10000 / 1e18;
        }

        // Transfer the tokens to the contract
        _saleParams.token.transferFrom(msg.sender, address(this), totalTokensForSale + tokensForLiquidity);
    }

    /**
     * @notice Function used by users to contribute to a sale
     * @param _saleId The ID of the sale to contribute to
     */
    function contribute(uint256 _saleId, uint256 _amount) external payable {
        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        if (address(saleParams.paymentToken) != address(0)) {
            // Transfer the payment token to the contract
            saleParams.paymentToken.transferFrom(msg.sender, address(this), _amount);
        } else {
            _amount = msg.value;
        }
        // Check if the sale is enabled and accepting contributions
        require(sale.saleEnabled, "Sale is not enabled");
        require(block.timestamp >= saleParams.startTimestamp, "Sale has not started yet");
        require(block.timestamp <= saleParams.endTimestamp, "Sale has ended");
        require(sale.totalPaymentTokenContributed < saleParams.hardCap, "Sale has ended");

        // TODO: add checks for buyer tier and contribution limits
        Tier buyerTier = stakingRouter.getTier(msg.sender);
        if (saleParams.price == 0) {
            require(buyerTier > Tier.Null, "Buyer tier is too low");
        } else {
            uint256 tierAllocation = getTierAllocation(_saleId, buyerTier);
            require(amountContributed[msg.sender][_saleId] + _amount <= tierAllocation, "Allocation exceeded");
        }

        // Update contribution and total contribution amounts
        amountContributed[msg.sender][_saleId] += _amount;
        sale.totalPaymentTokenContributed += _amount;

        // Check if the soft cap is reached
        if (sale.totalPaymentTokenContributed >= saleParams.softCap) {
            sale.softCapReached = true;
        }

        // Check if the hard cap is reached
        // For fair launches, the hard cap is 2^256 - 1, so this check will always fail
        if (sale.totalPaymentTokenContributed >= saleParams.hardCap) {
            // Refund the user if they contributed more than the hard cap
            if (sale.totalPaymentTokenContributed > saleParams.hardCap) {
                uint256 refundAmount = sale.totalPaymentTokenContributed - saleParams.hardCap;

                sale.totalPaymentTokenContributed -= refundAmount;
                amountContributed[msg.sender][_saleId] -= refundAmount;

                if (address(saleParams.paymentToken) != address(0)) {
                    saleParams.paymentToken.transfer(msg.sender, refundAmount);
                } else {
                    (bool sc,) = payable(msg.sender).call{value: refundAmount}("");
                    require(sc, "Transfer failed");
                }
            }
        }
    }

    /**
     * @notice Function used by admins to end a sale
     * @param _saleId The ID of the sale to claim tokens from
     */
    function claim(uint256 _saleId) external payable {
        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        // Check if the sale is ended
        require(sales[_saleId].saleEnded, "Sale has not ended");

        // Check if the user has contributed to this sale
        require(amountContributed[msg.sender][_saleId] > 0, "Nothing to claim");

        // Check if the soft cap is reached, send the tokens to the user/vesting contract
        if (sale.softCapReached) {
            uint256 tokensBought;
            // If the sale is a fair launch, calculate the amount of tokens bought using
            //  the amount contributed and the total tokens available for the sale
            if (saleParams.price == 0) {
                tokensBought =
                    amountContributed[msg.sender][_saleId] * saleParams.tokenAmount / sale.totalPaymentTokenContributed;
            } else {
                // If the sale is a presale, calculate the amount of tokens bought using
                // the amount contributed and the price
                tokensBought = amountContributed[msg.sender][_saleId] * saleParams.price / 1e18;
            }
            // Reset the amount contributed
            amountContributed[msg.sender][_saleId] = 0;
            // If the sale is a vested sale, create a vesting schedule for the user
            if (saleParams.isVestedSale) {
                // approve the vesting contract to spend the tokens
                saleParams.token.approve(address(vestingContract), tokensBought);
                // if the vesting schedule includes a TGE unlock, send the tokens to the user
                if (saleParams.tgeUnlockPercentage > 0) {
                    uint256 tgeTokens = tokensBought * saleParams.tgeUnlockPercentage / 10000;
                    saleParams.token.transfer(msg.sender, tgeTokens);
                    tokensBought -= tgeTokens;
                }
                // create the vesting schedule
                vestingContract.createVestingSchedule(
                    address(saleParams.token),
                    msg.sender,
                    saleParams.vestingStart < block.timestamp ? block.timestamp : saleParams.vestingStart,
                    saleParams.vestingDuration,
                    saleParams.vestingDurationUnits,
                    tokensBought
                );
            } else {
                // If the sale is not a vested sale, send the tokens to the user
                saleParams.token.transfer(msg.sender, tokensBought);
            }
        } else {
            // If the soft cap is not reached, refund the user their contribution
            uint256 paymentTokenContributed = amountContributed[msg.sender][_saleId];
            amountContributed[msg.sender][_saleId] = 0;
            if (address(saleParams.paymentToken) != address(0)) {
                saleParams.paymentToken.transfer(msg.sender, paymentTokenContributed);
            } else {
                (bool sc,) = payable(msg.sender).call{value: paymentTokenContributed}("");
                require(sc, "Transfer failed");
            }
        }
    }

    /**
     * @notice Function called to end a sale
     * @param _saleId The ID of the sale to end
     */
    function endSale(uint256 _saleId) public {
        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        // Check if the sale is not already ended
        require(!sale.saleEnded, "Sale has already ended");

        // Check if the sale has reached the end timestamp or the hard cap
        if (block.timestamp < saleParams.endTimestamp) {
            require(sale.totalPaymentTokenContributed == saleParams.hardCap, "Sale has not reached hard cap");
        } else {
            require(block.timestamp >= saleParams.endTimestamp, "Sale has not ended yet");
        }

        // Mark the sale as ended
        sale.saleEnded = true;

        // If the soft cap is reached, substract the winner fee, create and lock LP tokens and send the rest to the owner
        if (sale.softCapReached) {
            // Calculate the winner fee and the amount raised after the fee
            uint256 winnerFee = sale.totalPaymentTokenContributed * WINNER_FEE / 10000;
            feePool += winnerFee;
            uint256 raisedAfterFee = sale.totalPaymentTokenContributed - winnerFee;

            // Calculate the amount of PLS/payment tokens and sold tokens to add liquidity with
            uint256 paymentTokenForLiquidity = raisedAfterFee * saleParams.liquidityPercentage / 10000;
            uint256 tokensForLiquidity;
            if (saleParams.price != 0) {
                // If the sale is a presale, calculate the amount of tokens to add liquidity
                // with using the listing price
                tokensForLiquidity = paymentTokenForLiquidity * saleParams.listingPrice / 1e18;
            } else {
                // If the sale is a fair launch, calculate the amount of tokens to add liquidity
                // with using the total tokens available for the sale
                tokensForLiquidity = paymentTokenForLiquidity * saleParams.tokenAmount / raisedAfterFee;
            }

            // Approve and add liquidity to the pool on PulseX
            saleParams.token.approve(address(pulseRouter), tokensForLiquidity);
            if (address(saleParams.paymentToken) != address(0)) {
                saleParams.paymentToken.approve(address(pulseRouter), paymentTokenForLiquidity);
                pulseRouter.addLiquidity(
                    address(saleParams.token),
                    address(saleParams.paymentToken),
                    tokensForLiquidity,
                    paymentTokenForLiquidity,
                    tokensForLiquidity,
                    paymentTokenForLiquidity,
                    address(this),
                    block.timestamp + 1 days
                );
            } else {
                pulseRouter.addLiquidityETH{value: paymentTokenForLiquidity}(
                    address(saleParams.token),
                    tokensForLiquidity,
                    tokensForLiquidity,
                    paymentTokenForLiquidity,
                    address(this),
                    block.timestamp + 1 days
                );
            }

            // Lock the liquidity tokens and create a vesting schedule for the owner
            sale.liquidityUnlockTimestamp = block.timestamp + saleParams.liquidityLockupTime * 1 days;
            address liquidityPool = IPulseXFactory(pulseRouter.factory()).getPair(
                address(saleParams.token),
                address(saleParams.paymentToken) == address(0) ? pulseRouter.WPLS() : address(saleParams.paymentToken)
            );
            uint256 liquidity = IERC20(liquidityPool).balanceOf(address(this));
            vestingContract.createVestingSchedule(
                liquidityPool,
                saleParams.owner,
                saleParams.liquidityLockupTime,
                0,
                IVestingContract.DurationUnits.Days,
                liquidity
            );

            // If the sale is a presale and the hard cap is not reached
            if (saleParams.price > 0 && saleParams.hardCap != sale.totalPaymentTokenContributed) {
                // Calculate the amount of tokens to refund from unslod tokens
                uint256 totalTokensBought = sale.totalPaymentTokenContributed * saleParams.price / 1e18;
                uint256 refundAmount = saleParams.hardCap * saleParams.price / 1e18 - totalTokensBought;
                // Calculate the amount of tokens to refund from unused tokens for liquidity
                uint256 totalDepositForLiquidity =
                    saleParams.hardCap * saleParams.listingPrice * saleParams.liquidityPercentage / 10000 / 1e18;
                uint256 refundForLiquidity = totalDepositForLiquidity - tokensForLiquidity;
                refundAmount += refundForLiquidity;
                // If the refund amount is greater than 0, refund the owner or burn the tokens(if refundType is false)
                if (refundAmount > 0) {
                    saleParams.token.transfer(saleParams.refundType ? saleParams.owner : address(0), refundAmount);
                }
            }
            // Send the raised funds to the owner
            uint256 fundsToSend = raisedAfterFee - paymentTokenForLiquidity;

            (bool sc,) = payable(saleParams.owner).call{value: fundsToSend}("");
            require(sc, "Transfer failed");
        } else {
            // If the soft cap is not reached, refund the owner their tokens
            uint256 refundAmount;
            uint256 tokensForLiquidity;
            if (saleParams.price == 0) {
                refundAmount = saleParams.tokenAmount;
                tokensForLiquidity = (saleParams.hardCap - saleParams.hardCap * WINNER_FEE / 10000)
                    * saleParams.liquidityPercentage / 10000;
            } else {
                refundAmount = saleParams.hardCap * saleParams.price / 1e18;
                tokensForLiquidity = (saleParams.hardCap - saleParams.hardCap * WINNER_FEE / 10000)
                    * saleParams.listingPrice * saleParams.liquidityPercentage / 10000 / 1e18;
            }
            refundAmount += tokensForLiquidity;
            // Transfer the tokens to the owner or burn them(if refundType is false)
            saleParams.token.transfer(saleParams.owner, refundAmount);
        }
    }

    /**
     * @notice Function used by admins to enable a sale
     * @param _saleId The ID of the sale to enable
     */
    function enableSale(uint256 _saleId) external onlyRole(ADMIN_ROLE) {
        sales[_saleId].saleEnabled = true;
    }

    /**
     * @notice Function used by admins to add or remove a token from the supported payment tokens list
     * @param _token The address of the token to set the state for
     * @param _state True if the token is supported, false otherwise
     */
    function setPaymentTokenState(address _token, bool _state) external onlyRole(ADMIN_ROLE) {
        supportedPaymentTokens[_token] = _state;
    }

    /**
     * @notice Function used by the owner to withdraw tokens from the fee pool
     * @param _amount Amount to withdraw from the fee pool
     */
    function withdrawFee(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amount <= feePool, "Not enough balance");
        feePool -= _amount;
        (bool sc,) = payable(msg.sender).call{value: _amount}("");
        require(sc, "Transfer failed");
    }

    /**
     * @notice Function used to get the allocation for a tier in a sale
     * @param _saleId The ID of the sale to get the allocation for
     * @param _buyerTier The tier of the buyer
     */
    function getTierAllocation(uint256 _saleId, Tier _buyerTier) public view returns (uint256) {
        uint256[6] memory stakersPerTier = stakingRouter.getStakersPerTier();
        uint256 totalAllocationShares;
        for (uint256 i = 0; i < stakersPerTier.length; i++) {
            totalAllocationShares += stakersPerTier[i] * tierWeights[_buyerTier];
        }
        return sales[_saleId].saleParams.hardCap * tierWeights[_buyerTier] / totalAllocationShares;
    }

    /**
     * @notice Function used to check the sale parameters on creation
     * @param _saleParams The sale parameters to check
     */
    function _checkSaleParams(SaleParams memory _saleParams) private view {
        require(_saleParams.token != IERC20(address(0)), "Token cannot be 0 address");
        if (address(_saleParams.paymentToken) != address(0)) {
            require(supportedPaymentTokens[address(_saleParams.paymentToken)], "Payment token not supported");
        }
        require(_saleParams.owner != address(0), "Owner cannot be 0 address");
        require(_saleParams.softCap > 0, "Soft cap must be greater than 0");
        require(_saleParams.hardCap > 0, "Hard cap must be greater than 0");
        require(_saleParams.liquidityPercentage >= minimumLiquidityPercentage, "Liquidity percentage too low");
        require(_saleParams.liquidityPercentage <= 10000, "Liquidity percentage must be less than or equal to 10000");
        if (_saleParams.price > 0) {
            require(_saleParams.listingPrice > 0, "Listing price must be greater than 0");
        }
        if (_saleParams.price == 0) {
            require(_saleParams.tokenAmount > 0, "Token amount must be greater than 0");
        }
        require(_saleParams.liquidityLockupTime > minimumLiqudityLockupTime, "Liquidity lockup time too low");
        require(_saleParams.startTimestamp > block.timestamp, "Start timestamp must be in the future");
        require(_saleParams.endTimestamp > _saleParams.startTimestamp, "End timestamp must be after start timestamp");
    }
}
