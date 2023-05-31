import { ethers, network, upgrades } from "hardhat";
import helperconfig from "../helper-config";
import fs from "fs";

import { PulsefinityLaunchpad, PulsefinityStakingPool, PulsefinityStakingRouter, VestingContract } from "../typechain-types";

// This script will:
// 1. Deploy the Vesting Contract
// 2. Deploy the Pulsefinity Staking Router
// 3. Deploy the Pulsefinity Launchpad

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("\nDeploying contracts with the account:", deployer.address);
    console.log("\nNetwork used: ", network.name);
    console.log("\nAccount " + deployer.address + " will be owner of all contracts");

    // Deploy the Vesting Contract

    const VestingContractFactory = await ethers.getContractFactory("VestingContract");
    const vesting = (await VestingContractFactory.deploy()) as VestingContract;

    await vesting.deployed();

    console.log("\nVesting Contract deployed to:", vesting.address);

    // Deploy the Pulsefinity Staking Router

    const StakingRouterFactory = await ethers.getContractFactory("PulsefinityStakingRouter");
    const stakingRouter = (await upgrades.deployProxy(StakingRouterFactory, [helperconfig.pulsefinityAddress, helperconfig.tierLimits], {
        kind: "uups",
    })) as PulsefinityStakingRouter;
    await stakingRouter.deployed();

    console.log("\nPulsefinity Staking Router deployed to:", stakingRouter.address);

    // Deploy the Pulsefinity Launchpad

    const PulsefinityLaunchpadFactory = await ethers.getContractFactory("PulsefinityLaunchpad");
    const launchpad = (await upgrades.deployProxy(
        PulsefinityLaunchpadFactory,
        [stakingRouter.address, helperconfig.pulseXRouterAddress, helperconfig.pulseXFactoryAddress, vesting.address],
        {
            kind: "uups",
        }
    )) as PulsefinityLaunchpad;

    await launchpad.deployed();

    console.log("\nPulsefinity Launchpad deployed to:", launchpad.address);

    let existingDeployments = JSON.parse(fs.readFileSync("deployments.json", "utf8"));

    existingDeployments.vestingContract = vesting.address;
    existingDeployments.stakingRouter = stakingRouter.address;
    existingDeployments.launchPad = launchpad.address;

    fs.writeFileSync("deployments.json", JSON.stringify(existingDeployments, null, 4));
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
