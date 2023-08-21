import { ethers, network, upgrades } from "hardhat";
import helperconfig from "../helper-config";
import fs from "fs";

import { PulsefinityStakingPool, PulsefinityStakingRouter } from "../typechain-types";

// This script will:
// 1. Deploy a Pulsefinity Staking Pool
// 2. Add the pool to the Pulsefinity Staking Router

// MAKE SURE TO RUN THIS SCRIPT AFTER DEPLOYING THE PULSEFINITY STAKING ROUTER

export enum Tier {
    Null,
    Nano,
    Micro,
    Mega,
    Giga,
    Tera,
    TeraPlus,
}

// TO RUN THIS SCRIPT ADD THE REWARD TOKEN ADDRESS TO THE VARIABLE BELOW
const rewardTokenAddress = "0xe6Eea3fC1b0B850C888C26cf803Ab862A9cC481B";
// TO RUN THIS SCRIPT ADD THE MINIMUM TIER TO THE VARIABLE BELOW
const minTier = Tier.Null;

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("\nDeploying contracts with the account:", deployer.address);
    console.log("\nNetwork used: ", network.name);
    console.log("\nAccount " + deployer.address + " will be owner of all contracts");

    let existingDeployments = JSON.parse(fs.readFileSync("deployments.json", "utf8"));

    // Deploy the Pulsefinity Staking Pool
    const StakingPoolFactory = await ethers.getContractFactory("PulsefinityStakingPool");
    const stakingPool = (await upgrades.deployProxy(
        StakingPoolFactory,
        [helperconfig.pulsefinityAddress, rewardTokenAddress, existingDeployments.stakingRouter, minTier],
        {
            kind: "uups",
        }
    )) as PulsefinityStakingPool;

    await stakingPool.deployed();

    console.log("\nPulsefinity Staking Pool deployed to:", stakingPool.address);

    // Add the pool to the Pulsefinity Staking Router
    const stakingRouter = (await ethers.getContractAt("PulsefinityStakingRouter", existingDeployments.stakingRouter)) as PulsefinityStakingRouter;

    await stakingRouter.addStakingPool(stakingPool.address);

    console.log("\nPulsefinity Staking Pool added to Pulsefinity Staking Router");

    const poolObject = {
        address: stakingPool.address,
        rewardTokenAddress: rewardTokenAddress,
        minTier: "",
    };

    existingDeployments.stakingPools.push(poolObject);

    fs.writeFileSync("deployments.json", JSON.stringify(existingDeployments, null, 4));
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});