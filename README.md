# Pulsefinity Launchpad and Staking Contracts

PulseFinity is a decentralized launchpad on Pulsechain network that allows users to launch their own token or create their own initial dex offering (IDO).

## [High Level Documentation](https://pulsefinity.gitbook.io/pulsefinity/)

## Smart Contract Documentation

# Solidity API

## PulsefinityLaunchpad

Launchpad contract for Pulsefinity PreSales and Fair Launches.

### OWNER_ROLE

```solidity
bytes32 OWNER_ROLE
```

### UPGRADER_ROLE

```solidity
bytes32 UPGRADER_ROLE
```

### ADMIN_ROLE

```solidity
bytes32 ADMIN_ROLE
```

### WINNER_FEE

```solidity
uint256 WINNER_FEE
```

### stakingRouter

```solidity
contract IStakingRouter stakingRouter
```

### pulseXRouter

```solidity
contract IPulseXRouter01 pulseXRouter
```

### pulseXFactory

```solidity
contract IPulseXFactory pulseXFactory
```

### vestingContract

```solidity
contract IVestingContract vestingContract
```

### SaleParams

```solidity
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
```

### SaleState

```solidity
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
```

### minimumLiqudityLockupTime

```solidity
uint256 minimumLiqudityLockupTime
```

### minimumLiquidityPercentage

```solidity
uint256 minimumLiquidityPercentage
```

### saleIdTracker

```solidity
struct CountersUpgradeable.Counter saleIdTracker
```

### tierWeights

```solidity
mapping(enum Tier => uint256) tierWeights
```

Mapping of Tier to weight

### sales

```solidity
mapping(uint256 => struct PulsefinityLaunchpad.SaleState) sales
```

Mapping of sale ID to SaleState struct

### isPaymentTokenSupported

```solidity
mapping(address => bool) isPaymentTokenSupported
```

Mapping of supported payment tokens(address(0) = PLS)

### feePool

```solidity
mapping(address => uint256) feePool
```

Mapping of token address to winner fee collected(address(0) = PLS)

### amountContributed

```solidity
mapping(address => mapping(uint256 => uint256)) amountContributed
```

Mapping of buyer address to sale ID to amount contributed

### SaleCreated

```solidity
event SaleCreated(address owner, uint256 saleId)
```

### SaleEnabled

```solidity
event SaleEnabled(uint256 saleId)
```

### SaleEnded

```solidity
event SaleEnded(uint256 saleId, bool softCapReached)
```

### ContributionMade

```solidity
event ContributionMade(address buyer, uint256 saleId, uint256 amount)
```

### TokensClaimed

```solidity
event TokensClaimed(address buyer, uint256 saleId, uint256 amount)
```

### TokensRefunded

