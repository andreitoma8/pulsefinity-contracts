import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { upgrades } from "hardhat";
import { LockType, Tier } from "./helpers/interfaces";

import { PulsefinityStakingPool, PulsefinityStakingRouter, MockERC20 } from "../typechain-types";

chai.use(chaiAsPromised);

describe("Staking", () => {
    let stakingPool: PulsefinityStakingPool;
    let stakingRouter: PulsefinityStakingRouter;
    let pulsefinity: MockERC20;
    let rewardToken: MockERC20;

    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let carol: SignerWithAddress;

    const toWei = (amount: string) => ethers.utils.parseEther(amount);

    const tierLimits = {
        nano: toWei("10"),
        micro: toWei("20"),
        mega: toWei("30"),
        giga: toWei("40"),
        tera: toWei("50"),
        teraPlus: toWei("60"),
    };

    const increaseTime = async (seconds: number) => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };

    const addRewards = async (amount: BigNumber) => {
        await rewardToken.mint(deployer.address, amount);
        await rewardToken.approve(stakingPool.address, amount);
        await stakingPool.addRewards(amount);
    };

    const stake = async (pool: PulsefinityStakingPool, user: SignerWithAddress, amount: BigNumber, lockType: LockType) => {
        await pulsefinity.mint(user.address, amount);
        await pulsefinity.connect(user).approve(pool.address, amount);
        await pool.connect(user).stake(amount, lockType);
    };

    const deployPool = async (reward: string, tier: Tier) => {
        const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
        return (await upgrades.deployProxy(PulsefinityStakingPoolFactory, [pulsefinity.address, reward, stakingRouter.address, tier], {
            kind: "uups",
        })) as PulsefinityStakingPool;
    };

    before(async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
    });

    beforeEach(async () => {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        pulsefinity = await MockERC20Factory.deploy("Pulsefinity", "PULSE");
        rewardToken = await MockERC20Factory.deploy("Reward Token", "REWARD");

        const StakingRouterFactory = await ethers.getContractFactory("PulsefinityStakingRouter");
        stakingRouter = (await upgrades.deployProxy(StakingRouterFactory, [pulsefinity.address, tierLimits], { kind: "uups" })) as PulsefinityStakingRouter;

        stakingPool = await deployPool(rewardToken.address, Tier.Nano);

        await stakingRouter.addStakingPool(stakingPool.address);
    });

    describe("PulsefinityStakingPool", () => {
        describe("initializer", () => {
            it("should not be able to initialize twice", async () => {
                await expect(stakingPool.initialize(pulsefinity.address, rewardToken.address, stakingRouter.address, Tier.Nano)).to.be.revertedWith(
                    "Initializable: contract is already initialized"
                );
            });

            it("should correctly initialize staking for ERC20 reward token", async () => {
                expect(await stakingPool.pulsefinityToken()).to.equal(pulsefinity.address);
                expect(await stakingPool.rewardToken()).to.equal(rewardToken.address);
                expect(await stakingPool.stakingRouter()).to.equal(stakingRouter.address);
                expect(await stakingPool.requiredTier()).to.equal(Tier.Nano);
                expect(await stakingPool.isNativeToken()).to.equal(false);
                expect(await stakingPool.getRewardToken()).to.equal(rewardToken.address);
            });

            it("should correctly initialize staking for native reward token", async () => {
                stakingPool = await deployPool(ethers.constants.AddressZero, Tier.Nano);
                expect(await stakingPool.isNativeToken()).to.equal(true);
                expect(await stakingPool.getRewardToken()).to.equal(ethers.constants.AddressZero);
            });
        });

        describe("upgradeTo", () => {
            it("should revert if not owner", async () => {
                await expect(stakingPool.connect(alice).upgradeTo(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });

        describe("stake", () => {
            it("should revert if amount is 0", async () => {
                await expect(stakingPool.stake(0, LockType.Days15)).to.be.revertedWith("Cannot stake 0");
            });

            it("should revert if user predicted tier is not ", async () => {
                await expect(stakingPool.stake(1, LockType.Days15)).to.be.revertedWith("Invalid tier");
            });

            it("should correctly stake", async () => {
                const stakedAmountAlice = toWei("15");
                await pulsefinity.mint(alice.address, stakedAmountAlice);
                await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice);

                const expectedSharesAlice = stakedAmountAlice.add(stakedAmountAlice.mul(200).div(10000));

                await expect(stakingPool.connect(alice).stake(stakedAmountAlice, LockType.Days15))
                    .to.changeTokenBalance(pulsefinity, stakingPool, stakedAmountAlice)
                    .to.emit(stakingPool, "Staked")
                    .withArgs(alice.address, stakedAmountAlice, LockType.Days15);

                expect(await stakingPool.totalStaked()).to.equal(stakedAmountAlice);
                expect(await stakingPool.totalShares()).to.equal(expectedSharesAlice);

                const aliceStakes = await stakingPool.getUserStakes(alice.address);
                expect(aliceStakes.length).to.equal(1);
                expect(aliceStakes[0].amount).to.equal(stakedAmountAlice);
                expect(aliceStakes[0].shares).to.equal(expectedSharesAlice);
                expect(aliceStakes[0].lockType).to.equal(LockType.Days15);

                await addRewards(ethers.utils.parseEther("10"));

                const stakedAmountBob = toWei("30");
                await pulsefinity.mint(bob.address, stakedAmountBob);
                await pulsefinity.connect(bob).approve(stakingPool.address, stakedAmountBob);

                const expectedSharesBob = stakedAmountBob.add(stakedAmountBob.mul(200).div(10000));

                const tx = await stakingPool.connect(bob).stake(stakedAmountBob, LockType.Days15);
                const rx = await tx.wait();
                const txTimestamp = (await ethers.provider.getBlock(rx.blockNumber)).timestamp;

                expect(await stakingPool.totalStaked()).to.equal(stakedAmountAlice.add(stakedAmountBob));
                expect(await stakingPool.totalShares()).to.equal(expectedSharesAlice.add(expectedSharesBob));

                const bobStakes = await stakingPool.getUserStakes(bob.address);
                expect(bobStakes.length).to.equal(1);
                expect(bobStakes[0].amount).to.equal(stakedAmountBob);
                expect(bobStakes[0].shares).to.equal(expectedSharesBob);
                expect(bobStakes[0].lockType).to.equal(LockType.Days15);
                expect(bobStakes[0].startTimestamp).to.equal(txTimestamp);
            });
        });

        describe("withdraw", () => {
            const stakedAmountAlice = toWei("15");
            const rewardsAmmount = toWei("10");

            beforeEach(async () => {
                await stake(stakingPool, alice, stakedAmountAlice, LockType.Days15);
                await addRewards(rewardsAmmount);
            });

            it("should revert if stake index does not exist", async () => {
                await expect(stakingPool.connect(alice).withdraw(1)).to.be.revertedWith("Invalid stake index");
            });

            it("should correctly withdraw before the half way mark to the end of the lock period", async () => {
                const expectedTokenReturn = stakedAmountAlice.sub(stakedAmountAlice.mul(1000).div(10000));
                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, expectedTokenReturn)
                    .to.changeTokenBalance(pulsefinity, deployer, stakedAmountAlice.sub(expectedTokenReturn));
            });

            it("should correctly withdraw after the half way mark to the end of the lock period", async () => {
                await increaseTime((60 * 60 * 24 * 15) / 2 + 1);
                await expect(stakingPool.connect(alice).withdraw(0)).to.changeTokenBalance(pulsefinity, alice, toWei("15"));
            });

            it("should correctly withdraw after the lock period", async () => {
                await increaseTime(60 * 60 * 24 * 15 + 1);

                const aliceStake = await stakingPool.getUserStakes(alice.address);
                const expectedRewardsReturn = aliceStake[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(aliceStake[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, stakedAmountAlice)
                    .to.changeTokenBalance(rewardToken, alice, expectedRewardsReturn)
                    .to.emit(stakingPool, "Withdrawn")
                    .withArgs(alice.address, stakedAmountAlice, expectedRewardsReturn);

                expect(await stakingPool.totalStaked()).to.equal(0);
                expect(await stakingPool.totalRewards()).to.equal(rewardsAmmount.sub(expectedRewardsReturn));

                const aliceStakes = await stakingPool.getUserStakes(alice.address);
                expect(aliceStakes.length).to.equal(0);
            });

            it("should correctly withdraw after the lock period with multiple stakes", async () => {
                const stakedAmountAlice2 = toWei("10");
                await stake(stakingPool, alice, stakedAmountAlice2, LockType.Days15);

                await increaseTime(60 * 60 * 24 * 15 + 1);

                await addRewards(rewardsAmmount);

                const aliceStake = await stakingPool.getUserStakes(alice.address);
                const expectedRewardsReturn1 = aliceStake[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(aliceStake[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, stakedAmountAlice)
                    .to.changeTokenBalance(rewardToken, alice, expectedRewardsReturn1)
                    .to.emit(stakingPool, "Withdrawn")
                    .withArgs(alice.address, stakedAmountAlice, expectedRewardsReturn1);

                expect(await stakingPool.totalStaked()).to.equal(stakedAmountAlice2);
                expect(await stakingPool.totalRewards()).to.equal(rewardsAmmount.add(rewardsAmmount).sub(expectedRewardsReturn1));

                const aliceStakes = await stakingPool.getUserStakes(alice.address);
                expect(aliceStakes.length).to.equal(1);
                expect(aliceStakes[0].amount).to.equal(stakedAmountAlice2);

                const expectedRewardsReturn2 = aliceStakes[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(aliceStakes[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, stakedAmountAlice2)
                    .to.changeTokenBalance(rewardToken, alice, expectedRewardsReturn2)
                    .to.emit(stakingPool, "Withdrawn")
                    .withArgs(alice.address, stakedAmountAlice2, expectedRewardsReturn2);

                expect(await stakingPool.totalStaked()).to.equal(0);
                expect(await stakingPool.totalRewards()).to.equal(rewardsAmmount.add(rewardsAmmount).sub(expectedRewardsReturn1).sub(expectedRewardsReturn2));

                const aliceStakes2 = await stakingPool.getUserStakes(alice.address);
                expect(aliceStakes2.length).to.equal(0);
            });

            it("should correctly withdraw after the lock period with multiple stakers", async () => {
                const stakedAmountBob = toWei("30");
                await stake(stakingPool, bob, stakedAmountBob, LockType.Days15);

                await increaseTime(60 * 60 * 24 * 30 + 1);

                await addRewards(rewardsAmmount);

                const aliceStake = await stakingPool.getUserStakes(alice.address);
                const bobStake = await stakingPool.getUserStakes(bob.address);

                const expectedRewardsReturnAlice = aliceStake[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(aliceStake[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                const expectedRewardsReturnBob = bobStake[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(bobStake[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, stakedAmountAlice)
                    .to.changeTokenBalance(rewardToken, alice, expectedRewardsReturnAlice)
                    .to.emit(stakingPool, "Withdrawn")
                    .withArgs(alice.address, stakedAmountAlice, expectedRewardsReturnAlice);

                await expect(stakingPool.connect(bob).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, bob, stakedAmountBob)
                    .to.changeTokenBalance(rewardToken, bob, expectedRewardsReturnBob)
                    .to.emit(stakingPool, "Withdrawn")
                    .withArgs(bob.address, stakedAmountBob, expectedRewardsReturnBob);

                expect(await stakingPool.totalStaked()).to.equal(0);
                expect(await stakingPool.totalRewards()).to.equal(
                    rewardsAmmount.add(rewardsAmmount).sub(expectedRewardsReturnAlice).sub(expectedRewardsReturnBob)
                );

                const aliceStakes = await stakingPool.getUserStakes(alice.address);
                expect(aliceStakes.length).to.equal(0);

                const bobStakes = await stakingPool.getUserStakes(bob.address);
                expect(bobStakes.length).to.equal(0);
            });

            it("should correctly withdraw after the lock period for native token reward", async () => {
                stakingPool = await deployPool(ethers.constants.AddressZero, Tier.Nano);
                await stakingRouter.addStakingPool(stakingPool.address);

                const stakedAmountAlice2 = toWei("10");
                await stake(stakingPool, alice, stakedAmountAlice2, LockType.Days15);

                await stakingPool.addRewards(0, { value: rewardsAmmount });

                const aliceStake = await stakingPool.getUserStakes(alice.address);
                const expectedRewardsReturn1 = aliceStake[0].shares
                    .mul((await stakingPool.rewardIndex()).sub(aliceStake[0].rewardIndex))
                    .div(ethers.utils.parseEther("1"));

                await increaseTime(60 * 60 * 24 * 15 + 1);

                await expect(stakingPool.connect(alice).withdraw(0))
                    .to.changeTokenBalance(pulsefinity, alice, stakedAmountAlice2)
                    .to.changeEtherBalance(alice, expectedRewardsReturn1)
                    .to.emit(stakingPool, "Withdrawn");
            });
        });

        describe("addRewards", () => {
            const rewardsAmount = toWei("100");

            beforeEach(async () => {
                await rewardToken.mint(deployer.address, rewardsAmount);
                await rewardToken.approve(stakingPool.address, rewardsAmount);
            });

            it("should revert if no tokens are staked in the pool", async () => {
                await expect(stakingPool.addRewards(1)).to.be.revertedWith("Cannot add rewards when there are no stakes");
            });

            describe("ERC20 rewards", () => {
                beforeEach(async () => {
                    const stakedAmountAlice = toWei("10");
                    await stake(stakingPool, alice, stakedAmountAlice, LockType.Days15);
                });

                it("should revert if amount is 0", async () => {
                    await expect(stakingPool.addRewards(0)).to.be.revertedWith("Cannot add 0 rewards");
                });

                it("should revert if any ether is sent", async () => {
                    await expect(stakingPool.addRewards(1, { value: 1 })).to.be.revertedWith("Cannot add rewards with ETH");
                });

                it("should correctly add rewards", async () => {
                    await expect(stakingPool.addRewards(rewardsAmount)).to.changeTokenBalance(rewardToken, stakingPool, rewardsAmount);

                    expect(await stakingPool.totalRewards()).to.equal(rewardsAmount);
                    expect(await rewardToken.balanceOf(stakingPool.address)).to.equal(rewardsAmount);
                    expect(await stakingPool.rewardIndex()).to.equal(rewardsAmount.mul(ethers.utils.parseEther("1")).div(await stakingPool.totalShares()));
                });
            });

            describe("ETH rewards", () => {
                beforeEach(async () => {
                    stakingPool = await deployPool(ethers.constants.AddressZero, Tier.Nano);
                    await stakingRouter.addStakingPool(stakingPool.address);

                    const stakedAmountAlice = toWei("10");
                    await stake(stakingPool, alice, stakedAmountAlice, LockType.Days15);
                });

                it("should revert if amount is 0", async () => {
                    await expect(stakingPool.addRewards(1)).to.be.revertedWith("Cannot add 0 rewards");
                });

                it("should correctly add rewards", async () => {
                    await expect(stakingPool.addRewards(0, { value: rewardsAmount })).to.changeEtherBalance(stakingPool, rewardsAmount);

                    expect(await stakingPool.totalRewards()).to.equal(rewardsAmount);
                    expect(await stakingPool.rewardIndex()).to.equal(rewardsAmount.mul(ethers.utils.parseEther("1")).div(await stakingPool.totalShares()));
                });
            });
        });

        describe("withdrawRewardSurplus", () => {
            const rewardsSurplus = toWei("50");

            it("should revert if caller is not owner", async () => {
                await expect(stakingPool.connect(alice).withdrawRewardSurplus()).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert if rewards token is native token", async () => {
                stakingPool = await deployPool(ethers.constants.AddressZero, Tier.Nano);
                await stakingRouter.addStakingPool(stakingPool.address);

                await expect(stakingPool.withdrawRewardSurplus()).to.be.revertedWith("Cannot withdraw rewards surplus with native token");
            });

            it("shoudl revert if there is no rewards surplus", async () => {
                await expect(stakingPool.withdrawRewardSurplus()).to.be.revertedWith("No rewards surplus to withdraw");
            });

            it("should correctly withdraw rewards surplus", async () => {
                await rewardToken.mint(deployer.address, rewardsSurplus);
                await rewardToken.approve(stakingPool.address, rewardsSurplus);
                await rewardToken.transfer(stakingPool.address, rewardsSurplus);

                await expect(stakingPool.withdrawRewardSurplus()).to.changeTokenBalance(rewardToken, deployer, rewardsSurplus);

                expect(await rewardToken.balanceOf(stakingPool.address)).to.equal(0);
            });

            it("should correctly withdraw rewards surplus if staked and rewards token are the same", async () => {
                stakingPool = await deployPool(pulsefinity.address, Tier.Nano);
                await stakingRouter.addStakingPool(stakingPool.address);

                const tokenstToMint = toWei("100");

                await pulsefinity.mint(deployer.address, tokenstToMint);
                await pulsefinity.approve(stakingPool.address, tokenstToMint);
                await pulsefinity.transfer(stakingPool.address, rewardsSurplus);
                await stakingPool.stake(tokenstToMint.sub(rewardsSurplus), LockType.Days15);

                await expect(stakingPool.withdrawRewardSurplus()).to.changeTokenBalance(pulsefinity, deployer, rewardsSurplus);
            });
        });

        describe("getTotalValueStaked", () => {
            const stakedAmount = toWei("10");

            it("should return 0 if user has no stakes", async () => {});

            it("should correctly return the total value locked", async () => {
                await stake(stakingPool, alice, stakedAmount, LockType.Days15);
                await stake(stakingPool, alice, stakedAmount, LockType.Days30);
                await stake(stakingPool, bob, stakedAmount, LockType.Days15);

                expect(await stakingPool.getTotalValueStaked(alice.address)).to.equal(stakedAmount.mul(2));
            });
        });
    });

    describe("PulsefinityStakingRouter", () => {
        let stakingPool2: PulsefinityStakingPool;
        let stakingPool3: PulsefinityStakingPool;

        beforeEach(async () => {
            stakingPool2 = await deployPool(ethers.constants.AddressZero, Tier.Nano);
            stakingPool3 = await deployPool(ethers.constants.AddressZero, Tier.Nano);
            await stakingRouter.addStakingPool(stakingPool2.address);
            await stakingRouter.addStakingPool(stakingPool3.address);
        });

        describe("initializer", () => {
            it("should not be able to initialize twice", async () => {
                await expect(stakingRouter.initialize(pulsefinity.address, tierLimits)).to.be.revertedWith("Initializable: contract is already initialized");
            });

            it("should correctly initialize the contract", async () => {
                expect(await stakingRouter.owner()).to.equal(deployer.address);
                expect(await stakingRouter.pulsefinityToken()).to.equal(pulsefinity.address);
                expect(await stakingRouter.tierLimits()).to.deep.equal(Object.values(tierLimits));
            });
        });

        describe("upgradeTo", () => {
            it("should revert if not owner", async () => {
                await expect(stakingRouter.connect(alice).upgradeTo(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });

        describe("addStakingPool", () => {
            it("should revert if caller is not owner", async () => {
                await expect(stakingRouter.connect(alice).addStakingPool(stakingPool.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert if staking pool is already added", async () => {
                await expect(stakingRouter.addStakingPool(stakingPool.address)).to.be.revertedWith("Staking pool already added");
            });

            it("should correctly add staking pool", async () => {
                expect(await stakingRouter.stakingPools(1)).to.equal(stakingPool2.address);
                expect(await stakingRouter.isStakingPool(stakingPool2.address)).to.equal(true);
            });
        });

        describe("removeStakingPool", () => {
            it("should revert if caller is not owner", async () => {
                await expect(stakingRouter.connect(alice).removeStakingPool(stakingPool2.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert if index is out of bounds", async () => {
                await expect(stakingRouter.removeStakingPool(3)).to.be.revertedWith("Index out of bounds");
            });

            it("should correctly remove staking pool", async () => {
                await stakingRouter.removeStakingPool(0);
                expect(await stakingRouter.isStakingPool(stakingPool.address)).to.equal(false);

                const stakingPoolsIndex1 = await stakingRouter.stakingPools(1);
                await stakingRouter.removeStakingPool(1);
                expect(await stakingRouter.isStakingPool(stakingPoolsIndex1)).to.equal(false);
            });
        });

        describe("setTiers", () => {
            it("should revert if caller is not owner", async () => {
                await expect(stakingRouter.connect(alice).setTiers(tierLimits)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should correctly set tier limit", async () => {
                const newTierLimits = {
                    nano: toWei("100"),
                    micro: toWei("200"),
                    mega: toWei("300"),
                    giga: toWei("400"),
                    tera: toWei("500"),
                    teraPlus: toWei("600"),
                };

                await stakingRouter.setTiers(newTierLimits);
                expect(await stakingRouter.tierLimits()).to.deep.equal(Object.values(newTierLimits));
            });
        });

        describe("updateStakersPerTier", () => {
            it("should revert if caller is not staking pool", async () => {
                await expect(stakingRouter.updateStakersPerTier(Tier.Nano, true)).to.be.revertedWith("Caller is not a staking pool");
                await expect(stakingRouter.updateStakersPerTier(Tier.Nano, false)).to.be.revertedWith("Caller is not a staking pool");
            });

            it("should correctly update stakers per tier", async () => {
                await stakingRouter.addStakingPool(deployer.address);

                const nanoStakersBefore = await stakingRouter.stakersPerTier(Tier.Nano);
                await stakingRouter.updateStakersPerTier(Tier.Nano, true);
                expect(await stakingRouter.stakersPerTier(Tier.Nano)).to.equal(nanoStakersBefore.add(1));

                await stakingRouter.updateStakersPerTier(Tier.Nano, false);
                expect(await stakingRouter.stakersPerTier(Tier.Nano)).to.equal(nanoStakersBefore);
            });
        });

        describe("getTotalStaked", () => {
            it("should correctly return the total staked", async () => {
                const stakedAmountPool1 = toWei("10");
                const stakedAmountPool2 = toWei("20");

                await stake(stakingPool, alice, stakedAmountPool1, LockType.Days15);
                await stake(stakingPool2, alice, stakedAmountPool2, LockType.Days15);
                await stake(stakingPool2, alice, stakedAmountPool2, LockType.Days15);

                expect(await stakingRouter.getTotalStaked(alice.address)).to.equal(stakedAmountPool1.add(stakedAmountPool2.mul(2)));
            });
        });

        describe("getTier", () => {
            it("should correctly return the tier", async () => {
                const teraPlusLimit = tierLimits.teraPlus;

                await pulsefinity.mint(alice.address, teraPlusLimit);
                await pulsefinity.connect(alice).approve(stakingPool.address, teraPlusLimit);

                await stakingPool.connect(alice).stake(tierLimits.nano, LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.Nano);

                await stakingPool.connect(alice).stake(tierLimits.micro.sub(tierLimits.nano), LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.Micro);

                await stakingPool.connect(alice).stake(tierLimits.mega.sub(tierLimits.micro), LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.Mega);

                await stakingPool.connect(alice).stake(tierLimits.giga.sub(tierLimits.mega), LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.Giga);

                await stakingPool.connect(alice).stake(tierLimits.tera.sub(tierLimits.giga), LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.Tera);

                await stakingPool.connect(alice).stake(tierLimits.teraPlus.sub(tierLimits.tera), LockType.Days15);
                expect(await stakingRouter.getTier(alice.address)).to.equal(Tier.TeraPlus);
            });
        });

        describe("getPredictedTier", () => {
            it("should correctly return the predicted tier", async () => {
                const teraPlusLimit = tierLimits.teraPlus;

                await pulsefinity.mint(alice.address, teraPlusLimit);
                await pulsefinity.connect(alice).approve(stakingPool.address, teraPlusLimit);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.nano, true)).to.equal(Tier.Nano);
                await stakingPool.connect(alice).stake(tierLimits.nano, LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.micro.sub(tierLimits.nano), true)).to.equal(Tier.Micro);
                await stakingPool.connect(alice).stake(tierLimits.micro.sub(tierLimits.nano), LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.mega.sub(tierLimits.micro), true)).to.equal(Tier.Mega);
                await stakingPool.connect(alice).stake(tierLimits.mega.sub(tierLimits.micro), LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.giga.sub(tierLimits.mega), true)).to.equal(Tier.Giga);
                await stakingPool.connect(alice).stake(tierLimits.giga.sub(tierLimits.mega), LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.tera.sub(tierLimits.giga), true)).to.equal(Tier.Tera);
                await stakingPool.connect(alice).stake(tierLimits.tera.sub(tierLimits.giga), LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.teraPlus.sub(tierLimits.tera), true)).to.equal(Tier.TeraPlus);
                await stakingPool.connect(alice).stake(tierLimits.teraPlus.sub(tierLimits.tera), LockType.Days15);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.teraPlus.sub(tierLimits.tera), false)).to.equal(Tier.Tera);
                await stakingPool.connect(alice).withdraw(5);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.tera.sub(tierLimits.giga), false)).to.equal(Tier.Giga);
                await stakingPool.connect(alice).withdraw(4);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.giga.sub(tierLimits.mega), false)).to.equal(Tier.Mega);
                await stakingPool.connect(alice).withdraw(3);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.mega.sub(tierLimits.micro), false)).to.equal(Tier.Micro);
                await stakingPool.connect(alice).withdraw(2);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.micro.sub(tierLimits.nano), false)).to.equal(Tier.Nano);
                await stakingPool.connect(alice).withdraw(1);

                expect(await stakingRouter.getPredictedTier(alice.address, tierLimits.nano, false)).to.equal(Tier.Null);
            });
        });

        describe("getStakersPerTier", () => {
            it("should correctly return the stakers per tier", async () => {
                await stake(stakingPool, alice, tierLimits.nano, LockType.Days15);
                await stake(stakingPool, bob, tierLimits.giga, LockType.Days15);
                await stake(stakingPool, carol, tierLimits.tera, LockType.Days15);

                const stakersPerTierArray = await stakingRouter.getStakersPerTier();
                const stakersPerTierNumberArray = stakersPerTierArray.map((value) => value.toNumber());

                expect(stakersPerTierNumberArray).to.deep.equal([1, 0, 0, 1, 1, 0]);
            });
        });

        describe("getGlobalAmountStaked", () => {
            it("should correctly return the global amount staked", async () => {
                await stake(stakingPool, alice, tierLimits.nano, LockType.Days15);
                await stake(stakingPool, bob, tierLimits.giga, LockType.Days15);
                await stake(stakingPool, carol, tierLimits.tera, LockType.Days15);

                expect(await stakingRouter.getGlobalAmountStaked()).to.equal(tierLimits.nano.add(tierLimits.giga).add(tierLimits.tera));
            });
        });
    });
});
