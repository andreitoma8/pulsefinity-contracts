import { BigNumber } from "ethers";

export enum LockType {
    Days15,
    Days30,
    Days60,
    Days90,
    Days180,
    Days360,
}

export enum Tier {
    Null,
    Nano,
    Micro,
    Mega,
    Giga,
    Tera,
    TeraPlus,
}

export enum DurationUnits {
    Days,
    Weeks,
    Months,
}

export interface SaleParams {
    token: string; // The token being sold
    paymentToken: string; // The token used to buy the sale token(address(0) = PLS)
    owner: string; // The owner of the sale
    tokenAmount: BigNumber; // The amount of tokens being sold
    price: BigNumber; // How many tokens per 1 payment token (if 0, then it's a fair launch)
    softCap: BigNumber; // in Payment Tokens
    hardCap: BigNumber; // must be double of softCap
    liquidityPercentage: number; // BPS
    listingPrice: BigNumber; // How many tokens per 1 payment token
    liquidityLockupTime: number; // in days
    startTimestamp: number; // Unix timestamp
    endTimestamp: number; // Unix timestamp
    refundType: boolean; // true = refund, false = burn
    isVestedSale: boolean; // true if tokens are locked up at claim
    tgeUnlockPercentage: number; // BPS
    vestingStart: number; // Unix timestamp - if < block.timestamp, then vesting starts at token claim
    vestingDuration: number; // in DurationUnits
    vestingDurationUnits: DurationUnits; // 0 = days, 1 = weeks, 2 = months
}

export interface SaleState {
    saleEnabled: boolean; // true if sale is enabled and accepting contributions
    softCapReached: boolean; // true if soft cap is reached
    saleEnded: boolean; // true if sale is ended
    totalPaymentTokenContributed: BigNumber; // total PLS/payment token contributed
    liquidityUnlockTimestamp: number; // Unix timestamp
    saleParams: SaleParams; // SaleParams struct
}