```solidity
event TokensRefunded(address buyer, uint256 saleId, uint256 amount)
```

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(contract IStakingRouter _stakingRouter, contract IPulseXRouter01 _pulseXRouter, contract IPulseXFactory _pulseXFactory, contract IVestingContract _vestingContract) external
```

Initializes the contract

#### Parameters

| Name              | Type                      | Description                |
| ----------------- | ------------------------- | -------------------------- |
| \_stakingRouter   | contract IStakingRouter   |                            |
| \_pulseXRouter    | contract IPulseXRouter01  | The PulseXRouter contract  |
| \_pulseXFactory   | contract IPulseXFactory   | The PulseXFactory contract |
| \_vestingContract | contract IVestingContract |                            |

### createSale

```solidity
function createSale(struct PulsefinityLaunchpad.SaleParams _saleParams) external
```

Function called to create a new sale

_Tokens must be approved before calling this function_

#### Parameters

| Name         | Type                                   | Description                                                                                          |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| \_saleParams | struct PulsefinityLaunchpad.SaleParams | The SaleParams struct. Please see the documentation where the struct is defined for more information |

### contribute

```solidity
function contribute(uint256 _saleId, uint256 _amount) external payable
```

Function used by users to contribute to a sale

#### Parameters

| Name     | Type    | Description                         |
| -------- | ------- | ----------------------------------- |
| \_saleId | uint256 | The ID of the sale to contribute to |
| \_amount | uint256 |                                     |

### claim

```solidity
function claim(uint256 _saleId) external payable
```

Function used users to claim their tokens after the sale has ended

#### Parameters

| Name     | Type    | Description                             |
| -------- | ------- | --------------------------------------- |
| \_saleId | uint256 | The ID of the sale to claim tokens from |

### endSale

```solidity
function endSale(uint256 _saleId) public
```

Function called to end a sale

#### Parameters

| Name     | Type    | Description               |
| -------- | ------- | ------------------------- |
| \_saleId | uint256 | The ID of the sale to end |

### enableSale

```solidity
function enableSale(uint256 _saleId) external
```

Function used by admins to enable a sale

#### Parameters

| Name     | Type    | Description                  |
| -------- | ------- | ---------------------------- |
| \_saleId | uint256 | The ID of the sale to enable |

### setPaymentTokenState

```solidity
function setPaymentTokenState(address _token, bool _state) external
```

Function used by admins to add or remove a token from the supported payment tokens list

#### Parameters

| Name    | Type    | Description                                     |
| ------- | ------- | ----------------------------------------------- |
| \_token | address | The address of the token to set the state for   |
| \_state | bool    | True if the token is supported, false otherwise |

### withdrawFee

```solidity
function withdrawFee(address _token, uint256 _amount) external
```

Function used by the owner to withdraw tokens from the fee pool

#### Parameters

| Name     | Type    | Description                          |
| -------- | ------- | ------------------------------------ |
| \_token  | address |                                      |
| \_amount | uint256 | Amount to withdraw from the fee pool |

### getTierAllocation

```solidity
function getTierAllocation(uint256 _saleId, enum Tier _buyerTier) public view returns (uint256)
```

Function used to get the allocation for a tier in a sale

#### Parameters

| Name        | Type      | Description                                  |
| ----------- | --------- | -------------------------------------------- |
| \_saleId    | uint256   | The ID of the sale to get the allocation for |
| \_buyerTier | enum Tier | The tier of the buyer                        |

### receive

```solidity
receive() external payable
```

### \_authorizeUpgrade

```solidity
function _authorizeUpgrade(address newImplementation) internal
```

This function is used to upgrade the contract

#### Parameters

| Name              | Type    | Description                           |
| ----------------- | ------- | ------------------------------------- |
| newImplementation | address | The address of the new implementation |

## PulsefinityStakingRouter

### pulsefinityToken

```solidity
contract IERC20 pulsefinityToken
```

### stakingPools

```solidity
contract IStakingPool[] stakingPools
```

### TierLimits

```solidity
struct TierLimits {
  uint256 nano;
  uint256 micro;
  uint256 mega;
  uint256 giga;
  uint256 tera;
  uint256 teraPlus;
}
```

### tierLimits

```solidity
struct PulsefinityStakingRouter.TierLimits tierLimits
```

### stakersPerTier

```solidity
mapping(enum Tier => uint256) stakersPerTier
```

Mapping of tier to the number of stakers in that tier

### isStakingPool

```solidity
mapping(address => bool) isStakingPool
```

Mapping of address to staking pool status

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(contract IERC20 _pulsefinityToken, struct PulsefinityStakingRouter.TierLimits _tierLimits) external
```

Function to be called once on deployment

#### Parameters

| Name               | Type                                       | Description                          |
| ------------------ | ------------------------------------------ | ------------------------------------ |
| \_pulsefinityToken | contract IERC20                            | The address of the Pulsefinity token |
| \_tierLimits       | struct PulsefinityStakingRouter.TierLimits | The tier limits for each tier        |

### getTotalStaked

```solidity
function getTotalStaked(address _address) public view returns (uint256 totalStaked)
```

Returns the total amount staked by an address

#### Parameters

| Name      | Type    | Description          |
| --------- | ------- | -------------------- |
| \_address | address | The address to check |

### getTier

```solidity
function getTier(address _address) external view returns (enum Tier)
```

Returns the tier of an address

#### Parameters

| Name      | Type    | Description          |
| --------- | ------- | -------------------- |
| \_address | address | The address to check |

### getPredictedTier

```solidity
function getPredictedTier(address _address, uint256 _amount, bool _isDeposit) external view returns (enum Tier)
```

Returns the predicted tier of an address

#### Parameters

| Name        | Type    | Description                                                       |
| ----------- | ------- | ----------------------------------------------------------------- |
| \_address   | address | The address to check                                              |
| \_amount    | uint256 | The amount to add or remove from the addresses total staked       |
| \_isDeposit | bool    | Whether the amount is being added or false if it is being removed |

