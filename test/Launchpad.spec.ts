import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { BigNumber } from "ethers";
import { LockType, Tier, SaleParams, SaleState, DurationUnits } from "./helpers/interfaces";

import { PulsefinityLaunchpad, PulsefinityStakingPool, PulsefinityStakingRouter, VestingContract, MockERC20, MockPulseX } from "../typechain-types";

chai.use(chaiAsPromised);

describe("Launchpad", () => {
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
        refundType: false,
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
    });

    describe("initialize", () => {
        it("should not allow to initialize twice", async () => {
            await expect(launchpad.initialize(stakingRouter.address, pulseX.address, pulseX.address, vesting.address)).to.be.revertedWith(
                "Initializable: contract is already initialized"
            );
        });

        it("should correctly initialize the contract", async () => {
            expect(await launchpad.stakingRouter()).to.equal(stakingRouter.address);
            expect(await launchpad.pulseXRouter()).to.equal(pulseX.address);
            expect(await launchpad.pulseXFactory()).to.equal(pulseX.address);

            expect(await launchpad.isPaymentTokenSupported(ethers.constants.AddressZero)).to.equal(true);

            expect(await launchpad.hasRole(await launchpad.OWNER_ROLE(), deployer.address)).to.equal(true);
            expect(await launchpad.hasRole(await launchpad.ADMIN_ROLE(), deployer.address)).to.equal(true);
            expect(await launchpad.getRoleAdmin(await launchpad.ADMIN_ROLE())).to.equal(await launchpad.OWNER_ROLE());
        });
    });

    describe("upgradeTo", () => {
        it("should revert if not owner", async () => {
            await expect(launchpad.connect(alice).upgradeTo(wplsAddress)).to.be.reverted;
        });
    });

    describe("createSale", () => {
        it("should revert if sold token is zero address", async () => {
            const saleParamsOverride = { owner: deployer.address, token: ethers.constants.AddressZero };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Token cannot be address 0");
        });

        it("should revert if payment token is not supported", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, paymentToken: rewardToken.address };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Payment token not supported");
        });

        it("should revert if owner is address 0", async () => {
            const saleParamsOverride = { owner: ethers.constants.AddressZero, token: soldToken.address };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Owner cannot be address 0");
        });

        it("should revert if softCap is 0", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, softCap: toWei("0") };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Soft cap must be greater than 0");
        });

        it("should rever if liquidity percentage is lower than minimum", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, liquidityPercentage: 1000 };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Liquidity percentage too low");
        });

        it("should revert if liquidity percentage is higher than maximum", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, liquidityPercentage: 10001 };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Liquidity percentage must be less than or equal to 10000");
        });

        it("should revert if liquidity lockup time is lower than minimum", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, liquidityLockupTime: 30 };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Liquidity lockup time too low");
        });

        it("should revert if start time is in the past", async () => {
            const saleParamsOverride = { owner: deployer.address, token: soldToken.address, startTimestamp: (await getTime()) - 60 };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Start timestamp must be in the future");
        });

        it("should revert if end time is lower than start time", async () => {
            const saleParamsOverride = {
                owner: deployer.address,
                token: soldToken.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) - 60,
            };
            const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

            await expect(launchpad.createSale(saleParams)).to.be.revertedWith("End timestamp must be after start timestamp");
        });

        describe("fair launch", () => {
            it("should revert if token amount is 0", async () => {
                const saleParamsOverride = {
                    owner: deployer.address,
                    token: soldToken.address,
                    tokenAmount: toWei("0"),
                    price: toWei("0"),
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3600,
                };
                const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

                await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Token amount must be greater than 0");
            });

            it("should correctly create a fair launch sale", async () => {
                const soldTokenAmount = toWei("100");
                const soldTokenForLiquiditiy = soldTokenAmount
                    .sub(soldTokenAmount.mul(await launchpad.WINNER_FEE()).div(10000))
                    .mul(5000)
                    .div(10000);

                const saleParams = {
                    token: soldToken.address,
                    owner: deployer.address,
                    tokenAmount: soldTokenAmount,
                    price: toWei("0"),
                    hardCap: toWei("0"),
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3660,
                };

                await createCustomSale(saleParams);

                expect(await soldToken.balanceOf(launchpad.address)).to.eq(soldTokenAmount.add(soldTokenForLiquiditiy));

                const saleState = await launchpad.sales(await launchpad.saleIdTracker());
                expect(saleState.saleEnabled).to.eq(false);
            });
        });

        describe("presale", () => {
            it("should revert if listing price is 0", async () => {
                const saleParamsOverride = {
                    token: soldToken.address,
                    owner: deployer.address,
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3600,
                    listingPrice: toWei("0"),
                };
                const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

                await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Listing price must be greater than 0");
            });

            it("should revert if hardcap is not double the softcap", async () => {
                const saleParamsOverride = {
                    token: soldToken.address,
                    owner: deployer.address,
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3600,
                    hardCap: toWei("30"),
                };
                const saleParams: SaleParams = { ...baseSaleParams, ...saleParamsOverride };

                await expect(launchpad.createSale(saleParams)).to.be.revertedWith("Hard cap must be at least double the soft cap");
            });

            it("should correctly create a presale", async () => {
                const saleParams = {
                    token: soldToken.address,
                    owner: deployer.address,
                    price: toWei("1"),
                    hardCap: toWei("50"),
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3660,
                };

                await createCustomSale(saleParams);

                const saleState = await launchpad.sales(await launchpad.saleIdTracker());
                expect(saleState.saleParams.hardCap).to.eq(toWei("50"));
                expect(saleState.saleEnabled).to.eq(false);

                const listingPrice = (await launchpad.sales(1)).saleParams.listingPrice;

                const soldTokenAmount = saleParams.hardCap.mul(saleParams.price).div(toWei("1"));
                const soldTokenForLiquiditiy = soldTokenAmount
                    .sub(soldTokenAmount.mul(await launchpad.WINNER_FEE()).div(10000))
                    .mul(5000)
                    .mul(toWei("1"))
                    .div(10000)
                    .div(listingPrice);

                expect(await soldToken.balanceOf(launchpad.address)).to.eq(soldTokenAmount.add(soldTokenForLiquiditiy));
            });
        });
    });

    describe("enableSale", () => {
        beforeEach(async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                price: toWei("1"),
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);
        });

        it("should rever if sale is not created", async () => {
            await expect(launchpad.enableSale(2)).to.be.revertedWith("Invalid sale ID");
        });

        it("should revert if sale is already enabled", async () => {
            await launchpad.enableSale(1);
            await expect(launchpad.enableSale(1)).to.be.revertedWith("Sale already enabled");
        });

        it("should revert if caller does not have admin role", async () => {
            await expect(launchpad.connect(alice).enableSale(1)).to.be.reverted;
        });

        it("should correctly enable a sale", async () => {
            await launchpad.enableSale(1);

            const saleState = await launchpad.sales(1);
            expect(saleState.saleEnabled).to.eq(true);
        });
    });

    describe("setPaymentTokenState", () => {
        it("should revert if caller does not have admin role", async () => {
            await expect(launchpad.connect(alice).setPaymentTokenState(ethers.constants.AddressZero, true)).to.be.reverted;
        });

        it("should correctly set payment token state", async () => {
            expect(await launchpad.isPaymentTokenSupported(paymentToken.address)).to.eq(false);
            await launchpad.setPaymentTokenState(paymentToken.address, true);
            expect(await launchpad.isPaymentTokenSupported(paymentToken.address)).to.eq(true);
            await launchpad.setPaymentTokenState(paymentToken.address, false);
            expect(await launchpad.isPaymentTokenSupported(paymentToken.address)).to.eq(false);
        });
    });

    describe("getTierAllocation", () => {
        beforeEach(async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await stake(alice, tierLimits.nano);
            await stake(bob, tierLimits.micro);
            await stake(charlie, tierLimits.mega);
            await stake(dave, tierLimits.giga);
            await stake(eve, tierLimits.tera);
            await stake(frank, tierLimits.teraPlus);

            await createCustomSale(saleParams);
        });

        it("should return 0 if no stakers in tier", async () => {
            await stakingPool.connect(alice).withdraw(0);

            expect(await launchpad.getTierAllocation(1, Tier.Nano)).to.eq(0);
        });

        it("should return correct allocation", async () => {
            const saleParams = (await launchpad.sales(1)).saleParams;
            const stakersPerTier = await stakingRouter.getStakersPerTier();

            const nanoAllocation = await launchpad.getTierAllocation(1, Tier.Nano);
            const microAllocation = await launchpad.getTierAllocation(1, Tier.Micro);
            const megaAllocation = await launchpad.getTierAllocation(1, Tier.Mega);
            const gigaAllocation = await launchpad.getTierAllocation(1, Tier.Giga);
            const teraAllocation = await launchpad.getTierAllocation(1, Tier.Tera);
            const teraPlusAllocation = await launchpad.getTierAllocation(1, Tier.TeraPlus);

            expect(
                nanoAllocation
                    .mul(stakersPerTier[0])
                    .add(microAllocation.mul(stakersPerTier[1]))
                    .add(megaAllocation.mul(stakersPerTier[2]))
                    .add(gigaAllocation.mul(stakersPerTier[3]))
                    .add(teraAllocation.mul(stakersPerTier[4]))
                    .add(teraPlusAllocation.mul(stakersPerTier[5]))
            ).to.be.closeTo(saleParams.hardCap, toWei("0.0001"));

            const nanoWeight = await launchpad.tierWeights(Tier.Nano);
            const microWeight = await launchpad.tierWeights(Tier.Micro);
            const megaWeight = await launchpad.tierWeights(Tier.Mega);
            const gigaWeight = await launchpad.tierWeights(Tier.Giga);
            const teraWeight = await launchpad.tierWeights(Tier.Tera);
            const teraPlusWeight = await launchpad.tierWeights(Tier.TeraPlus);
            const totalWeight = nanoWeight
                .mul(stakersPerTier[0])
                .add(microWeight.mul(stakersPerTier[1]))
                .add(megaWeight.mul(stakersPerTier[2]))
                .add(gigaWeight.mul(stakersPerTier[3]))
                .add(teraWeight.mul(stakersPerTier[4]))
                .add(teraPlusWeight.mul(stakersPerTier[5]));

            if (stakersPerTier[0].gt(0)) {
                const expectedNanoAllocation = saleParams.hardCap.mul(nanoWeight).div(totalWeight);
                expect(nanoAllocation).to.be.closeTo(expectedNanoAllocation, toWei("0.0001"));
            }

            if (stakersPerTier[1].gt(0)) {
                const expectedMicroAllocation = saleParams.hardCap.mul(microWeight).div(totalWeight);
                expect(microAllocation).to.be.closeTo(expectedMicroAllocation, toWei("0.0001"));
            }

            if (stakersPerTier[2].gt(0)) {
                const expectedMegaAllocation = saleParams.hardCap.mul(megaWeight).div(totalWeight);
                expect(megaAllocation).to.be.closeTo(expectedMegaAllocation, toWei("0.0001"));
            }

            if (stakersPerTier[3].gt(0)) {
                const expectedGigaAllocation = saleParams.hardCap.mul(gigaWeight).div(totalWeight);
                expect(gigaAllocation).to.be.closeTo(expectedGigaAllocation, toWei("0.0001"));
            }

            if (stakersPerTier[4].gt(0)) {
                const expectedTeraAllocation = saleParams.hardCap.mul(teraWeight).div(totalWeight);
                expect(teraAllocation).to.be.closeTo(expectedTeraAllocation, toWei("0.0001"));
            }

            if (stakersPerTier[5].gt(0)) {
                const expectedTeraPlusAllocation = saleParams.hardCap.mul(teraPlusWeight).div(totalWeight);
                expect(teraPlusAllocation).to.be.closeTo(expectedTeraPlusAllocation, toWei("0.0001"));
            }
        });
    });

    describe("contribute", () => {
        const contributionAmount = toWei("1");

        beforeEach(async () => {
            await stake(alice, tierLimits.nano);
            await stake(bob, tierLimits.micro);
            await stake(charlie, tierLimits.mega);

            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);

            await launchpad.setPaymentTokenState(paymentToken.address, true);
        });

        it("should revert if sale is not enabled", async () => {
            await expect(launchpad.connect(alice).contribute(1, toWei("1"))).to.be.revertedWith("Sale is not enabled");
        });

        it("should revert if has not started", async () => {
            await launchpad.enableSale(1);
            await expect(launchpad.connect(alice).contribute(1, toWei("1"))).to.be.revertedWith("Sale has not started yet");
        });

        it("should revert if has ended", async () => {
            await launchpad.enableSale(1);
            await increaseTime(3661);
            await expect(launchpad.connect(alice).contribute(1, toWei("1"))).to.be.revertedWith("Sale has ended");
        });

        it("should revert if amount is zero for native token", async () => {
            await launchpad.enableSale(1);
            await increaseTime(61);
            await expect(launchpad.connect(alice).contribute(1, 0)).to.be.revertedWith("Amount must be greater than 0");
        });

        it("should revert if amount is zero for ERC20 token", async () => {
            const saleParams = {
                token: soldToken.address,
                paymentToken: paymentToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);
            await increaseTime(61);
            await expect(launchpad.connect(alice).contribute(2, 0)).to.be.revertedWith("Amount must be greater than 0");
        });

        it("should revert for fairlaunch if user has no stake", async () => {
            const saleParams = {
                token: soldToken.address,
                paymentToken: ethers.constants.AddressZero,
                owner: deployer.address,
                price: toWei("0"),
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);
            await increaseTime(61);
            await expect(launchpad.connect(deployer).contribute(2, 0, { value: contributionAmount })).to.be.revertedWith("Buyer has no stake");
        });

        it("should rever for presale if user has no stake", async () => {
            await launchpad.enableSale(1);
            await increaseTime(61);
            await expect(launchpad.connect(dave).contribute(1, 0, { value: contributionAmount })).to.be.revertedWith("Allocation exceeded");
        });

        it("should revert if allocation exceeded", async () => {
            await launchpad.enableSale(1);
            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(alice.address));
            await expect(launchpad.connect(alice).contribute(1, 0, { value: aliceAllocation.add(1) })).to.be.revertedWith("Allocation exceeded");

            const bobAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(1, 0, { value: bobAllocation.div(2) });
            await expect(launchpad.connect(bob).contribute(1, 0, { value: bobAllocation.div(2).add(1) })).to.be.revertedWith("Allocation exceeded");

            const charlieAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(charlie.address));
            await launchpad.connect(charlie).contribute(1, 0, { value: charlieAllocation });
            await expect(launchpad.connect(charlie).contribute(1, 0, { value: charlieAllocation.add(1) })).to.be.revertedWith("Allocation exceeded");
        });

        it("should correctly contribute", async () => {
            await launchpad.enableSale(1);
            await increaseTime(61);

            await expect(launchpad.connect(alice).contribute(1, 0, { value: contributionAmount }))
                .to.changeEtherBalance(launchpad, contributionAmount)
                .to.emit(launchpad, "ContributionMade")
                .withArgs(alice.address, 1, contributionAmount);

            expect(await launchpad.amountContributed(alice.address, 1)).to.eq(contributionAmount);

            let saleState = await launchpad.sales(1);
            expect(saleState.totalPaymentTokenContributed).to.eq(contributionAmount);

            const bobAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(1, 0, { value: bobAllocation.div(2) });

            const charlieAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(charlie.address));
            await launchpad.connect(charlie).contribute(1, 0, { value: charlieAllocation });

            saleState = await launchpad.sales(1);
            expect(saleState.totalPaymentTokenContributed).to.eq(contributionAmount.add(bobAllocation.div(2)).add(charlieAllocation));
            expect(saleState.softCapReached).to.eq(true);
        });
    });

    describe("endSale", () => {
        beforeEach(async () => {
            await stake(alice, tierLimits.nano);
            await stake(bob, tierLimits.micro);
            await stake(charlie, tierLimits.mega);

            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);

            await launchpad.setPaymentTokenState(paymentToken.address, true);

            await launchpad.enableSale(1);

            await increaseTime(61);
        });

        it("should revert if param saleId is invalid", async () => {
            await expect(launchpad.endSale(0)).to.be.revertedWith("Sale does not exist");
            await expect(launchpad.endSale(2)).to.be.revertedWith("Sale does not exist");
        });

        it("should revert if the sale end timestamp has not been reached", async () => {
            await expect(launchpad.connect(deployer).endSale(1)).to.be.revertedWith("Sale has not ended yet");
        });

        it("should revert if sale has already ended", async () => {
            await increaseTime(3600);
            await launchpad.connect(deployer).endSale(1);
            await expect(launchpad.connect(deployer).endSale(1)).to.be.revertedWith("Sale has already ended");
        });

        it("should correctly end sale for presale with soft cap not reached", async () => {
            await launchpad.connect(alice).contribute(1, 0, { value: toWei("1") });

            const amountToRefund = await soldToken.balanceOf(launchpad.address);

            await increaseTime(3600);
            await expect(launchpad.connect(deployer).endSale(1))
                .to.emit(launchpad, "SaleEnded")
                .withArgs(1, false)
                .to.changeTokenBalance(soldToken, deployer, amountToRefund);

            const saleState = await launchpad.sales(1);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(false);
        });

        it("should correctly end sale for presale with soft cap reached with refund type burn", async () => {
            const aliceAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(alice.address));
            await launchpad.connect(alice).contribute(1, 0, { value: aliceAllocation });

            const bobAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(1, 0, { value: bobAllocation });

            const saleParams = (await launchpad.sales(1)).saleParams;

            const balanceOwnerBefore = await ethers.provider.getBalance(saleParams.owner);

            await increaseTime(3600);
            await launchpad.connect(alice).endSale(1);

            const liquidityToken = await pulseX.getPair(saleParams.token, wplsAddress);
            const liquidityVestingSchedule = (await vesting.getVestingSchedules(liquidityToken, deployer.address))[0];
            expect(liquidityVestingSchedule.amountTotal).to.be.eq(toWei("1"));
            expect(liquidityVestingSchedule.duration).to.eq(saleParams.liquidityLockupTime);
            expect(liquidityVestingSchedule.durationUnits).to.eq(DurationUnits.Days);

            const saleState = await launchpad.sales(1);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(true);

            const availableSoldTokens = saleParams.hardCap.mul(saleParams.price).div(toWei("1"));
            const availableTokensForLiquidity = saleParams.hardCap
                .sub(saleParams.hardCap.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams.listingPrice);

            const actualSoldTokens = aliceAllocation.add(bobAllocation).mul(saleParams.price).div(toWei("1"));
            const totalRaised = aliceAllocation.add(bobAllocation);

            const actualTokensForLiquidity = totalRaised
                .sub(totalRaised.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams.listingPrice);

            const tokensToRefund = availableSoldTokens.add(availableTokensForLiquidity).sub(actualSoldTokens).sub(actualTokensForLiquidity);
            expect(await soldToken.balanceOf("0x000000000000000000000000000000000000dEaD")).to.be.closeTo(tokensToRefund, 100);

            const winnerFee = totalRaised.mul(await launchpad.WINNER_FEE()).div(10000);
            expect(await ethers.provider.getBalance(launchpad.address)).to.be.closeTo(winnerFee, 100);

            const amountForLiquidity = totalRaised.sub(winnerFee).mul(saleParams.liquidityPercentage).div(10000);
            expect(await ethers.provider.getBalance(pulseX.address)).to.be.closeTo(amountForLiquidity, 100);

            const amountForOwner = aliceAllocation.add(bobAllocation).sub(winnerFee).sub(amountForLiquidity);

            expect(await ethers.provider.getBalance(saleParams.owner)).to.be.closeTo(balanceOwnerBefore.add(amountForOwner), 100);
        });

        it("should correctly end sale for presale with soft cap reached with refund type refund", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(alice.address));
            await launchpad.connect(alice).contribute(2, 0, { value: aliceAllocation });

            const bobAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(2, 0, { value: bobAllocation });

            const saleParams2 = (await launchpad.sales(2)).saleParams;

            const balanceOwnerBefore = await soldToken.balanceOf(saleParams2.owner);

            await increaseTime(3600);
            await launchpad.connect(deployer).endSale(2);

            const saleState = await launchpad.sales(2);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(true);

            const availableSoldTokens = saleParams2.hardCap.mul(saleParams2.price).div(toWei("1"));
            const availableTokensForLiquidity = saleParams2.hardCap
                .sub(saleParams2.hardCap.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams2.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams2.listingPrice);

            const actualSoldTokens = aliceAllocation.add(bobAllocation).mul(saleParams2.price).div(toWei("1"));
            const totalRaised = aliceAllocation.add(bobAllocation);

            const actualTokensForLiquidity = totalRaised
                .sub(totalRaised.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams2.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams2.listingPrice);

            const tokensToRefund = availableSoldTokens.add(availableTokensForLiquidity).sub(actualSoldTokens).sub(actualTokensForLiquidity);
            expect((await soldToken.balanceOf(deployer.address)).sub(balanceOwnerBefore)).to.be.closeTo(tokensToRefund, 100);
        });

        it("should correctly end sale for presale with soft cap reached with erc20 payment token", async () => {
            const saleParams = {
                token: soldToken.address,
                paymentToken: paymentToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(alice.address));
            await paymentToken.mint(alice.address, aliceAllocation);
            await paymentToken.connect(alice).approve(launchpad.address, aliceAllocation);
            await launchpad.connect(alice).contribute(2, aliceAllocation);

            const bobAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(bob.address));
            await paymentToken.mint(bob.address, bobAllocation);
            await paymentToken.connect(bob).approve(launchpad.address, bobAllocation);
            await launchpad.connect(bob).contribute(2, bobAllocation);

            const saleParams2 = (await launchpad.sales(2)).saleParams;

            await increaseTime(3600);

            const balanceOwnerBefore = await soldToken.balanceOf(saleParams2.owner);

            await launchpad.connect(deployer).endSale(2);

            const saleState = await launchpad.sales(2);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(true);

            const availableSoldTokens = saleParams2.hardCap.mul(saleParams2.price).div(toWei("1"));
            const availableTokensForLiquidity = saleParams2.hardCap
                .sub(saleParams2.hardCap.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams2.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams2.listingPrice);

            const actualSoldTokens = aliceAllocation.add(bobAllocation).mul(saleParams2.price).div(toWei("1"));
            const totalRaised = aliceAllocation.add(bobAllocation);

            const actualTokensForLiquidity = totalRaised
                .sub(totalRaised.mul(await launchpad.WINNER_FEE()).div(10000))
                .mul(saleParams2.liquidityPercentage)
                .mul(toWei("1"))
                .div(10000)
                .div(saleParams2.listingPrice);

            const tokensToRefund = availableSoldTokens.add(availableTokensForLiquidity).sub(actualSoldTokens).sub(actualTokensForLiquidity);
            expect((await soldToken.balanceOf(deployer.address)).sub(balanceOwnerBefore)).to.be.closeTo(tokensToRefund, 100);

            const amountRaised = aliceAllocation.add(bobAllocation);

            const winnerFee = amountRaised.mul(await launchpad.WINNER_FEE()).div(10000);
            expect(await paymentToken.balanceOf(launchpad.address)).to.be.closeTo(winnerFee, 100);

            const amountForLiquidity = amountRaised.sub(winnerFee).mul(saleParams2.liquidityPercentage).div(10000);
            expect(await paymentToken.balanceOf(pulseX.address)).to.be.closeTo(amountForLiquidity, 100);

            const amountForOwner = amountRaised.sub(winnerFee).sub(amountForLiquidity);
            expect(await paymentToken.balanceOf(saleParams2.owner)).to.be.closeTo(amountForOwner, 100);
        });

        it("should correctly end sale for fairlaunch with soft cap reached", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                price: toWei("0"),
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(alice.address));
            await launchpad.connect(alice).contribute(2, 0, { value: aliceAllocation });

            const bobAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(2, 0, { value: bobAllocation });

            const saleParams2 = (await launchpad.sales(2)).saleParams;

            const balanceOwnerBefore = await ethers.provider.getBalance(saleParams2.owner);

            await increaseTime(3600);
            await launchpad.connect(dave).endSale(2);

            const saleState = await launchpad.sales(2);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(true);

            const amountRaised = aliceAllocation.add(bobAllocation);

            const winnerFee = amountRaised.mul(await launchpad.WINNER_FEE()).div(10000);
            expect(await ethers.provider.getBalance(launchpad.address)).to.be.closeTo(winnerFee, 100);

            const amountForLiquidity = amountRaised.sub(winnerFee).mul(saleParams2.liquidityPercentage).div(10000);
            expect(await ethers.provider.getBalance(pulseX.address)).to.be.closeTo(amountForLiquidity, 100);

            const amountForOwner = amountRaised.sub(winnerFee).sub(amountForLiquidity);
            expect(await ethers.provider.getBalance(saleParams2.owner)).to.be.closeTo(balanceOwnerBefore.add(amountForOwner), 100);
        });

        it("should correctly end sale for fairlaunch with soft cap not reached", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                price: toWei("0"),
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            const balanceBefore = await soldToken.balanceOf(launchpad.address);

            await createCustomSale(saleParams);

            const amountToRefund = (await soldToken.balanceOf(launchpad.address)).sub(balanceBefore);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(alice.address));
            await launchpad.connect(alice).contribute(2, 0, { value: aliceAllocation });

            await increaseTime(3600);
            await expect(launchpad.endSale(2))
                .to.emit(launchpad, "SaleEnded")
                .withArgs(2, false)
                .to.changeTokenBalance(soldToken, deployer.address, amountToRefund);

            const saleState = await launchpad.sales(2);
            expect(saleState.saleEnded).to.eq(true);
            expect(saleState.softCapReached).to.eq(false);
        });
    });

    describe("claim", () => {
        beforeEach(async () => {
            await stake(alice, tierLimits.nano);
            await stake(bob, tierLimits.micro);
            await stake(charlie, tierLimits.mega);

            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(1);

            await increaseTime(61);
        });

        it("should revert if the sale has not ended", async () => {
            await expect(launchpad.claim(1)).to.be.revertedWith("Sale has not ended");
        });

        it("should revert if the caller has no contribution in the sale", async () => {
            await increaseTime(3600);

            await launchpad.endSale(1);

            await expect(launchpad.connect(dave).claim(1)).to.be.revertedWith("Nothing to claim");
        });

        it("should correctly claim if softcap was not reached for native token", async () => {
            await launchpad.connect(alice).contribute(1, 0, { value: toWei("1") });
            await launchpad.connect(bob).contribute(1, 0, { value: toWei("1.2") });
            await launchpad.connect(charlie).contribute(1, 0, { value: toWei("0.3") });

            await increaseTime(3600);

            await launchpad.endSale(1);

            await expect(launchpad.connect(alice).claim(1)).to.changeEtherBalance(alice, toWei("1"));
            await expect(launchpad.connect(bob).claim(1)).to.changeEtherBalance(bob, toWei("1.2"));
            await expect(launchpad.connect(charlie).claim(1)).to.changeEtherBalance(charlie, toWei("0.3"));
        });

        it("should correctly claim if softcap was not reached for ERC20 token", async () => {
            await launchpad.setPaymentTokenState(paymentToken.address, true);

            const saleParams = {
                token: soldToken.address,
                paymentToken: paymentToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            await paymentToken.mint(alice.address, toWei("1"));
            await paymentToken.connect(alice).approve(launchpad.address, toWei("1"));
            await launchpad.connect(alice).contribute(2, toWei("1"));

            await paymentToken.mint(bob.address, toWei("1.2"));
            await paymentToken.connect(bob).approve(launchpad.address, toWei("1.2"));
            await launchpad.connect(bob).contribute(2, toWei("1.2"));

            await paymentToken.mint(charlie.address, toWei("0.3"));
            await paymentToken.connect(charlie).approve(launchpad.address, toWei("0.3"));
            await launchpad.connect(charlie).contribute(2, toWei("0.3"));

            await increaseTime(3600);

            await launchpad.endSale(2);

            await expect(launchpad.connect(alice).claim(2)).to.changeTokenBalance(paymentToken, alice, toWei("1"));
            await expect(launchpad.connect(bob).claim(2)).to.changeTokenBalance(paymentToken, bob, toWei("1.2"));
            await expect(launchpad.connect(charlie).claim(2)).to.changeTokenBalance(paymentToken, charlie, toWei("0.3"));
        });

        describe("presale", () => {
            it("should correctly claim if softcap was reached for native token", async () => {
                const nanoAllocation = await launchpad.getTierAllocation(1, Tier.Nano);
                const microTier = await launchpad.getTierAllocation(1, Tier.Micro);
                const megaTier = await launchpad.getTierAllocation(1, Tier.Mega);

                await launchpad.connect(alice).contribute(1, 0, { value: nanoAllocation });
                await launchpad.connect(bob).contribute(1, 0, { value: microTier });
                await launchpad.connect(charlie).contribute(1, 0, { value: megaTier });

                await increaseTime(3600);

                await launchpad.endSale(1);

                const saleParams = (await launchpad.sales(1)).saleParams;

                const expectedTokensAlice = nanoAllocation.mul(saleParams.price).div(toWei("1"));
                await expect(launchpad.connect(alice).claim(1)).to.changeTokenBalance(soldToken, alice, expectedTokensAlice);

                const expectedTokensBob = microTier.mul(saleParams.price).div(toWei("1"));
                await expect(launchpad.connect(bob).claim(1)).to.changeTokenBalance(soldToken, bob, expectedTokensBob);

                const expectedTokensCharlie = megaTier.mul(saleParams.price).div(toWei("1"));
                await expect(launchpad.connect(charlie).claim(1)).to.changeTokenBalance(soldToken, charlie, expectedTokensCharlie);
            });

            it("should correctly claim if softcap was reached for ERC20 token", async () => {
                await launchpad.setPaymentTokenState(paymentToken.address, true);

                const saleParams = {
                    token: soldToken.address,
                    paymentToken: paymentToken.address,
                    owner: deployer.address,
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3660,
                    refundType: true,
                    isVestedSale: false,
                };

                await createCustomSale(saleParams);

                await launchpad.enableSale(2);

                await increaseTime(61);

                const nanoAllocation = await launchpad.getTierAllocation(2, Tier.Nano);
                const microTier = await launchpad.getTierAllocation(2, Tier.Micro);
                const megaTier = await launchpad.getTierAllocation(2, Tier.Mega);

                await paymentToken.mint(alice.address, nanoAllocation);
                await paymentToken.connect(alice).approve(launchpad.address, nanoAllocation);
                await launchpad.connect(alice).contribute(2, nanoAllocation);

                await paymentToken.mint(bob.address, microTier);
                await paymentToken.connect(bob).approve(launchpad.address, microTier);
                await launchpad.connect(bob).contribute(2, microTier);

                await paymentToken.mint(charlie.address, megaTier);
                await paymentToken.connect(charlie).approve(launchpad.address, megaTier);
                await launchpad.connect(charlie).contribute(2, megaTier);

                await increaseTime(3600);

                await launchpad.endSale(2);

                const expectedTokensAlice = nanoAllocation.mul(baseSaleParams.price).div(toWei("1"));
                await expect(launchpad.connect(alice).claim(2)).to.changeTokenBalance(soldToken, alice, expectedTokensAlice);

                const expectedTokensBob = microTier.mul(baseSaleParams.price).div(toWei("1"));
                await expect(launchpad.connect(bob).claim(2)).to.changeTokenBalance(soldToken, bob, expectedTokensBob);

                const expectedTokensCharlie = megaTier.mul(baseSaleParams.price).div(toWei("1"));
                await expect(launchpad.connect(charlie).claim(2)).to.changeTokenBalance(soldToken, charlie, expectedTokensCharlie);
            });
        });

        it("should correctly claim for vested sale with tge unlock", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
                isVestedSale: true,
                tgeUnlockPercentage: 2000,
                vestingStart: 0,
                vestingDuration: 10,
                vestingDurationUnits: DurationUnits.Weeks,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const nanoAllocation = await launchpad.getTierAllocation(2, Tier.Nano);
            const microTier = await launchpad.getTierAllocation(2, Tier.Micro);
            const megaTier = await launchpad.getTierAllocation(2, Tier.Mega);

            await launchpad.connect(alice).contribute(2, 0, { value: nanoAllocation });
            await launchpad.connect(bob).contribute(2, 0, { value: microTier });
            await launchpad.connect(charlie).contribute(2, 0, { value: megaTier });

            await increaseTime(3600);

            await launchpad.endSale(2);

            const expectedTokensAlice = nanoAllocation.mul(baseSaleParams.price).div(toWei("1")).mul(2000).div(10000);
            const expectedVestedTokensAlice = nanoAllocation.mul(baseSaleParams.price).div(toWei("1")).sub(expectedTokensAlice);
            await expect(launchpad.connect(alice).claim(2))
                .to.changeTokenBalance(soldToken, alice, expectedTokensAlice)
                .to.changeTokenBalance(soldToken, vesting, expectedVestedTokensAlice);
            const aliceVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, alice.address))[0];
            expect(aliceVestingSchedule.start).to.eq((await getTime()) + saleParams.vestingStart);
            expect(aliceVestingSchedule.amountTotal).to.eq(expectedVestedTokensAlice);
            expect(aliceVestingSchedule.duration).to.eq(saleParams.vestingDuration);
            expect(aliceVestingSchedule.durationUnits).to.eq(saleParams.vestingDurationUnits);

            const expectedTokensBob = microTier.mul(baseSaleParams.price).div(toWei("1")).mul(2000).div(10000);
            const expectedVestedTokensBob = microTier.mul(baseSaleParams.price).div(toWei("1")).sub(expectedTokensBob);
            await expect(launchpad.connect(bob).claim(2))
                .to.changeTokenBalance(soldToken, bob, expectedTokensBob)
                .to.changeTokenBalance(soldToken, vesting, expectedVestedTokensBob);
            const bobVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, bob.address))[0];
            expect(bobVestingSchedule.amountTotal).to.eq(expectedVestedTokensBob);

            const expectedTokensCharlie = megaTier.mul(baseSaleParams.price).div(toWei("1")).mul(2000).div(10000);
            const expectedVestedTokensCharlie = megaTier.mul(baseSaleParams.price).div(toWei("1")).sub(expectedTokensCharlie);
            await expect(launchpad.connect(charlie).claim(2))
                .to.changeTokenBalance(soldToken, charlie, expectedTokensCharlie)
                .to.changeTokenBalance(soldToken, vesting, expectedVestedTokensCharlie);
            const charlieVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, charlie.address))[0];
            expect(charlieVestingSchedule.amountTotal).to.eq(expectedVestedTokensCharlie);
        });

        it("should correctly claim for vested sale without tge unlock", async () => {
            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
                refundType: true,
                isVestedSale: true,
                tgeUnlockPercentage: 0,
                vestingStart: 0,
                vestingDuration: 10,
                vestingDurationUnits: DurationUnits.Weeks,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const nanoAllocation = await launchpad.getTierAllocation(2, Tier.Nano);
            const microTier = await launchpad.getTierAllocation(2, Tier.Micro);
            const megaTier = await launchpad.getTierAllocation(2, Tier.Mega);

            await launchpad.connect(alice).contribute(2, 0, { value: nanoAllocation });
            await launchpad.connect(bob).contribute(2, 0, { value: microTier });
            await launchpad.connect(charlie).contribute(2, 0, { value: megaTier });

            await increaseTime(3600);

            await launchpad.endSale(2);

            const expectedVestedTokensAlice = nanoAllocation.mul(baseSaleParams.price).div(toWei("1"));
            await expect(launchpad.connect(alice).claim(2)).to.changeTokenBalance(soldToken, vesting, expectedVestedTokensAlice);
            const aliceVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, alice.address))[0];
            expect(aliceVestingSchedule.start).to.eq((await getTime()) + saleParams.vestingStart);
            expect(aliceVestingSchedule.amountTotal).to.eq(expectedVestedTokensAlice);
            expect(aliceVestingSchedule.duration).to.eq(saleParams.vestingDuration);
            expect(aliceVestingSchedule.durationUnits).to.eq(saleParams.vestingDurationUnits);

            const expectedVestedTokensBob = microTier.mul(baseSaleParams.price).div(toWei("1"));
            await expect(launchpad.connect(bob).claim(2)).to.changeTokenBalance(soldToken, vesting, expectedVestedTokensBob);
            const bobVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, bob.address))[0];
            expect(bobVestingSchedule.amountTotal).to.eq(expectedVestedTokensBob);

            const expectedVestedTokensCharlie = megaTier.mul(baseSaleParams.price).div(toWei("1"));
            await expect(launchpad.connect(charlie).claim(2)).to.changeTokenBalance(soldToken, vesting, expectedVestedTokensCharlie);
            const charlieVestingSchedule = (await vesting.getVestingSchedules(soldToken.address, charlie.address))[0];
            expect(charlieVestingSchedule.amountTotal).to.eq(expectedVestedTokensCharlie);
        });

        describe("fairlaunch", () => {
            it("should correctly claim for fairlaunch with erc20 token", async () => {
                await launchpad.setPaymentTokenState(paymentToken.address, true);

                const saleParams = {
                    token: soldToken.address,
                    paymentToken: paymentToken.address,
                    owner: deployer.address,
                    price: toWei("0"),
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3660,
                    refundType: true,
                };

                await createCustomSale(saleParams);

                await launchpad.enableSale(2);

                await increaseTime(61);

                await paymentToken.mint(alice.address, toWei("10"));
                await paymentToken.connect(alice).approve(launchpad.address, toWei("10"));
                await launchpad.connect(alice).contribute(2, toWei("10"));

                await paymentToken.mint(bob.address, toWei("12"));
                await paymentToken.connect(bob).approve(launchpad.address, toWei("12"));
                await launchpad.connect(bob).contribute(2, toWei("12"));

                await paymentToken.mint(charlie.address, toWei("3"));
                await paymentToken.connect(charlie).approve(launchpad.address, toWei("3"));
                await launchpad.connect(charlie).contribute(2, toWei("3"));

                await increaseTime(3600);

                await launchpad.endSale(2);

                const totalContributions = toWei("25");

                const expectedTokensAlice = toWei("100").mul(toWei("10")).div(totalContributions);
                await expect(launchpad.connect(alice).claim(2)).to.changeTokenBalance(soldToken, alice, expectedTokensAlice);

                const expectedTokensBob = toWei("100").mul(toWei("12")).div(totalContributions);
                await expect(launchpad.connect(bob).claim(2)).to.changeTokenBalance(soldToken, bob, expectedTokensBob);

                const expectedTokensCharlie = toWei("100").mul(toWei("3")).div(totalContributions);
                await expect(launchpad.connect(charlie).claim(2)).to.changeTokenBalance(soldToken, charlie, expectedTokensCharlie);
            });

            it("should correctly claim for fairlaunch with eth", async () => {
                const saleParams = {
                    token: soldToken.address,
                    owner: deployer.address,
                    price: toWei("0"),
                    startTimestamp: (await getTime()) + 60,
                    endTimestamp: (await getTime()) + 3660,
                    refundType: true,
                };

                await createCustomSale(saleParams);

                await launchpad.enableSale(2);

                await increaseTime(61);

                await launchpad.connect(alice).contribute(2, 0, { value: toWei("10") });
                await launchpad.connect(bob).contribute(2, 0, { value: toWei("12") });
                await launchpad.connect(charlie).contribute(2, 0, { value: toWei("3") });

                await increaseTime(3600);

                await launchpad.endSale(2);

                const totalContributions = toWei("25");

                const expectedTokensAlice = toWei("100").mul(toWei("10")).div(totalContributions);
                await expect(launchpad.connect(alice).claim(2)).to.changeTokenBalance(soldToken, alice, expectedTokensAlice);

                const expectedTokensBob = toWei("100").mul(toWei("12")).div(totalContributions);
                await expect(launchpad.connect(bob).claim(2)).to.changeTokenBalance(soldToken, bob, expectedTokensBob);

                const expectedTokensCharlie = toWei("100").mul(toWei("3")).div(totalContributions);
                await expect(launchpad.connect(charlie).claim(2)).to.changeTokenBalance(soldToken, charlie, expectedTokensCharlie);
            });
        });
    });

    describe("withdrawFee", () => {
        beforeEach(async () => {
            await stake(alice, tierLimits.nano);
            await stake(bob, tierLimits.micro);
            await stake(charlie, tierLimits.mega);

            const saleParams = {
                token: soldToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await createCustomSale(saleParams);

            await launchpad.enableSale(1);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(alice.address));
            await launchpad.connect(alice).contribute(1, 0, { value: aliceAllocation });

            const bobAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(bob.address));
            await launchpad.connect(bob).contribute(1, 0, { value: bobAllocation });

            const charlieAllocation = await launchpad.getTierAllocation(1, await stakingRouter.getTier(charlie.address));
            await launchpad.connect(charlie).contribute(1, 0, { value: charlieAllocation });

            await increaseTime(3600);
            await launchpad.endSale(1);
        });

        it("should revert if caller does not have admin role", async () => {
            await expect(launchpad.connect(alice).withdrawFee(ethers.constants.AddressZero, toWei("1"))).to.be.reverted;
        });

        it("should revert if amount is greater than balance", async () => {
            await expect(launchpad.withdrawFee(ethers.constants.AddressZero, toWei("100"))).to.be.revertedWith("Amount exceeds fee pool balance");
        });

        it("should correctly withdraw fee for native token", async () => {
            const plsAvaialbleForWithdrawal = await launchpad.feePool(ethers.constants.AddressZero);
            await expect(launchpad.withdrawFee(ethers.constants.AddressZero, plsAvaialbleForWithdrawal)).to.changeEtherBalance(
                deployer,
                plsAvaialbleForWithdrawal
            );
        });

        it("should correctly withdraw fee for erc20 token", async () => {
            const saleParams = {
                token: soldToken.address,
                paymentToken: paymentToken.address,
                owner: deployer.address,
                startTimestamp: (await getTime()) + 60,
                endTimestamp: (await getTime()) + 3660,
            };

            await launchpad.setPaymentTokenState(paymentToken.address, true);

            await createCustomSale(saleParams);

            await launchpad.enableSale(2);

            await increaseTime(61);

            const aliceAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(alice.address));
            await paymentToken.mint(alice.address, aliceAllocation);
            await paymentToken.connect(alice).approve(launchpad.address, aliceAllocation);
            await launchpad.connect(alice).contribute(2, aliceAllocation);

            const bobAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(bob.address));
            await paymentToken.mint(bob.address, bobAllocation);
            await paymentToken.connect(bob).approve(launchpad.address, bobAllocation);
            await launchpad.connect(bob).contribute(2, bobAllocation);

            const charlieAllocation = await launchpad.getTierAllocation(2, await stakingRouter.getTier(charlie.address));
            await paymentToken.mint(charlie.address, charlieAllocation);
            await paymentToken.connect(charlie).approve(launchpad.address, charlieAllocation);
            await launchpad.connect(charlie).contribute(2, charlieAllocation);

            await increaseTime(3600);
            await launchpad.endSale(2);

            const plsAvaialbleForWithdrawal = await launchpad.feePool(paymentToken.address);
            await expect(launchpad.withdrawFee(paymentToken.address, plsAvaialbleForWithdrawal)).to.changeTokenBalance(
                paymentToken,
                deployer,
                plsAvaialbleForWithdrawal
            );
        });
    });
});
