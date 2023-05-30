import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";

import { MockERC20, VestingContract } from "../typechain-types";

chai.use(chaiAsPromised);

enum DurationUnits {
    Days,
    Weeks,
    Months,
}

describe("VestingContract", () => {
    let token: MockERC20;
    let vesting: VestingContract;

    let deployer: SignerWithAddress;
    let user: SignerWithAddress;

    let startTime: number;

    const amountToLock = ethers.utils.parseEther("5250000");
    const duration = 20;

    const increaseTime = async (seconds: number) => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };

    before(async () => {
        [deployer, user] = await ethers.getSigners();
    });

    beforeEach(async () => {
        const tokenFactory = await ethers.getContractFactory("MockERC20");
        token = (await tokenFactory.deploy("Mock ERC20", "MOCK")) as MockERC20;

        const vestingFactory = await ethers.getContractFactory("VestingContract");
        vesting = (await vestingFactory.deploy()) as VestingContract;

        await token.mint(deployer.address, amountToLock);
        await token.approve(vesting.address, amountToLock);

        startTime = (await ethers.provider.getBlock("latest")).timestamp + 60;
    });

    describe("createVestingSchedule", () => {
        it("should rever if beneficiary is zero address", async () => {
            await expect(
                vesting.createVestingSchedule(token.address, ethers.constants.AddressZero, startTime, duration, DurationUnits.Months, amountToLock)
            ).to.be.revertedWith("VestingContract: beneficiary is the zero address");
        });

        it("should revert if amount is zero", async () => {
            await expect(vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, 0)).to.be.revertedWith(
                "VestingContract: amount is 0"
            );
        });

        it("should transfer tokens to vesting contract", async () => {
            expect(
                await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock)
            ).to.changeTokenBalance(token, vesting, amountToLock);
        });

        it("should create vesting schedule", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            const vestingSchedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            expect(vestingSchedule.beneficiary).to.equal(user.address);
            expect(vestingSchedule.start).to.equal(startTime);
            expect(vestingSchedule.duration).to.equal(duration);
            expect(vestingSchedule.amountTotal).to.equal(amountToLock);
            expect(vestingSchedule.released).to.equal(0);
        });
    });

    describe("vestedAmount", () => {
        it("should return 0 if vesting has not started", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(0);
        });

        it("should return 0 if duration is 0 and vesting has not started", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, 0, DurationUnits.Months, amountToLock);

            const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(0);
        });

        it("should return the total amount if duration is 0 and vesting has ended", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, 0, DurationUnits.Months, amountToLock);

            await increaseTime(61);

            const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(amountToLock);
        });

        it("should return the total amount if vesting has ended", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            await increaseTime(duration * 60 * 60 * 24 * 30 + 61);

            const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(amountToLock);
        });

        it("should return the correct amount if vesting is in progress", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            await increaseTime(61);

            for (let i = 0; i < duration; i++) {
                await increaseTime(60 * 60 * 24 * 30);

                const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

                const vestedAmount = await vesting.vestedAmount(schedule);

                expect(vestedAmount).to.equal(amountToLock.div(duration).mul(i + 1));
            }
        });
    });

    describe("releasableAmount", () => {
        it("should correctly return the releasable amount", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            await increaseTime(61);

            await increaseTime(60 * 60 * 24 * 30);

            const releasableAmountBefore = await vesting.getReleaseableAmount(token.address, user.address);

            await vesting.release(token.address, user.address);

            const schedule = (await vesting.getVestingSchedules(token.address, user.address))[0];

            const releasedAmount = schedule.released;

            const releasableAmountAfter = await vesting.getReleaseableAmount(token.address, user.address);

            expect(releasableAmountAfter).to.equal(releasableAmountBefore.sub(releasedAmount));
        });
    });

    describe("release", () => {
        it("should rever it beneficiary has no vesting schedules", async () => {
            await expect(vesting.release(token.address, user.address)).to.be.revertedWith("VestingContract: no vesting schedules for beneficiary");
        });

        it("should not send tokens if there are no tokens to release", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            const balanceBefore = await token.balanceOf(user.address);

            await vesting.release(token.address, user.address);

            const balanceAfter = await token.balanceOf(user.address);

            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("should correctly release tokens", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            await increaseTime(60 * 60 * 24 * 30 + 61);

            const releasableAmount = await vesting.getReleaseableAmount(token.address, user.address);

            await expect(vesting.release(token.address, user.address)).to.changeTokenBalance(token, user, releasableAmount);
        });
    });

    describe("getReleaseableAmount", () => {
        it("should return 0 if beneficiary has no vesting schedules", async () => {
            const releasableAmount = await vesting.getReleaseableAmount(token.address, user.address);

            expect(releasableAmount).to.equal(0);
        });

        it("should correctly return the releasable amount", async () => {
            await vesting.createVestingSchedule(token.address, user.address, startTime, duration, DurationUnits.Months, amountToLock);

            await increaseTime(61);

            await increaseTime(60 * 60 * 24 * 30);

            const releasableAmount = await vesting.getReleaseableAmount(token.address, user.address);

            expect(releasableAmount).to.equal(amountToLock.div(duration));
        });
    });
});