### getGlobalAmountStaked

```solidity
function getGlobalAmountStaked() external view returns (uint256 totalAmountStaked)
```

Returns the total amount staked across all staking pools

### getStakersPerTier

```solidity
function getStakersPerTier() external view returns (uint256[6] stakersPerTier_)
```

Returns an array of the number of stakers in each tier
[Nano, Micro, Mega, Giga, Tera, TeraPlus]

### getStakersForTier

```solidity
function getStakersForTier(enum Tier _tier) external view returns (uint256)
```

Returns the total stakers in a tier

#### Parameters

| Name   | Type      | Description       |
| ------ | --------- | ----------------- |
| \_tier | enum Tier | The tier to query |

### updateStakersPerTier

```solidity
function updateStakersPerTier(enum Tier _tier, bool _isAddition) external
```

Used by staking pools to update the number of stakers in a tier

#### Parameters

| Name         | Type      | Description                                                               |
| ------------ | --------- | ------------------------------------------------------------------------- |
| \_tier       | enum Tier | The tier to update                                                        |
| \_isAddition | bool      | If ture, increment the number of stakers in the tier, otherwise decrement |

### addStakingPool

```solidity
function addStakingPool(contract IStakingPool _stakingPool) external
```

Adds a staking pool to the staking router

#### Parameters

| Name          | Type                  | Description                            |
| ------------- | --------------------- | -------------------------------------- |
| \_stakingPool | contract IStakingPool | The address of the staking pool to add |

### removeStakingPool

```solidity
function removeStakingPool(uint256 _index) external
```

Removes a staking pool from the staking router

#### Parameters

| Name    | Type    | Description                             |
| ------- | ------- | --------------------------------------- |
| \_index | uint256 | The index of the staking pool to remove |

### setTiers

```solidity
function setTiers(struct PulsefinityStakingRouter.TierLimits _tierLimits) external
```

Sets the tier limits

#### Parameters

| Name         | Type                                       | Description                |
| ------------ | ------------------------------------------ | -------------------------- |
| \_tierLimits | struct PulsefinityStakingRouter.TierLimits | The new tier limits struct |

### \_amountToTier

```solidity
function _amountToTier(uint256 _amount) internal view returns (enum Tier)
```

### \_authorizeUpgrade

```solidity
function _authorizeUpgrade(address newImplementation) internal
```

This function is used to upgrade the contract

#### Parameters

| Name              | Type    | Description                           |
| ----------------- | ------- | ------------------------------------- |
| newImplementation | address | The address of the new implementation |

## IPulseXFactory

### getPair

```solidity
function getPair(address tokenA, address tokenB) external view returns (address pair)
```

## IPulseXRouter01

### factory

```solidity
function factory() external view returns (address)
```

### WPLS

```solidity
function WPLS() external view returns (address)
```

### addLiquidityETH

```solidity
function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
```

### addLiquidity

```solidity
function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)
```

## IStakingPool

### getTotalValueStaked

```solidity
function getTotalValueStaked(address _wallet) external view returns (uint256)
```

Get the total value locked in the pool for a user

#### Parameters

| Name     | Type    | Description             |
| -------- | ------- | ----------------------- |
| \_wallet | address | The address of the user |

### addRewards

```solidity
function addRewards(uint256 _amount) external payable
```

Add rewards to the pool

#### Parameters

| Name     | Type    | Description                 |
| -------- | ------- | --------------------------- |
| \_amount | uint256 | The amount of tokens to add |

### getRewardToken

```solidity
function getRewardToken() external view returns (contract IERC20)
```

Get the reward token(in case of native token, returns address(0))

## Tier

```solidity
enum Tier {
  Null,
  Nano,
  Micro,
  Mega,
  Giga,
  Tera,
  TeraPlus
}
```

## IStakingRouter

### getTier

```solidity
function getTier(address _address) external view returns (enum Tier)
```

Returns the tier of an address

#### Parameters

| Name      | Type    | Description          |
| --------- | ------- | -------------------- |
| \_address | address | The address to check |

### getPredictedTier

```solidity
function getPredictedTier(address _address, uint256 _amount, bool _isDeposit) external view returns (enum Tier)
```

Returns the predicted tier of an address

#### Parameters

