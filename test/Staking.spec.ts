import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";

import { PulsefinityStakingPool, StakingRouter, MockERC20 } from "../typechain-types";

chai.use(chaiAsPromised);

enum LockType {
    Days15,
    Days30,
    Days60,
    Days90,
    Days180,
    Days360,
}

enum Tier {
    Null,
    Nano,
    Micro,
    Mega,
    Giga,
    Tera,
    TeraPlus,
}

describe("Staking", () => {
    let stakingPool: PulsefinityStakingPool;
    let stakingRouter: StakingRouter;
    let pulsefinity: MockERC20;
    let rewardToken: MockERC20;

    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let carol: SignerWithAddress;

    const increaseTime = async (seconds: number) => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };

    before(async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
    });

    beforeEach(async () => {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        pulsefinity = await MockERC20Factory.deploy("Pulsefinity", "PULSE");
        rewardToken = await MockERC20Factory.deploy("Reward Token", "REWARD");

        const StakingRouterFactory = await ethers.getContractFactory("StakingRouter");
        stakingRouter = await StakingRouterFactory.deploy(pulsefinity.address, {
            nano: ethers.utils.parseEther("10"),
            micro: ethers.utils.parseEther("20"),
            mega: ethers.utils.parseEther("30"),
            giga: ethers.utils.parseEther("40"),
            tera: ethers.utils.parseEther("50"),
            teraPlus: ethers.utils.parseEther("60"),
        });

        const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
        stakingPool = await PulsefinityStakingPoolFactory.deploy(pulsefinity.address, rewardToken.address, stakingRouter.address, Tier.Nano);

        await stakingRouter.addStakingPool(stakingPool.address);
    });

    describe("PulsefinityStakingPool", () => {
        describe("constructor", () => {
            it("should correctly initialize staking for ERC20 reward token", async () => {
                expect(await stakingPool.pulsefinityToken()).to.equal(pulsefinity.address);
                expect(await stakingPool.rewardToken()).to.equal(rewardToken.address);
                expect(await stakingPool.stakingRouter()).to.equal(stakingRouter.address);
                expect(await stakingPool.requiredTier()).to.equal(Tier.Nano);
                expect(await stakingPool.isNativeToken()).to.equal(false);
                expect(await stakingPool.getRewardToken()).to.equal(rewardToken.address);
            });

            it("should correctly initialize staking for native reward token", async () => {
                const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
                stakingPool = await PulsefinityStakingPoolFactory.deploy(pulsefinity.address, ethers.constants.AddressZero, stakingRouter.address, Tier.Nano);
                expect(await stakingPool.isNativeToken()).to.equal(true);
                expect(await stakingPool.getRewardToken()).to.equal(ethers.constants.AddressZero);
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
                const stakedAmountAlice = ethers.utils.parseEther("15");
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

                await rewardToken.mint(deployer.address, ethers.utils.parseEther("10"));
                await rewardToken.approve(stakingPool.address, ethers.utils.parseEther("10"));
                await stakingPool.addRewards(ethers.utils.parseEther("10"));

                const stakedAmountBob = ethers.utils.parseEther("30");
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
            const stakedAmountAlice = ethers.utils.parseEther("15");
            const rewardsAmmount = ethers.utils.parseEther("10");

            beforeEach(async () => {
                await pulsefinity.mint(alice.address, stakedAmountAlice);
                await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice);
                await stakingPool.connect(alice).stake(stakedAmountAlice, LockType.Days15);

                await rewardToken.mint(deployer.address, rewardsAmmount);
                await rewardToken.approve(stakingPool.address, rewardsAmmount);
                await stakingPool.addRewards(rewardsAmmount);
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
                await expect(stakingPool.connect(alice).withdraw(0)).to.changeTokenBalance(pulsefinity, alice, ethers.utils.parseEther("15"));
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
                const stakedAmountAlice2 = ethers.utils.parseEther("10");
                await pulsefinity.mint(alice.address, stakedAmountAlice2);
                await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice2);
                await stakingPool.connect(alice).stake(stakedAmountAlice2, LockType.Days15);

                await increaseTime(60 * 60 * 24 * 15 + 1);

                await rewardToken.mint(deployer.address, rewardsAmmount);
                await rewardToken.approve(stakingPool.address, rewardsAmmount);
                await stakingPool.addRewards(rewardsAmmount);

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
                const stakedAmountBob = ethers.utils.parseEther("30");
                await pulsefinity.mint(bob.address, stakedAmountBob);
                await pulsefinity.connect(bob).approve(stakingPool.address, stakedAmountBob);
                await stakingPool.connect(bob).stake(stakedAmountBob, LockType.Days15);

                await increaseTime(60 * 60 * 24 * 15 + 1);

                await rewardToken.mint(deployer.address, rewardsAmmount);
                await rewardToken.approve(stakingPool.address, rewardsAmmount);
                await stakingPool.addRewards(rewardsAmmount);

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
                const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
                stakingPool = await PulsefinityStakingPoolFactory.deploy(pulsefinity.address, ethers.constants.AddressZero, stakingRouter.address, Tier.Nano);
                await stakingRouter.addStakingPool(stakingPool.address);

                const stakedAmountAlice2 = ethers.utils.parseEther("10");
                await pulsefinity.mint(alice.address, stakedAmountAlice2);
                await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice2);
                await stakingPool.connect(alice).stake(stakedAmountAlice2, LockType.Days15);

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
            const rewardsAmount = ethers.utils.parseEther("100");

            beforeEach(async () => {
                await rewardToken.mint(deployer.address, rewardsAmount);
                await rewardToken.approve(stakingPool.address, rewardsAmount);
            });

            it("should revert if no tokens are staked in the pool", async () => {
                await expect(stakingPool.addRewards(1)).to.be.revertedWith("Cannot add rewards when there are no stakes");
            });

            describe("ERC20 rewards", () => {
                beforeEach(async () => {
                    const stakedAmountAlice = ethers.utils.parseEther("10");
                    await pulsefinity.mint(alice.address, stakedAmountAlice);
                    await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice);
                    await stakingPool.connect(alice).stake(stakedAmountAlice, LockType.Days15);
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
                    const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
                    stakingPool = await PulsefinityStakingPoolFactory.deploy(
                        pulsefinity.address,
                        ethers.constants.AddressZero,
                        stakingRouter.address,
                        Tier.Nano
                    );
                    await stakingRouter.addStakingPool(stakingPool.address);

                    const stakedAmountAlice = ethers.utils.parseEther("10");
                    await pulsefinity.mint(alice.address, stakedAmountAlice);
                    await pulsefinity.connect(alice).approve(stakingPool.address, stakedAmountAlice);
                    await stakingPool.connect(alice).stake(stakedAmountAlice, LockType.Days15);
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
            const rewardsSurplus = ethers.utils.parseEther("50");

            it("should revert if rewards token is native token", async () => {
                const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
                stakingPool = await PulsefinityStakingPoolFactory.deploy(pulsefinity.address, ethers.constants.AddressZero, stakingRouter.address, Tier.Nano);
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
                const PulsefinityStakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
                stakingPool = await PulsefinityStakingPoolFactory.deploy(pulsefinity.address, pulsefinity.address, stakingRouter.address, Tier.Nano);
                await stakingRouter.addStakingPool(stakingPool.address);

                const tokenstToMint = ethers.utils.parseEther("100");

                await pulsefinity.mint(deployer.address, tokenstToMint);
                await pulsefinity.approve(stakingPool.address, tokenstToMint);
                await pulsefinity.transfer(stakingPool.address, rewardsSurplus);
                await stakingPool.stake(tokenstToMint.sub(rewardsSurplus), LockType.Days15);

                await expect(stakingPool.withdrawRewardSurplus()).to.changeTokenBalance(pulsefinity, deployer, rewardsSurplus);
            });
        });
    });
});
