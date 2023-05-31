import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { BigNumber } from "ethers";
import { LockType, Tier, SaleParams, SaleState, DurationUnits } from "./helpers/interfaces";

import { PulsefinityLaunchpad, PulsefinityStakingPool, PulsefinityStakingRouter, VestingContract, MockERC20, MockPulseX } from "../typechain-types";

chai.use(chaiAsPromised);

describe("Scenarios", () => {
    let launchpad: PulsefinityLaunchpad;
    let stakingPool: PulsefinityStakingPool;
    let stakingRouter: PulsefinityStakingRouter;
    let vesting: VestingContract;

    let pulsefinity: MockERC20;
    let soldToken: MockERC20;
    let paymentToken: MockERC20;
    let rewardToken: MockERC20;

    let pulseX: MockPulseX;

    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let charlie: SignerWithAddress;
    let dave: SignerWithAddress;
    let eve: SignerWithAddress;
    let frank: SignerWithAddress;

    const toWei = (amount: string) => ethers.utils.parseEther(amount);

    const baseSaleParams: SaleParams = {
        token: ethers.constants.AddressZero,
        paymentToken: ethers.constants.AddressZero,
        owner: "",
        tokenAmount: toWei("100"),
        price: toWei("1.5"),
        softCap: toWei("20"),
        hardCap: toWei("50"),
        liquidityPercentage: 5000,
        listingPrice: toWei("2"),
        liquidityLockupTime: 365,
        startTimestamp: 0,
        endTimestamp: 0,
        refundType: true,
        isVestedSale: false,
        tgeUnlockPercentage: 0,
        vestingStart: 0,
        vestingDuration: 0,
        vestingDurationUnits: DurationUnits.Days,
    };

    const tierLimits = {
        nano: toWei("10"),
        micro: toWei("20"),
        mega: toWei("30"),
        giga: toWei("40"),
        tera: toWei("50"),
        teraPlus: toWei("60"),
    };

    const wplsAddress = "0x4c79b8c9cB0BD62B047880603a9DEcf36dE28344"; // random address

    const getTime = async () => {
        const block = await ethers.provider.getBlock("latest");
        return block.timestamp;
    };

    const increaseTime = async (seconds: number) => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };

    const stake = async (user: SignerWithAddress, amount: BigNumber) => {
        await pulsefinity.mint(user.address, amount);
        await pulsefinity.connect(user).approve(stakingPool.address, amount);
        await stakingPool.connect(user).stake(amount, LockType.Days15);
    };

    const createCustomSale = async (params: Partial<SaleParams>) => {
        let totalToken;
        let saleParams = { ...baseSaleParams, ...params };
        if (saleParams.price.eq(0)) {
            const soldTokenForLiquiditiy = saleParams.tokenAmount
                .sub(saleParams.tokenAmount.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams.liquidityPercentage)
                .div(10000);
            totalToken = saleParams.tokenAmount.add(soldTokenForLiquiditiy);
        } else {
            const totalTokenForSale = saleParams.hardCap.mul(saleParams.price).div(toWei("1"));
            const soldTokenForLiquiditiy = totalTokenForSale
                .sub(totalTokenForSale.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams.price);
            totalToken = totalTokenForSale.add(soldTokenForLiquiditiy);
        }
        await soldToken.mint(deployer.address, totalToken);
        await soldToken.approve(launchpad.address, totalToken);

        await launchpad.createSale(saleParams);

        return await launchpad.saleIdTracker();
    };

    before(async () => {
        [deployer, alice, bob, charlie, dave, eve, frank] = await ethers.getSigners();
    });

    beforeEach(async () => {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        pulsefinity = await MockERC20Factory.deploy("Pulsefinity", "PULSE");
        soldToken = await MockERC20Factory.deploy("Sold Token", "SOLD");
        paymentToken = await MockERC20Factory.deploy("Payment Token", "PAYMENT");
        rewardToken = await MockERC20Factory.deploy("Reward Token", "REWARD");

        const MockPulseXFactory = await ethers.getContractFactory("MockPulseX");
        pulseX = await MockPulseXFactory.deploy(wplsAddress);

        const StakingRouterFactory = await ethers.getContractFactory("PulsefinityStakingRouter");
        stakingRouter = (await upgrades.deployProxy(StakingRouterFactory, [pulsefinity.address, tierLimits], { kind: "uups" })) as PulsefinityStakingRouter;

        const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
        stakingPool = (await upgrades.deployProxy(PulsefinityStakingPoolFactory, [pulsefinity.address, rewardToken.address, stakingRouter.address, Tier.Nano], {
            kind: "uups",
        })) as PulsefinityStakingPool;

        await stakingRouter.addStakingPool(stakingPool.address);

        const VestingContractFactory = await ethers.getContractFactory("VestingContract");
        vesting = (await VestingContractFactory.deploy()) as VestingContract;

        const PulsefinityLaunchpadFactory = await ethers.getContractFactory("PulsefinityLaunchpad");
        launchpad = (await upgrades.deployProxy(PulsefinityLaunchpadFactory, [stakingRouter.address, pulseX.address, pulseX.address, vesting.address], {
            kind: "uups",
        })) as PulsefinityLaunchpad;

        await stake(alice, tierLimits.micro);
        await stake(bob, tierLimits.mega);
        await stake(charlie, tierLimits.giga);
    });

    describe("PreSale", () => {
        it("should correctly conduct a presale", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            const saleId = await createCustomSale(saleParams);
            const saleInfo = await launchpad.sales(saleId);
            const params = saleInfo.saleParams;

            console.log("Creating sale...");
            console.log("");

            console.log("Tokens for sale: ", ethers.utils.formatEther(saleInfo.totalTokensSold));
            console.log("Tokens for liquidity: ", ethers.utils.formatEther(saleInfo.totalTokensForLiquidity));
            console.log("");

            await launchpad.enableSale(saleId);

            console.log("Sale enabled");
            console.log("");

            await increaseTime(60);

            await launchpad.connect(alice).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Micro) });
            await launchpad.connect(bob).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Mega) });
            await launchpad.connect(charlie).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Giga) });

            console.log("Alice contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(alice.address, saleId)));
            console.log("Bob contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(bob.address, saleId)));
            console.log("Charlie contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(charlie.address, saleId)));
            console.log("");

            await increaseTime(3660);

            const balanceOwnerBefore = await ethers.provider.getBalance(deployer.address);
            const balanceSoldTokenOwnerBefore = await soldToken.balanceOf(deployer.address);

            await launchpad.connect(alice).endSale(saleId);

            console.log("Sale ended");
            console.log("");

            console.log("Tokens refunded to owner: ", ethers.utils.formatEther((await soldToken.balanceOf(deployer.address)).sub(balanceSoldTokenOwnerBefore)));

            console.log("Owner winnings: ", ethers.utils.formatEther((await ethers.provider.getBalance(deployer.address)).sub(balanceOwnerBefore)));
            console.log("Protocol fee: ", ethers.utils.formatEther(await launchpad.feePool(ethers.constants.AddressZero)));
            console.log("");

            console.log("ETH in Liquidity Pool: ", ethers.utils.formatEther(await ethers.provider.getBalance(pulseX.address)));
            console.log("Sold Token in Liquidity Pool: ", ethers.utils.formatEther(await soldToken.balanceOf(pulseX.address)));
            console.log("");

            await launchpad.connect(alice).claim(saleId);
            await launchpad.connect(bob).claim(saleId);
            await launchpad.connect(charlie).claim(saleId);

            console.log("Alice claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(alice.address)));
            console.log("Bob claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(bob.address)));
            console.log("Charlie claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(charlie.address)));
            console.log("");
        });
    });

    describe("FairLaunch", () => {
        it("should correctly conduct a fair launch", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                price: toWei("0"),
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            const saleId = await createCustomSale(saleParams);
            const saleInfo = await launchpad.sales(saleId);
            const params = saleInfo.saleParams;

            console.log("Creating sale...");
            console.log("");

            console.log("Tokens for sale: ", ethers.utils.formatEther(saleInfo.totalTokensSold));
            console.log("Tokens for liquidity: ", ethers.utils.formatEther(saleInfo.totalTokensForLiquidity));
            console.log("");

            await launchpad.enableSale(saleId);

            console.log("Sale enabled");
            console.log("");

            await increaseTime(60);

            await launchpad.connect(alice).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Micro) });
            await launchpad.connect(bob).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Mega) });
            await launchpad.connect(charlie).contribute(saleId, 0, { value: await launchpad.getTierAllocation(saleId, Tier.Giga) });

            console.log("Alice contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(alice.address, saleId)));
            console.log("Bob contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(bob.address, saleId)));
            console.log("Charlie contribution: ", ethers.utils.formatEther(await launchpad.amountContributed(charlie.address, saleId)));
            console.log("");

            await increaseTime(3660);

            const balanceOwnerBefore = await ethers.provider.getBalance(deployer.address);
            const balanceSoldTokenOwnerBefore = await soldToken.balanceOf(deployer.address);

            await launchpad.connect(alice).endSale(saleId);

            console.log("Sale ended");
            console.log("");

            console.log("Tokens refunded to owner: ", ethers.utils.formatEther((await soldToken.balanceOf(deployer.address)).sub(balanceSoldTokenOwnerBefore)));

            console.log("Owner winnings: ", ethers.utils.formatEther((await ethers.provider.getBalance(deployer.address)).sub(balanceOwnerBefore)));
            console.log("Protocol fee: ", ethers.utils.formatEther(await launchpad.feePool(ethers.constants.AddressZero)));
            console.log("");

            console.log("ETH in Liquidity Pool: ", ethers.utils.formatEther(await ethers.provider.getBalance(pulseX.address)));
            console.log("Sold Token in Liquidity Pool: ", ethers.utils.formatEther(await soldToken.balanceOf(pulseX.address)));
            console.log("");

            await launchpad.connect(alice).claim(saleId);
            console.log("Alice claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(alice.address)));

            await launchpad.connect(bob).claim(saleId);
            console.log("Bob claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(bob.address)));

            await launchpad.connect(charlie).claim(saleId);
            console.log("Charlie claimable: ", ethers.utils.formatEther(await soldToken.balanceOf(charlie.address)));
        });
    });
});