| Name        | Type    | Description                                                       |
| ----------- | ------- | ----------------------------------------------------------------- |
| \_address   | address | The address to check                                              |
| \_amount    | uint256 | The amount to add or remove from the addresses total staked       |
| \_isDeposit | bool    | Whether the amount is being added or false if it is being removed |

### getStakersPerTier

```solidity
function getStakersPerTier() external view returns (uint256[6])
```

Returns an array of the number of stakers in each tier
[Nano, Micro, Mega, Giga, Tera, TeraPlus]

### getStakersForTier

```solidity
function getStakersForTier(enum Tier _tier) external view returns (uint256)
```

Returns the total stakers in a tier

#### Parameters

| Name   | Type      | Description       |
| ------ | --------- | ----------------- |
| \_tier | enum Tier | The tier to query |

### updateStakersPerTier

```solidity
function updateStakersPerTier(enum Tier _tier, bool _isAddition) external
```

Used by staking pools to update the number of stakers in a tier

#### Parameters

| Name         | Type      | Description                                                               |
| ------------ | --------- | ------------------------------------------------------------------------- |
| \_tier       | enum Tier | The tier to update                                                        |
| \_isAddition | bool      | If ture, increment the number of stakers in the tier, otherwise decrement |

## IVestingContract

### DurationUnits

```solidity
enum DurationUnits {
  Days,
  Weeks,
  Months
}
```

### VestingSchedule

```solidity
struct VestingSchedule {
  address beneficiary; // beneficiary of tokens after they are released
  uint256 start; // start time of the vesting period
  uint256 duration; // duration of the vesting period in DurationUnits
  enum IVestingContract.DurationUnits durationUnits; // units of the duration
  uint256 amountTotal; // total amount of tokens to be released at the end of the vesting;
  uint256 released; // amount of tokens released
}
```

### createVestingSchedule

```solidity
function createVestingSchedule(address _token, address _beneficiary, uint256 _start, uint256 _duration, enum IVestingContract.DurationUnits _durationUnits, uint256 _amountTotal) external
```

Creates a vesting schedule

_Approve the contract to transfer the tokens before calling this function_

#### Parameters

| Name            | Type                                | Description                                                |
| --------------- | ----------------------------------- | ---------------------------------------------------------- |
| \_token         | address                             | The token to be vested                                     |
| \_beneficiary   | address                             | The address of the beneficiary                             |
| \_start         | uint256                             | The start UNIX timestamp of the vesting period             |
| \_duration      | uint256                             | The duration of the vesting period in DurationUnits        |
| \_durationUnits | enum IVestingContract.DurationUnits | The units of the duration(0 = days, 1 = weeks, 2 = months) |
| \_amountTotal   | uint256                             | The total amount of tokens to be vested                    |

### release

```solidity
function release(address _token, address _beneficiary) external
```

Releases the vested tokens for a beneficiary

#### Parameters

| Name          | Type    | Description                    |
| ------------- | ------- | ------------------------------ |
| \_token       | address | The token to be released       |
| \_beneficiary | address | The address of the beneficiary |

### getReleaseableAmount

```solidity
function getReleaseableAmount(address _token, address _beneficiary) external view returns (uint256)
```

Returns the releasable amount of tokens for a beneficiary

#### Parameters

| Name          | Type    | Description                    |
| ------------- | ------- | ------------------------------ |
| \_token       | address | The token to query for         |
| \_beneficiary | address | The address of the beneficiary |

## MockERC20

### constructor

```solidity
constructor(string name, string symbol) public
```

### mint

```solidity
function mint(address to, uint256 amount) public
```

## MockPulseX

### factory\_

```solidity
address factory_
```

### WPLS\_

```solidity
address WPLS_
```

### pairs

```solidity
mapping(address => mapping(address => address)) pairs
```

### constructor

```solidity
constructor(address _WPLS) public
```

### addLiquidityETH

```solidity
function addLiquidityETH(address token, uint256 amountTokenDesired, uint256, uint256, address, uint256) external payable returns (uint256, uint256, uint256)
```

### addLiquidity

```solidity
function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256, uint256, address to, uint256) external returns (uint256, uint256, uint256)
```

### factory

```solidity
function factory() external view returns (address)
```

### WPLS

```solidity
function WPLS() external view returns (address)
```

### getPair

```solidity
function getPair(address _tokenA, address _tokenB) external view returns (address)
```

### \_createPair

```solidity
function _createPair(address tokenA, address tokenB) internal
```
