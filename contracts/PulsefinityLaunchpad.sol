// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IPulseXRouter01.sol";
import "./interfaces/IPulseXFactory.sol";
import "./interfaces/IVestingContract.sol";
import "./interfaces/IStakingRouter.sol";

/**
 * @title PulsefinityLaunchpad
 * @author andreitoma8
 * @notice Launchpad contract for Pulsefinity presales and fair launches
 */
contract PulsefinityLaunchpad is AccessControlUpgradeable, UUPSUpgradeable {
    using CountersUpgradeable for CountersUpgradeable.Counter;

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant WINNER_FEE = 2000; // 20% in BPS

    IStakingRouter public stakingRouter;
    IPulseXRouter01 public pulseXRouter;
    IPulseXFactory public pulseXFactory;
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
        uint256 totalTokensSold; // total tokens to be sold
        uint256 totalTokensForLiquidity; // total tokens to be added to liquidity
        uint256 liquidityUnlockTimestamp; // Unix timestamp
        SaleParams saleParams; // SaleParams struct
    }

    uint256 public minimumLiqudityLockupTime; // in days
    uint256 public minimumLiquidityPercentage; // BPS

    CountersUpgradeable.Counter public saleIdTracker;

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
    mapping(address => bool) public isPaymentTokenSupported;

    /**
     * @notice Mapping of token address to winner fee collected(address(0) = PLS)
     */
    mapping(address => uint256) public feePool;

    /**
     * @notice Mapping of buyer address to sale ID to amount contributed
     */
    mapping(address => mapping(uint256 => uint256)) public amountContributed;

    event SaleCreated(address indexed owner, uint256 indexed saleId);

    event SaleEnabled(uint256 indexed saleId);

    event SaleEnded(uint256 indexed saleId, bool softCapReached);

    event ContributionMade(address indexed buyer, uint256 indexed saleId, uint256 amount);

    event TokensClaimed(address indexed buyer, uint256 indexed saleId, uint256 amount);

    event TokensRefunded(address indexed buyer, uint256 indexed saleId, uint256 amount);

    /**
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     * @param _pulseXRouter The PulseXRouter contract
     * @param _pulseXFactory The PulseXFactory contract
     */
    function initialize(
        IStakingRouter _stakingRouter,
        IPulseXRouter01 _pulseXRouter,
        IPulseXFactory _pulseXFactory,
        IVestingContract _vestingContract
    ) external initializer {
        // Set deployer as owner, upgrader and admin
        _setupRole(OWNER_ROLE, msg.sender);
        _setupRole(UPGRADER_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        // Set OWNER_ROLE as admin for ADMIN_ROLE and UPGRADER_ROLE
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, OWNER_ROLE);

        // Set the contract addresses
        stakingRouter = _stakingRouter;
        pulseXRouter = _pulseXRouter;
        pulseXFactory = _pulseXFactory;
        vestingContract = _vestingContract;

        // Set the native token as supported payment token
        isPaymentTokenSupported[address(0)] = true;

        // Set the minimum liquidity lockup time and minimum liquidity percentage
        minimumLiqudityLockupTime = 60;
        minimumLiquidityPercentage = 5000;

        // Set the tier weights
        tierWeights[Tier.Nano] = 1;
        tierWeights[Tier.Micro] = 2;
        tierWeights[Tier.Mega] = 4;
        tierWeights[Tier.Giga] = 8;
        tierWeights[Tier.Tera] = 16;
        tierWeights[Tier.TeraPlus] = 16;
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
        saleIdTracker.increment();
        uint256 saleId = saleIdTracker.current();

        // Create the sale
        sales[saleId].saleParams = _saleParams;

        // compute the tokens needed for the sale and LP creation
        uint256 totalTokensForSale =
            _saleParams.price == 0 ? _saleParams.tokenAmount : _saleParams.hardCap * _saleParams.price / 1e18;
        sales[saleId].totalTokensSold = totalTokensForSale;
        uint256 tokensForLiquidity =
            (totalTokensForSale - (totalTokensForSale * WINNER_FEE / 10000)) * _saleParams.liquidityPercentage / 10000;
        sales[saleId].totalTokensForLiquidity = tokensForLiquidity;

        // Transfer the tokens to the contract
        _saleParams.token.transferFrom(msg.sender, address(this), totalTokensForSale + tokensForLiquidity);

        emit SaleCreated(msg.sender, saleId);
    }

    /**
     * @notice Function used by users to contribute to a sale
     * @param _saleId The ID of the sale to contribute to
     */
    function contribute(uint256 _saleId, uint256 _amount) external payable {
        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        // Check if the sale is enabled and accepting contributions
        require(sale.saleEnabled, "Sale is not enabled");
        require(block.timestamp >= saleParams.startTimestamp, "Sale has not started yet");
        require(block.timestamp <= saleParams.endTimestamp, "Sale has ended");

        if (address(saleParams.paymentToken) != address(0)) {
            // Transfer the payment token to the contract
            saleParams.paymentToken.transferFrom(msg.sender, address(this), _amount);
        } else {
            _amount = msg.value;
        }
        require(_amount > 0, "Amount must be greater than 0");

        Tier buyerTier = stakingRouter.getTier(msg.sender);
        if (saleParams.price == 0) {
            require(buyerTier > Tier.Null, "Buyer has no stake");
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

        emit ContributionMade(msg.sender, _saleId, _amount);
    }

    /**
     * @notice Function used users to claim their tokens after the sale has ended
     * @param _saleId The ID of the sale to claim tokens from
     */
    function claim(uint256 _saleId) external payable {
        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        // Check if the sale is ended
        require(sales[_saleId].saleEnded, "Sale has not ended");

        uint256 contributed = amountContributed[msg.sender][_saleId];
        amountContributed[msg.sender][_saleId] = 0;

        // Check if the user has contributed to this sale
        require(contributed > 0, "Nothing to claim");

        // Check if the soft cap is reached, send the tokens to the user/vesting contract
        if (sale.softCapReached) {
            uint256 tokensBought;
            // If the sale is a fair launch, calculate the amount of tokens bought using
            //  the amount contributed and the total tokens available for the sale
            if (saleParams.price == 0) {
                tokensBought = contributed * saleParams.tokenAmount / sale.totalPaymentTokenContributed;
            } else {
                // If the sale is a presale, calculate the amount of tokens bought using
                // the amount contributed and the price
                tokensBought = contributed * saleParams.price / 1e18;
            }
            // If the sale is a vested sale, create a vesting schedule for the user
            if (saleParams.isVestedSale) {
                // if the vesting schedule includes a TGE unlock, send the tokens to the user
                if (saleParams.tgeUnlockPercentage > 0) {
                    uint256 tgeTokens = tokensBought * saleParams.tgeUnlockPercentage / 10000;
                    saleParams.token.transfer(msg.sender, tgeTokens);
                    tokensBought -= tgeTokens;
                }
                // approve the vesting contract to spend the tokens
                saleParams.token.approve(address(vestingContract), tokensBought);
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

            emit TokensClaimed(msg.sender, _saleId, tokensBought);
        } else {
            // If the soft cap is not reached, refund the user their contribution
            if (address(saleParams.paymentToken) != address(0)) {
                saleParams.paymentToken.transfer(msg.sender, contributed);
            } else {
                (bool sc,) = payable(msg.sender).call{value: contributed}("");
                require(sc, "Transfer failed");
            }

            emit TokensRefunded(msg.sender, _saleId, contributed);
        }
    }

    /**
     * @notice Function called to end a sale
     * @param _saleId The ID of the sale to end
     */
    function endSale(uint256 _saleId) public {
        require(_saleId > 0 && _saleId <= saleIdTracker.current(), "Sale does not exist");

        SaleState storage sale = sales[_saleId];
        SaleParams memory saleParams = sale.saleParams;

        // Check if the sale has reached the end timestamp
        require(block.timestamp >= saleParams.endTimestamp, "Sale has not ended yet");

        // Check if the sale is not already ended
        require(!sale.saleEnded, "Sale has already ended");

        // Mark the sale as ended
        sale.saleEnded = true;

        // If the soft cap is reached, substract the winner fee, create and lock LP tokens and send the rest to the owner
        if (sale.softCapReached) {
            // Calculate the winner fee and the amount raised after the fee
            uint256 winnerFee = sale.totalPaymentTokenContributed * WINNER_FEE / 10000;
            feePool[address(saleParams.paymentToken)] += winnerFee;
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
            saleParams.token.approve(address(pulseXRouter), tokensForLiquidity);
            if (address(saleParams.paymentToken) != address(0)) {
                saleParams.paymentToken.approve(address(pulseXRouter), paymentTokenForLiquidity);
                pulseXRouter.addLiquidity(
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
                pulseXRouter.addLiquidityETH{value: paymentTokenForLiquidity}(
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
            address liquidityPool = IPulseXFactory(pulseXRouter.factory()).getPair(
                address(saleParams.token),
                address(saleParams.paymentToken) == address(0) ? pulseXRouter.WPLS() : address(saleParams.paymentToken)
            );
            uint256 liquidity = IERC20(liquidityPool).balanceOf(address(this));
            IERC20(liquidityPool).approve(address(vestingContract), liquidity);
            vestingContract.createVestingSchedule(
                liquidityPool,
                saleParams.owner,
                block.timestamp,
                saleParams.liquidityLockupTime,
                IVestingContract.DurationUnits.Days,
                liquidity
            );

            // If the sale is a presale and the hard cap is not reached
            if (saleParams.price > 0 && saleParams.hardCap != sale.totalPaymentTokenContributed) {
                // Calculate the amount of tokens to refund from unslod tokens
                uint256 totalTokensBought = sale.totalPaymentTokenContributed * saleParams.price / 1e18;
                uint256 refundAmount = sale.totalTokensSold - totalTokensBought;
                // Calculate the amount of tokens to refund from unused tokens for liquidity
                uint256 refundForLiquidity = sale.totalTokensForLiquidity - tokensForLiquidity;
                refundAmount += refundForLiquidity;
                // If the refund amount is greater than 0, refund the owner or burn the tokens(if refundType is false,
                // sending to address 0xdead for burn in case the token is not burnable or does not allow transfers to 0x0)
                if (refundAmount > 0) {
                    saleParams.token.transfer(
                        saleParams.refundType ? saleParams.owner : address(0x000000000000000000000000000000000000dEaD),
                        refundAmount
                    );
                }
            }
            // Send the raised funds to the owner
            uint256 fundsToSend = raisedAfterFee - paymentTokenForLiquidity;

            if (address(saleParams.paymentToken) != address(0)) {
                saleParams.paymentToken.transfer(saleParams.owner, fundsToSend);
            } else {
                (bool sc,) = payable(saleParams.owner).call{value: fundsToSend}("");
                require(sc, "Transfer failed");
            }
        } else {
            // If the soft cap is not reached, refund the owner their tokens
            // and the contributors will be able to withdraw their funds with claim()
            // Transfer the tokens to the owner or burn them(if refundType is false)
            saleParams.token.transfer(saleParams.owner, sale.totalTokensSold + sale.totalTokensForLiquidity);
        }

        emit SaleEnded(_saleId, sale.softCapReached);
    }

    /**
     * @notice Function used by admins to enable a sale
     * @param _saleId The ID of the sale to enable
     */
    function enableSale(uint256 _saleId) external onlyRole(ADMIN_ROLE) {
        require(!sales[_saleId].saleEnabled, "Sale already enabled");
        require(_saleId <= saleIdTracker.current(), "Invalid sale ID");
        sales[_saleId].saleEnabled = true;

        emit SaleEnabled(_saleId);
    }

    /**
     * @notice Function used by admins to add or remove a token from the supported payment tokens list
     * @param _token The address of the token to set the state for
     * @param _state True if the token is supported, false otherwise
     */
    function setPaymentTokenState(address _token, bool _state) external onlyRole(ADMIN_ROLE) {
        isPaymentTokenSupported[_token] = _state;
    }

    /**
     * @notice Function used by the owner to withdraw tokens from the fee pool
     * @param _amount Amount to withdraw from the fee pool
     */
    function withdrawFee(address _token, uint256 _amount) external onlyRole(OWNER_ROLE) {
        require(_amount <= feePool[_token], "Amount exceeds fee pool balance");
        feePool[_token] -= _amount;
        if (_token != address(0)) {
            IERC20(_token).transfer(msg.sender, _amount);
        } else {
            (bool sc,) = payable(msg.sender).call{value: _amount}("");
            require(sc, "Transfer failed");
        }
    }

    /**
     * @notice Function used to get the allocation for a tier in a sale
     * @param _saleId The ID of the sale to get the allocation for
     * @param _buyerTier The tier of the buyer
     */
    function getTierAllocation(uint256 _saleId, Tier _buyerTier) public view returns (uint256) {
        if (_buyerTier == Tier.Null || stakingRouter.getStakersForTier(_buyerTier) == 0) {
            return 0;
        }
        uint256[6] memory stakersPerTier = stakingRouter.getStakersPerTier();
        uint256 totalAllocationShares;
        for (uint256 i = 0; i < stakersPerTier.length; i++) {
            totalAllocationShares += stakersPerTier[i] * tierWeights[Tier(i + 1)];
        }
        return sales[_saleId].saleParams.hardCap * tierWeights[_buyerTier] / totalAllocationShares;
    }

    /**
     * @notice Function used to check the sale parameters on creation
     * @param _saleParams The sale parameters to check
     */
    function _checkSaleParams(SaleParams memory _saleParams) private view {
        require(_saleParams.token != IERC20(address(0)), "Token cannot be address 0");
        require(isPaymentTokenSupported[address(_saleParams.paymentToken)], "Payment token not supported");
        require(_saleParams.owner != address(0), "Owner cannot be address 0");
        require(_saleParams.softCap > 0, "Soft cap must be greater than 0");
        require(_saleParams.liquidityPercentage >= minimumLiquidityPercentage, "Liquidity percentage too low");
        require(_saleParams.liquidityPercentage <= 10000, "Liquidity percentage must be less than or equal to 10000");
        if (_saleParams.price > 0) {
            require(_saleParams.listingPrice > 0, "Listing price must be greater than 0");
            require(_saleParams.hardCap >= _saleParams.softCap * 2, "Hard cap must be at least double the soft cap");
        }
        if (_saleParams.price == 0) {
            require(_saleParams.tokenAmount > 0, "Token amount must be greater than 0");
        }
        require(_saleParams.liquidityLockupTime > minimumLiqudityLockupTime, "Liquidity lockup time too low");
        require(_saleParams.startTimestamp > block.timestamp, "Start timestamp must be in the future");
        require(_saleParams.endTimestamp > _saleParams.startTimestamp, "End timestamp must be after start timestamp");
    }

    /**
     * @notice This function is used to upgrade the contract
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}
