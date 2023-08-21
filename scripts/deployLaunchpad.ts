import { ethers, network, upgrades } from "hardhat";
import helperconfig from "../helper-config";
import fs from "fs";

import { PulsefinityLaunchpad, PulsefinityStakingPool, PulsefinityStakingRouter, VestingContract } from "../typechain-types";

// This script will:
// 1. Deploy the Pulsefinity Launchpad

const stakingRouterAddress = "0x641BFEdDC36bCf4d5FAE269f7726385BA42B0F98";
const vestingAddress = "0x9F876248FB3d333f51893ec4FaCAEcEDf87f89A6"

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("\nDeploying contracts with the account:", deployer.address);
    console.log("\nNetwork used: ", network.name);
    console.log("\nAccount " + deployer.address + " will be owner of all contracts");

    // Deploy the Pulsefinity Launchpad

    const PulsefinityLaunchpadFactory = await ethers.getContractFactory("PulsefinityLaunchpad");
    const launchpad = (await upgrades.deployProxy(
        PulsefinityLaunchpadFactory,
        [stakingRouterAddress, helperconfig.pulseXRouterAddress, helperconfig.pulseXFactoryAddress, vestingAddress],
        {
            kind: "uups",
        }
    )) as PulsefinityLaunchpad;

    await launchpad.deployed();

    console.log("\nPulsefinity Launchpad deployed to:", launchpad.address);

    let existingDeployments = JSON.parse(fs.readFileSync("deployments.json", "utf8"));

    existingDeployments.vestingContract = vestingAddress;
    existingDeployments.stakingRouter = stakingRouterAddress;
    existingDeployments.launchPad = launchpad.address;

    fs.writeFileSync("deployments.json", JSON.stringify(existingDeployments, null, 4));
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
